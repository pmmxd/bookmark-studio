const API_URL = "https://aihot.news/api/v1/items";
const CACHE_KEY = "smart-bookmark::ai-hot-cache";
const LEADERBOARD_CACHE_KEY = "smart-bookmark::aihot-leaderboard-cache";
const CACHE_TTL_MS = 10 * 60 * 1000;
const LEADERBOARD_TTL_MS = 15 * 60 * 1000;

export interface AiHotItem {
  id: string;
  title: string;
  summary: string;
  reason: string;
  source: string;
  category: string;
  score: number;
  publishedAt: string;
  aihotUrl: string;
  originalUrl: string;
}

export interface AiLeaderboardItem {
  rank: number;
  name: string;
  url: string;
}

interface CacheEntry {
  at: number;
  items: AiHotItem[];
}

const hasStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function fetchAiHot(force = false): Promise<{
  items: AiHotItem[];
  fetchedAt: number;
  stale: boolean;
}> {
  const cached = await readCache();
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { items: cached.items, fetchedAt: cached.at, stale: false };
  }
  try {
    const url = new URL(API_URL);
    url.searchParams.set("limit", "30");
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`AIHOT HTTP ${response.status}`);
    const body = (await response.json()) as {
      items?: Array<{
        id?: string;
        title?: string;
        summary?: string;
        reason?: string;
        source?: { name?: string };
        links?: { aihot?: string; original?: string };
        category?: string;
        score?: number;
        publishedAt?: string;
      }>;
    };
    const items = (body.items ?? [])
      .map((item) => ({
        id: item.id ?? "",
        title: item.title ?? "",
        summary: item.summary ?? "",
        reason: item.reason ?? "",
        source: item.source?.name ?? "AIHOT",
        category: item.category ?? "",
        score: item.score ?? 0,
        publishedAt: item.publishedAt ?? "",
        aihotUrl: item.links?.aihot ?? "https://aihot.news/",
        originalUrl: item.links?.original ?? item.links?.aihot ?? "https://aihot.news/",
      }))
      .filter((item) => item.id && item.title);
    if (!items.length) throw new Error("AIHOT 没有返回内容");
    const next = { at: Date.now(), items };
    await writeCache(next);
    return { items, fetchedAt: next.at, stale: false };
  } catch (err) {
    if (cached) {
      return { items: cached.items, fetchedAt: cached.at, stale: true };
    }
    throw err;
  }
}

export async function fetchAiLeaderboard(force = false): Promise<{
  items: AiLeaderboardItem[];
  fetchedAt: number;
  stale: boolean;
}> {
  const cached = await readCacheEntry<AiLeaderboardItem[]>(
    LEADERBOARD_CACHE_KEY,
  );
  if (!force && cached && Date.now() - cached.at < LEADERBOARD_TTL_MS) {
    return { items: cached.items, fetchedAt: cached.at, stale: false };
  }
  try {
    const response = await fetch("https://aihot.news/leaderboard", {
      headers: { Accept: "text/html" },
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error(`AIHOT Leaderboard HTTP ${response.status}`);
    }
    const items = parseAiLeaderboardHtml(await response.text());
    if (!items.length) throw new Error("AIHOT 排行榜没有解析到模型");
    const next = { at: Date.now(), items };
    await writeCacheEntry(LEADERBOARD_CACHE_KEY, next);
    return { items, fetchedAt: next.at, stale: false };
  } catch (err) {
    if (cached) {
      return { items: cached.items, fetchedAt: cached.at, stale: true };
    }
    throw err;
  }
}

export function parseAiLeaderboardHtml(html: string): AiLeaderboardItem[] {
  const jsonLdBlocks = Array.from(
    html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ).map((match) => match[1]);
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block) as unknown;
      const items = findLeaderboardItems(parsed);
      if (items.length) return items;
    } catch {}
  }

  const out: AiLeaderboardItem[] = [];
  const itemRe =
    /"position":(\d+),"name":"((?:\\.|[^"\\])*)","url":"((?:\\.|[^"\\])*)"/g;
  for (const match of html.matchAll(itemRe)) {
    try {
      out.push({
        rank: Number(match[1]),
        name: JSON.parse(`"${match[2]}"`) as string,
        url: JSON.parse(`"${match[3]}"`) as string,
      });
    } catch {}
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function findLeaderboardItems(value: unknown): AiLeaderboardItem[] {
  const queue: unknown[] = [value];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    const object = current as Record<string, unknown>;
    if (Array.isArray(object.itemListElement)) {
      const rows = object.itemListElement
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          return {
            rank: Number(row.position),
            name: String(row.name ?? ""),
            url: String(row.url ?? ""),
          };
        })
        .filter(
          (item): item is AiLeaderboardItem =>
            !!item && !!item.rank && !!item.name && !!item.url,
        );
      if (rows.length) return rows.sort((a, b) => a.rank - b.rank);
    }
    queue.push(...Object.values(object));
  }
  return [];
}

async function readCache(): Promise<CacheEntry | null> {
  return readCacheEntry<AiHotItem[]>(CACHE_KEY);
}

async function readCacheEntry<T>(key: string): Promise<{ at: number; items: T } | null> {
  try {
    if (hasStorage) {
      const saved = await chrome.storage.local.get(key);
      return (saved[key] as { at: number; items: T } | undefined) ?? null;
    }
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { at: number; items: T }) : null;
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  await writeCacheEntry(CACHE_KEY, entry);
}

async function writeCacheEntry<T>(
  key: string,
  entry: { at: number; items: T },
): Promise<void> {
  if (hasStorage) {
    await chrome.storage.local.set({ [key]: entry });
  } else {
    localStorage.setItem(key, JSON.stringify(entry));
  }
}
