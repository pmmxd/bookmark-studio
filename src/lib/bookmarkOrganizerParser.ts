import {
  normalizeBookmarkGroup,
  normalizeBookmarkTags,
  type BookmarkGroup,
} from "./bookmarkTaxonomy.ts";

export interface OrganizerSuggestion {
  bookmarkId: string;
  title: string;
  category: string;
  group?: BookmarkGroup;
  tags: string[];
  purpose: string;
  summary: string;
}

export function parseOrganizerResponse(
  raw: string,
  allowed: Record<string, string>,
): OrganizerSuggestion[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const rows = extractRows(text);

  const out: OrganizerSuggestion[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    let bookmarkId = String(row.bookmarkId ?? row.id ?? "").trim();
    if (!allowed[bookmarkId] && typeof row.url === "string") {
      bookmarkId =
        Object.entries(allowed).find(([, url]) => url === row.url)?.[0] ?? "";
    }
    if (!bookmarkId || !allowed[bookmarkId] || seen.has(bookmarkId)) continue;

    const tags = normalizeBookmarkTags(row.tags);
    const group = normalizeBookmarkGroup(row.group) ?? undefined;
    const category = String(row.category ?? "").trim().slice(0, 16);
    const purpose = String(row.purpose ?? row.summary ?? "")
      .trim()
      .slice(0, 140);
    const summary = String(row.summary ?? "").trim().slice(0, 140);
    const title = String(row.title ?? "").trim().slice(0, 80);
    if (!category || !summary || !title) continue;

    seen.add(bookmarkId);
    out.push({
      bookmarkId,
      title,
      category,
      group,
      tags,
      purpose,
      summary,
    });
  }
  if (!out.length) throw new Error("AI 返回的整理结果为空或格式不完整");
  return out;
}

function extractRows(text: string): unknown[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return rowsFromValue(JSON.parse(text.slice(start, end + 1)));
    } catch {
      // Recover complete item objects from an otherwise truncated response.
    }
  }
  return extractBalancedObjects(text).flatMap((value) => {
    try {
      return rowsFromValue(JSON.parse(value));
    } catch {
      return [];
    }
  });
}

function rowsFromValue(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const object = parsed as Record<string, unknown>;
  for (const key of ["items", "bookmarks", "results"]) {
    const value = object[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).map(([id, row]) =>
        row && typeof row === "object"
          ? { id, ...(row as Record<string, unknown>) }
          : row,
      );
    }
  }
  const keyedRows = Object.entries(object);
  if (
    keyedRows.length &&
    keyedRows.every(
      ([, value]) =>
        value &&
        typeof value === "object" &&
        (typeof (value as Record<string, unknown>).category === "string" ||
          typeof (value as Record<string, unknown>).summary === "string"),
    )
  ) {
    return keyedRows.map(([id, row]) => ({ id, ...(row as object) }));
  }
  if (
    typeof object.category === "string" ||
    typeof object.summary === "string"
  ) {
    return [parsed];
  }
  return [];
}

function extractBalancedObjects(text: string): string[] {
  const out: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === "{") depth += 1;
      else if (char === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0) {
          out.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return out;
}
