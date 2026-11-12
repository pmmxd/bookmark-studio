import type {
  BookmarkAiMeta,
  BookmarkMetaStore,
  BookmarkNode,
  Settings,
} from "@/types";
import { flatten, getTree } from "@/lib/bookmarks";
import { loadBookmarkMeta, saveBookmarkMeta } from "@/lib/bookmarkMeta";
import { getSettings, setSettings } from "@/lib/storage";
import { buildIntegrity, verifyIntegrity } from "@/lib/backupIntegrity";
import {
  normalizeBookmarkGroup,
  normalizeBookmarkTags,
} from "@/lib/bookmarkTaxonomy";
import { mergeTags, sanitizeBaseTitle } from "@/lib/bookmarkTitle";

export interface BackupNode {
  id?: string;
  title: string;
  url?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BackupNode[];
}

export interface BackupFile {
  app: "smart-bookmark";
  version: 1 | 2;
  exportedAt: number;
  tree: BackupNode[];
  bookmarkMeta?: BookmarkMetaStore;
  settings?: BackupSettings;
  integrity?: string;
}

export type BackupSettings = Omit<
  Settings,
  "aiApiKey" | "githubToken"
>;

function toBackupNode(n: BookmarkNode): BackupNode {
  return {
    id: n.id,
    title: n.title || "",
    url: n.url,
    dateAdded: n.dateAdded,
    dateGroupModified: (n as any).dateGroupModified,
    children: n.children?.map(toBackupNode),
  };
}

export async function buildBackup(): Promise<BackupFile> {
  const [tree, bookmarkMeta, settings] = await Promise.all([
    getTree(),
    loadBookmarkMeta(),
    getSettings(),
  ]);
  const topLevel = tree[0]?.children ?? tree;
  const {
    aiApiKey: _aiApiKey,
    githubToken: _githubToken,
    ...safeSettings
  } = settings;
  const core = {
    app: "smart-bookmark" as const,
    version: 2 as const,
    exportedAt: Date.now(),
    tree: topLevel.map(toBackupNode),
    bookmarkMeta,
    settings: safeSettings,
  };
  return { ...core, integrity: await buildIntegrity(core) };
}

export async function verifyBackupIntegrity(
  backup: BackupFile,
): Promise<boolean> {
  if (backup.version !== 2) return true;
  return verifyIntegrity(backup as unknown as Record<string, unknown> & {
    integrity?: string;
  });
}

export async function importBookmarkMetadata(
  backup: BackupFile,
  idMap: Record<string, string>,
): Promise<number> {
  if (!backup.bookmarkMeta) return 0;
  const entries: BookmarkAiMeta[] = [];
  for (const [oldId, raw] of Object.entries(backup.bookmarkMeta)) {
    const bookmarkId = idMap[oldId];
    if (!bookmarkId) continue;
    const group = normalizeBookmarkGroup(raw.group);
    const manualTags = normalizeBookmarkTags(raw.manualTags);
    const aiTags = normalizeBookmarkTags(raw.aiTags ?? raw.tags);
    const tags = mergeTags(manualTags, aiTags);
    const baseTitle = raw.baseTitle
      ? sanitizeBaseTitle(String(raw.baseTitle))
      : raw.title
        ? sanitizeBaseTitle(String(raw.title))
        : undefined;
    entries.push({
      bookmarkId,
      url: String(raw.url ?? ""),
      title: baseTitle,
      baseTitle,
      ...(group ? { group } : {}),
      category: String(raw.category ?? "未分类"),
      tags,
      manualTags,
      aiTags,
      purpose: raw.purpose ? String(raw.purpose).slice(0, 140) : undefined,
      purposeSource:
        raw.purposeSource === "manual" || raw.purposeSource === "ai"
          ? raw.purposeSource
          : undefined,
      purposeLocked: !!raw.purposeLocked,
      legacyTags: Array.from(
        new Set([
          ...normalizeBookmarkTags(raw.legacyTags),
          ...normalizeBookmarkTags(raw.tags),
        ]),
      ).filter((tag) => !tags.includes(tag)),
      blockedTags: normalizeBookmarkTags(raw.blockedTags),
      tagSchemaVersion:
        typeof raw.tagSchemaVersion === "number"
          ? raw.tagSchemaVersion
          : undefined,
      summary: String(raw.summary ?? ""),
      analyzedAt:
        typeof raw.analyzedAt === "number" ? raw.analyzedAt : Date.now(),
    });
  }
  if (entries.length) await saveBookmarkMeta(entries);
  return entries.length;
}

export async function applyBackupSettings(
  backup: BackupFile,
  idMap: Record<string, string>,
): Promise<boolean> {
  if (!backup.settings) return false;
  const raw = backup.settings as unknown as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  const keys = [
    "theme",
    "accentPreset",
    "themePreset",
    "wallpaper",
    "searchEngine",
    "aiProvider",
    "aiModel",
    "aiBaseUrl",
    "aiExcludedFolderNames",
    "cardDensity",
    "language",
    "floatingBall",
    "floatingDisabledDomains",
    "compareEngines",
    "customEngines",
    "collectionBoardName",
    "aiChannelSources",
    "friendLinksFolderName",
    "friendLinksInitialized",
    "discoverDefaultRange",
    "discoverDefaultMode",
    "discoverDefaultLanguage",
    "discoverDefaultSort",
    "trendingSource",
    "showGithubTrendingWidget",
    "showInfoCollections",
    "showInfoLiveNews",
    "showInfoEntries",
    "showTopSites",
    "hiddenTabs",
  ] as const;
  for (const key of keys) {
    if (key in raw) Object.assign(patch, { [key]: raw[key] });
  }
  const remap = (id?: string) => (id ? (idMap[id] ?? id) : undefined);
  patch.rootFolderId = remap(String(raw.rootFolderId ?? ""));
  patch.privateFolderId = remap(String(raw.privateFolderId ?? ""));
  patch.friendLinksFolderId = remap(String(raw.friendLinksFolderId ?? ""));
  patch.expandedFolders = Array.isArray(raw.expandedFolders)
    ? raw.expandedFolders.map((id) => idMap[String(id)] ?? String(id))
    : [];
  patch.pinnedFolderIds = Array.isArray(raw.pinnedFolderIds)
    ? raw.pinnedFolderIds.map((id) => idMap[String(id)] ?? String(id))
    : [];
  patch.aiChannelSources = Array.isArray(raw.aiChannelSources)
    ? raw.aiChannelSources.map((id) => idMap[String(id)] ?? String(id))
    : [];
  await setSettings(patch);
  return true;
}

