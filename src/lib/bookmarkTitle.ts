import type { BookmarkAiMeta } from "@/types";
import { normalizeBookmarkTags } from "./bookmarkTaxonomy.ts";

export const MAX_BOOKMARK_TAGS = 5;

export interface BookmarkTagParts {
  baseTitle: string;
  manualTags: string[];
  aiTags: string[];
  tags: string[];
  legacyTags: string[];
}

export function parseTaggedTitle(rawTitle: string): {
  baseTitle: string;
  tags: string[];
} {
  const title = rawTitle.trim();
  const segments = title.split(/\s+#/);
  if (segments.length <= 1) return { baseTitle: title, tags: [] };
  const tags = normalizeBookmarkTags(
    segments.slice(1).map((tag) => tag.trim()),
  );
  return {
    baseTitle: segments[0].trim() || title,
    tags,
  };
}

export function getBookmarkTagParts(
  rawTitle: string,
  meta?: BookmarkAiMeta,
): BookmarkTagParts {
  const parsed = parseTaggedTitle(rawTitle);
  const manualTags = normalizeBookmarkTags(meta?.manualTags).slice(
    0,
    MAX_BOOKMARK_TAGS,
  );
  const storedAiTags = normalizeBookmarkTags(
    meta?.aiTags ?? meta?.tags ?? (meta ? [] : parsed.tags),
  );
  const aiLimit = Math.max(0, MAX_BOOKMARK_TAGS - manualTags.length);
  const aiTags = storedAiTags.slice(0, aiLimit);
  const tags = mergeTags(manualTags, aiTags);
  const baseTitle = sanitizeBaseTitle(
    meta?.baseTitle || parsed.baseTitle || meta?.title || rawTitle,
  );
  return {
    baseTitle,
    manualTags,
    aiTags,
    tags,
    legacyTags: uniqueTags([
      ...(meta?.legacyTags ?? []),
      ...(meta?.tags ?? []),
      ...storedAiTags.slice(aiLimit),
      ...(meta?.manualTags ?? []).slice(MAX_BOOKMARK_TAGS),
    ]).filter((tag) => !tags.includes(tag)),
  };
}

export function mergeTags(manualTags: unknown, aiTags: unknown): string[] {
  const manual = normalizeBookmarkTags(manualTags).slice(0, MAX_BOOKMARK_TAGS);
  const aiLimit = Math.max(0, MAX_BOOKMARK_TAGS - manual.length);
  return uniqueTags([
    ...manual,
    ...normalizeBookmarkTags(aiTags).slice(0, aiLimit),
  ]).slice(0, MAX_BOOKMARK_TAGS);
}

export function buildTaggedTitle(baseTitle: string, tags: unknown): string {
  const cleanBase = sanitizeBaseTitle(baseTitle) || "未命名书签";
  const effective = normalizeBookmarkTags(tags).slice(0, MAX_BOOKMARK_TAGS);
  if (!effective.length) return cleanBase;
  return `${cleanBase} ${effective.map((tag) => `#${tag}`).join(" ")}`;
}

export function sanitizeBaseTitle(value: string): string {
  return parseTaggedTitle(value).baseTitle.trim();
}

export function getBookmarkPurpose(meta?: BookmarkAiMeta): string {
  return (meta?.purpose || meta?.summary || "").trim();
}

export function isNewTagSchema(meta?: BookmarkAiMeta): boolean {
  if (!meta) return false;
  if (meta.tagSchemaVersion === 2) return true;
  return (
    !!meta.baseTitle &&
    !!meta.group &&
    Array.isArray(meta.aiTags) &&
    typeof meta.purpose === "string"
  );
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of normalizeBookmarkTags(tags)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
