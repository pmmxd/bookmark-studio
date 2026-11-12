import type { BookmarkAiMeta } from "@/types";
import { getBookmarkMeta, saveBookmarkMeta } from "@/lib/bookmarkMeta";
import {
  createBookmark,
  moveBookmark,
  updateBookmark,
} from "@/lib/bookmarks";
import {
  buildTaggedTitle,
  getBookmarkTagParts,
  mergeTags,
  sanitizeBaseTitle,
} from "@/lib/bookmarkTitle";
import { normalizeBookmarkTags } from "@/lib/bookmarkTaxonomy";

export interface SaveBookmarkDetailsInput {
  parentId: string;
  url: string;
  baseTitle: string;
  manualTags: string[];
  aiTags?: string[];
  purpose: string;
  purposeSource: "manual" | "ai";
}

export async function collectBookmark(
  input: SaveBookmarkDetailsInput,
): Promise<BookmarkAiMeta> {
  const baseTitle = sanitizeBaseTitle(input.baseTitle) || input.url;
  const manualTags = normalizeBookmarkTags(input.manualTags).slice(0, 5);
  const aiTags = normalizeBookmarkTags(input.aiTags)
    .filter((tag) => !manualTags.includes(tag))
    .slice(0, Math.max(0, 5 - manualTags.length));
  const tags = mergeTags(manualTags, aiTags);
  const node = await createBookmark(
    input.parentId,
    buildTaggedTitle(baseTitle, tags),
    input.url,
  );
  const now = Date.now();
  const meta: BookmarkAiMeta = {
    bookmarkId: node.id,
    url: input.url,
    title: baseTitle,
    baseTitle,
    category: "未分类",
    tags,
    manualTags,
    aiTags,
    blockedTags: [],
    purpose: input.purpose.trim(),
    purposeSource: input.purposeSource,
    purposeLocked: input.purposeSource === "manual" && !!input.purpose.trim(),
    summary: input.purpose.trim(),
    analyzedAt: now,
  };
  await saveBookmarkMeta([meta]);
  return meta;
}

export async function updateBookmarkDetails(
  bookmarkId: string,
  input: {
    baseTitle: string;
    manualTags: string[];
    aiTags?: string[];
    blockedTags?: string[];
    purpose: string;
    purposeSource: "manual" | "ai";
    parentId: string;
  },
): Promise<BookmarkAiMeta> {
  const current = await getBookmarkMeta(bookmarkId);
  const bookmark = await chrome.bookmarks.get(bookmarkId).then((rows) => rows[0]);
  if (!bookmark?.url) throw new Error("书签不存在");
  const previous = getBookmarkTagParts(bookmark.title, current);
  const manualTags = normalizeBookmarkTags(input.manualTags).slice(0, 5);
  const aiLimit = Math.max(0, 5 - manualTags.length);
  const aiTags = normalizeBookmarkTags(
    input.aiTags ?? previous.aiTags,
  ).slice(0, aiLimit);
  const tags = mergeTags(manualTags, aiTags);
  const baseTitle = sanitizeBaseTitle(input.baseTitle) || previous.baseTitle;
  const purpose = input.purpose.trim();
  const now = Date.now();
  const meta: BookmarkAiMeta = {
    bookmarkId,
    url: bookmark.url,
    title: baseTitle,
    baseTitle,
    group: current?.group,
    category: current?.category ?? "未分类",
    tags,
    manualTags,
    aiTags,
    blockedTags: normalizeBookmarkTags(input.blockedTags ?? current?.blockedTags),
    tagSchemaVersion: current?.tagSchemaVersion,
    purpose,
    purposeSource: input.purposeSource,
    purposeLocked:
      input.purposeSource === "manual" && !!purpose
        ? true
        : current?.purposeLocked,
    legacyTags: unique([
      ...(current?.legacyTags ?? []),
      ...previous.aiTags.slice(aiLimit),
    ]).filter((tag) => !tags.includes(tag)),
    summary: current?.summary || purpose,
    analyzedAt: current?.analyzedAt ?? now,
  };
  await updateBookmark(bookmarkId, {
    title: buildTaggedTitle(baseTitle, tags),
  });
  if (input.parentId && bookmark.parentId !== input.parentId) {
    await moveBookmark(bookmarkId, input.parentId);
  }
  await saveBookmarkMeta([meta]);
  return meta;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
