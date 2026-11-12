import type { BookmarkNode, CleanIssue, FlatBookmark } from "@/types";
import {
  flatten,
  allFolders,
  countBookmarks,
  getVisibleTree,
} from "@/lib/bookmarks";
import { normalizeUrl } from "@/lib/utils";

export interface ScanProgress {
  total: number;
  checked: number;
  phase: "structure" | "duplicates" | "invalid" | "done";
}

export interface ScanOptions {
  checkInvalid: boolean;
  concurrency: number;
  signal?: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
}

export async function scanAll(
  opts: Partial<ScanOptions> = {},
): Promise<CleanIssue[]> {
  const options: ScanOptions = {
    checkInvalid: true,
    concurrency: 8,
    ...opts,
  };
  const tree = await getVisibleTree();
  const flat = flatten(tree);

  const issues: CleanIssue[] = [];
  issues.push(...scanEmptyFolders(tree));
  options.onProgress?.({ total: flat.length, checked: 0, phase: "structure" });

  issues.push(...scanDuplicates(flat));
  options.onProgress?.({ total: flat.length, checked: 0, phase: "duplicates" });

  issues.push(...scanBrokenUrls(flat));

  if (options.checkInvalid) {
    const liveness = await scanInvalid(flat, options);
    issues.push(...liveness);
  }
  options.onProgress?.({ total: flat.length, checked: flat.length, phase: "done" });
  return issues;
}

export function scanEmptyFolders(tree: BookmarkNode[]): CleanIssue[] {
  const folders = allFolders(tree);
  return folders
    .filter((f) => f.count === 0 && f.id !== "1" && f.id !== "2" && f.id !== "3")
    .map((f) => ({
      id: `empty-${f.id}`,
      kind: "empty-folder" as const,
      title: `空文件夹：${f.title || "(未命名)"}`,
      detail: f.path,
      folderId: f.id,
    }));
}