export function downloadJsonBackup(backup: BackupFile) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, `bookmark-studio-backup-${ymd()}.json`);
}

export function downloadHtmlBackup(backup: BackupFile) {
  const html = toNetscapeHtml(backup.tree);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  triggerDownload(blob, `bookmark-studio-backup-${ymd()}.html`);
}

function ymd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function countBackupUrls(nodes: BackupNode[]): number {
  let n = 0;
  const walk = (node: BackupNode) => {
    if (node.url) n++;
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return n;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toNetscapeHtml(nodes: BackupNode[]): string {
  const lines: string[] = [];
  lines.push(
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file by Bookmark Studio. -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  );
  const writeNode = (n: BackupNode, indent: string) => {
    const add = n.dateAdded ? ` ADD_DATE="${Math.floor(n.dateAdded / 1000)}"` : "";
    if (n.url) {
      lines.push(
        `${indent}<DT><A HREF="${escHtml(n.url)}"${add}>${escHtml(n.title)}</A>`,
      );
    } else {
      const mod = n.dateGroupModified
        ? ` LAST_MODIFIED="${Math.floor(n.dateGroupModified / 1000)}"`
        : "";
      lines.push(`${indent}<DT><H3${add}${mod}>${escHtml(n.title)}</H3>`);
      lines.push(`${indent}<DL><p>`);
      for (const c of n.children ?? []) writeNode(c, indent + "    ");
      lines.push(`${indent}</DL><p>`);
    }
  };
  for (const n of nodes) writeNode(n, "    ");
  lines.push("</DL><p>");
  return lines.join("\n");
}

export function parseNetscapeHtml(html: string): BackupNode[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("dl");
  if (!root) return [];
  const parseDl = (dl: Element): BackupNode[] => {
    const out: BackupNode[] = [];
    const kids = Array.from(dl.children);
    for (let i = 0; i < kids.length; i++) {
      const dt = kids[i];
      if (dt.tagName.toLowerCase() !== "dt") continue;
      const a = dt.querySelector(":scope > a");
      const h3 = dt.querySelector(":scope > h3");
      if (a) {
        const url = a.getAttribute("href") || "";
        const title = (a.textContent || "").trim();
        const add = a.getAttribute("add_date");
        out.push({
          title,
          url,
          dateAdded: add ? Number(add) * 1000 : undefined,
        });
      } else if (h3) {
        const title = (h3.textContent || "").trim();
        const childDl =
          (kids[i + 1] && kids[i + 1].tagName.toLowerCase() === "dl"
            ? kids[i + 1]
            : dt.querySelector(":scope > dl")) || null;
        out.push({
          title,
          children: childDl ? parseDl(childDl as Element) : [],
        });
      }
    }
    return out;
  };
  return parseDl(root);
}

export interface ImportResult {
  added: number;
  skipped: number;
  idMap: Record<string, string>;
}

export async function importIntoFolder(
  parentId: string,
  nodes: BackupNode[],
  existingUrls: Map<string, string>,
): Promise<ImportResult> {
  let added = 0;
  let skipped = 0;
  const idMap: Record<string, string> = {};
  const hasApi = typeof chrome !== "undefined" && !!chrome.bookmarks;
  if (!hasApi) return { added, skipped, idMap };

  const createFolder = (title: string, parent: string) =>
    new Promise<string>((resolve, reject) => {
      chrome.bookmarks.create({ parentId: parent, title }, (n) => {
        if (chrome.runtime.lastError)
          reject(new Error(chrome.runtime.lastError.message));
        else resolve(n.id);
      });
    });
  const createLink = (title: string, url: string, parent: string) =>
    new Promise<string>((resolve, reject) => {
      chrome.bookmarks.create({ parentId: parent, title, url }, (node) => {
        if (chrome.runtime.lastError)
          reject(new Error(chrome.runtime.lastError.message));
        else resolve(node.id);
      });
    });

  const walk = async (items: BackupNode[], parent: string) => {
    for (const it of items) {
      if (it.url) {
        const key = normalize(it.url);
        if (existingUrls.has(key)) {
          if (it.id) idMap[it.id] = existingUrls.get(key)!;
          skipped++;
          continue;
        }
        try {
          const id = await createLink(it.title || it.url, it.url, parent);
          if (it.id) idMap[it.id] = id;
          existingUrls.set(key, id);
          added++;
        } catch {
          skipped++;
        }
      } else {
        const id = await createFolder(it.title || "(untitled)", parent);
        if (it.id) idMap[it.id] = id;
        await walk(it.children ?? [], id);
      }
    }
  };
  await walk(nodes, parentId);
  return { added, skipped, idMap };
}

function normalize(u: string) {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export async function collectExistingUrls(): Promise<Map<string, string>> {
  const tree = await getTree();
  const ids = new Map<string, string>();
  for (const bookmark of flatten(tree)) {
    ids.set(normalize(bookmark.url), bookmark.id);
  }
  return ids;
}