export function scanDuplicates(flat: FlatBookmark[]): CleanIssue[] {
  const groups = new Map<string, FlatBookmark[]>();
  for (const b of flat) {
    const key = normalizeUrl(b.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  const out: CleanIssue[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const [keep, ...rest] = list;
    for (const dup of rest) {
      out.push({
        id: `dup-${dup.id}`,
        kind: "duplicate",
        title: dup.title,
        detail: `与「${keep.title}」重复（${keep.path}）`,
        bookmark: dup,
        group: key,
      });
    }
  }
  return out;
}

export function scanBrokenUrls(flat: FlatBookmark[]): CleanIssue[] {
  const out: CleanIssue[] = [];
  for (const b of flat) {
    try {
      const u = new URL(b.url);
      if (!/^https?:|^chrome:|^edge:|^file:|^about:/.test(u.protocol + ":")) {
        if (!["http:", "https:"].includes(u.protocol)) {
          out.push({
            id: `broken-${b.id}`,
            kind: "broken-url",
            title: b.title,
            detail: `不常见协议：${u.protocol}`,
            bookmark: b,
          });
        }
      }
    } catch {
      out.push({
        id: `broken-${b.id}`,
        kind: "broken-url",
        title: b.title,
        detail: `URL 无法解析：${b.url}`,
        bookmark: b,
      });
    }
  }
  return out;
}

export async function scanInvalid(
  flat: FlatBookmark[],
  options: ScanOptions,
): Promise<CleanIssue[]> {
  const targets = flat.filter((b) => /^https?:/.test(b.url));
  const total = targets.length;
  let checked = 0;
  const out: CleanIssue[] = [];

  const queue = [...targets];
  const workers = Array.from({ length: options.concurrency }, async () => {
    while (queue.length) {
      if (options.signal?.aborted) return;
      const b = queue.shift()!;
      const alive = await pingAlive(b.url, options.signal);
      checked++;
      options.onProgress?.({ total, checked, phase: "invalid" });
      if (!alive) {
        out.push({
          id: `invalid-${b.id}`,
          kind: "invalid",
          title: b.title,
          detail: `无法访问：${b.url}`,
          bookmark: b,
        });
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function pingAlive(url: string, signal?: AbortSignal): Promise<boolean> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 6000);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      redirect: "follow",
      signal: ctrl.signal,
    });
    return res.ok || res.type === "opaque";
  } catch {
    try {
      const res = await fetch(url, { method: "GET", mode: "no-cors", signal: ctrl.signal });
      return res.type === "opaque" || res.ok;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timeout);
  }
}

export interface Profile {
  totalBookmarks: number;
  totalFolders: number;
  emptyFolders: number;
  maxFolder?: { title: string; count: number };
  topDomains: Array<{ domain: string; count: number }>;
  uniqueDomains: number;
  oldest?: FlatBookmark;
  newest?: FlatBookmark;
  addedThisMonth: number;
  addedToday: number;
  collectDays: number;
  httpsRatio: number;
  duplicateUrls: number;
  yearBuckets: Array<{ label: string; count: number }>;
  monthBuckets: Array<{ label: string; count: number }>;
  topKeywords: Array<{ word: string; count: number }>;
  busiestDay?: { date: string; count: number };
  level: { index: number; label: string };
  badges: Array<{ id: string; label: string; detail: string }>;
  avgPerFolder: number;
  orgScore: number;
}

export async function buildProfile(): Promise<Profile> {
  const tree = await getVisibleTree();
  const flat = flatten(tree);
  const folders = allFolders(tree);
  const domainMap = new Map<string, number>();
  let https = 0;
  for (const b of flat) {
    try {
      const u = new URL(b.url);
      const d = u.hostname.replace(/^www\./, "");
      domainMap.set(d, (domainMap.get(d) ?? 0) + 1);
      if (u.protocol === "https:") https++;
    } catch {}
  }
  const topDomains = [...domainMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  const withDate = flat.filter((b) => typeof b.dateAdded === "number");
  const oldest = withDate.reduce<FlatBookmark | undefined>(
    (acc, b) => (!acc || (b.dateAdded ?? 0) < (acc.dateAdded ?? 0) ? b : acc),
    undefined,
  );
  const newest = withDate.reduce<FlatBookmark | undefined>(
    (acc, b) => (!acc || (b.dateAdded ?? 0) > (acc.dateAdded ?? 0) ? b : acc),
    undefined,
  );

  const today = new Date();
  const day = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const todayKey = day(today.getTime());
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let addedToday = 0;
  let addedThisMonth = 0;
  const yearMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const dayMap = new Map<string, number>();
  for (const b of withDate) {
    const ts = b.dateAdded!;
    if (day(ts) === todayKey) addedToday++;
    if (ts > monthAgo) addedThisMonth++;
    const d = new Date(ts);
    const y = String(d.getFullYear());
    const m = `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    yearMap.set(y, (yearMap.get(y) ?? 0) + 1);
    monthMap.set(m, (monthMap.get(m) ?? 0) + 1);
    const dk = day(ts);
    dayMap.set(dk, (dayMap.get(dk) ?? 0) + 1);
  }
  const yearBuckets = [...yearMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
  const monthBuckets = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([label, count]) => ({ label, count }));
  let busiestDay: { date: string; count: number } | undefined;
  for (const [d, c] of dayMap) {
    if (!busiestDay || c > busiestDay.count) busiestDay = { date: d, count: c };
  }

  const collectDays = oldest?.dateAdded
    ? Math.max(
        1,
        Math.round((Date.now() - oldest.dateAdded) / (24 * 60 * 60 * 1000)),
      )
    : 0;

  const emptyFolders = folders.filter((f) => f.count === 0).length;
  const maxFolder = folders.reduce<
    { title: string; count: number } | undefined
  >(
    (acc, f) =>
      !acc || f.count > acc.count
        ? { title: f.title || "(未命名)", count: f.count }
        : acc,
    undefined,
  );

  const normalizedMap = new Map<string, number>();
  for (const b of flat) {
    try {
      const u = new URL(b.url);
      u.hash = "";
      u.search = "";
      const k = u.toString().toLowerCase();
      normalizedMap.set(k, (normalizedMap.get(k) ?? 0) + 1);
    } catch {}
  }
  let duplicateUrls = 0;
  for (const c of normalizedMap.values()) if (c > 1) duplicateUrls++;

  const keywordMap = new Map<string, number>();
  const stopwords = new Set([
    "的",
    "是",
    "在",
    "和",
    "了",
    "与",
    "或",
    "及",
    "the",
    "a",
    "an",
    "of",
    "to",
    "for",
    "in",
    "on",
    "and",
    "or",
    "with",
    "is",
    "are",
    "was",
  ]);
  for (const b of flat) {
    const text = (b.title || "").toLowerCase();
    const tokens = text
      .split(/[\s,，。·\-—_|\/()\[\]「」【】《》:：]+/)
      .filter((w) => w.length >= 2 && !stopwords.has(w));
    for (const w of tokens) {
      keywordMap.set(w, (keywordMap.get(w) ?? 0) + 1);
    }
  }
  const topKeywords = [...keywordMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  const level = calcLevel(flat.length);
  const badges = makeBadges({
    total: flat.length,
    topDomains,
    uniqueDomains: domainMap.size,
    folders: folders.length,
    emptyFolders,
    duplicateUrls,
    addedThisMonth,
    topKeywords,
  });

  const avgPerFolder = folders.length
    ? Math.round((flat.length / folders.length) * 10) / 10
    : 0;

  const orgScore = scoreOrg({
    total: flat.length,
    folders: folders.length,
    emptyFolders,
    duplicateUrls,
    avgPerFolder,
  });

  return {
    totalBookmarks: flat.length,
    totalFolders: folders.length,
    emptyFolders,
    maxFolder,
    topDomains,
    uniqueDomains: domainMap.size,
    oldest,
    newest,
    addedThisMonth,
    addedToday,
    collectDays,
    httpsRatio: flat.length ? https / flat.length : 0,
    duplicateUrls,
    yearBuckets,
    monthBuckets,
    topKeywords,
    busiestDay,
    level,
    badges,
    avgPerFolder,
    orgScore,
  };
}

function calcLevel(total: number): { index: number; label: string } {
  const tiers = [
    { min: 0, label: "Lv.1 新手收藏家" },
    { min: 50, label: "Lv.2 练习生" },
    { min: 200, label: "Lv.3 业余选手" },
    { min: 500, label: "Lv.4 资深玩家" },
    { min: 1000, label: "Lv.5 高级收藏家" },
    { min: 1500, label: "Lv.6 资深分享家" },
    { min: 2500, label: "Lv.7 专家收藏家" },
    { min: 4000, label: "Lv.8 书签大师" },
    { min: 7000, label: "Lv.9 互联网图书馆员" },
    { min: 12000, label: "Lv.10 传奇收藏家" },
  ];
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (total >= tiers[i].min) idx = i;
  return { index: idx + 1, label: tiers[idx].label };
}

interface BadgeInput {
  total: number;
  topDomains: Array<{ domain: string; count: number }>;
  uniqueDomains: number;
  folders: number;
  emptyFolders: number;
  duplicateUrls: number;
  addedThisMonth: number;
  topKeywords: Array<{ word: string; count: number }>;
}

function makeBadges(x: BadgeInput): Profile["badges"] {
  const out: Profile["badges"] = [];
  const hasKw = (...ks: string[]) =>
    x.topKeywords.some((k) => ks.includes(k.word));
  const hasDomain = (kw: string) =>
    x.topDomains.some((d) => d.domain.includes(kw));
  if (hasDomain("github") || hasKw("github", "api", "code", "dev"))
    out.push({
      id: "tech",
      label: "技术达人",
      detail: "GitHub / API / 开发资料占比高",
    });
  if (hasDomain("youtube") || hasDomain("bilibili") || hasKw("课程", "教程"))
    out.push({
      id: "learn",
      label: "终身学习",
      detail: "视频/课程/教程积累",
    });
  if (hasKw("tool", "工具", "生成器", "convert"))
    out.push({
      id: "tool",
      label: "工具控",
      detail: "工具类关键词丰富",
    });
  if (x.uniqueDomains >= 150 && x.total >= 500)
    out.push({
      id: "wide",
      label: "博学广闻",
      detail: `${x.uniqueDomains} 个不同域名`,
    });
  if (x.addedThisMonth >= 50)
    out.push({
      id: "active",
      label: "收藏狂魔",
      detail: `近 30 天收藏 ${x.addedThisMonth} 条`,
    });
  if (x.folders >= 20 && x.emptyFolders / Math.max(1, x.folders) < 0.1)
    out.push({
      id: "organizer",
      label: "整理达人",
      detail: "文件夹多且空闲率低",
    });
  return out;
}

function scoreOrg(x: {
  total: number;
  folders: number;
  emptyFolders: number;
  duplicateUrls: number;
  avgPerFolder: number;
}): number {
  if (!x.total) return 0;
  let score = 10;
  score -= (x.emptyFolders / Math.max(1, x.folders)) * 2;
  score -= (x.duplicateUrls / Math.max(1, x.total)) * 5;
  if (x.avgPerFolder < 3) score -= 1.5;
  if (x.avgPerFolder > 60) score -= 1;
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

export { countBookmarks };
