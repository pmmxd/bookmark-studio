const SOURCE_URL = "https://ai-bot.cn/";
const CACHE_KEY = "smart-bookmark::ai-directory-cache-v2";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface AiDirectoryItem {
  id: string;
  title: string;
  description: string;
  category: string;
  url: string;
  icon: string;
  sourceUrl: string;
}

interface CacheEntry {
  at: number;
  items: AiDirectoryItem[];
}

const hasStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function fetchAiDirectory(force = false): Promise<{
  items: AiDirectoryItem[];
  fetchedAt: number;
  stale: boolean;
}> {
  const cached = await readCache();
  if (
    !force &&
    cached &&
    Date.now() - cached.at < CACHE_TTL_MS &&
    cached.items.every((item) => !!item.category)
  ) {
    return { items: cached.items, fetchedAt: cached.at, stale: false };
  }
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { Accept: "text/html" },
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`AI 工具集 HTTP ${response.status}`);
    const items = parseAiDirectoryHtml(await response.text());
    if (!items.length) throw new Error("未解析到 AI 工具链接");
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

export function parseAiDirectoryHtml(html: string): AiDirectoryItem[] {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out: AiDirectoryItem[] = [];
    let category = "热门工具";
    for (const node of doc.querySelectorAll(
      "h4, a.card[data-url]",
    )) {
      if (node.tagName === "H4" && node.querySelector('i[id^="term-"]')) {
        category =
          node.textContent?.replace(/\s+/g, " ").trim() || category;
        continue;
      }
      if (!(node instanceof HTMLAnchorElement)) continue;
      out.push(toDirectoryItem(node, category));
    }
    return out.filter(isUsableItem).filter(uniqueByUrl);
  }

  const out: AiDirectoryItem[] = [];
  const cardRe =
    /<a\s+[^>]*href="([^"]+)"[^>]*data-id="([^"]*)"[^>]*data-url="([^"]+)"[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const categories = Array.from(
    html.matchAll(
      /<i\b[^>]*id="term-\d+"[^>]*><\/i>\s*([^<]+)/gi,
    ),
  ).map((match) => ({
    index: match.index ?? 0,
    name: textOf(match[1]) || "热门工具",
  }));
  for (const match of html.matchAll(cardRe)) {
    const body = match[4];
    const title =
      textOf(body.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1]) ||
      textOf(match[0].match(/title="([^"]*)"/i)?.[1]) ||
      match[3];
    const description =
      textOf(body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]) || "";
    const iconTag = body.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const icon =
      attrOf(iconTag, "data-src") || attrOf(iconTag, "src") || "";
    out.push({
      id: match[2] || match[3],
      title,
      description,
      category: previousCategory(categories, match.index ?? 0),
      url: decodeHtml(match[3]),
      icon: new URL(decodeHtml(icon), SOURCE_URL).href,
      sourceUrl: new URL(decodeHtml(match[1]), SOURCE_URL).href,
    });
  }
  return out.filter(isUsableItem).filter(uniqueByUrl);
}

function previousCategory(
  categories: Array<{ index: number; name: string }>,
  cardIndex: number,
): string {
  let name = "热门工具";
  for (const category of categories) {
    if (category.index >= cardIndex) break;
    name = category.name;
  }
  return name;
}

function toDirectoryItem(
  anchor: HTMLAnchorElement,
  category: string,
): AiDirectoryItem {
  const url = anchor.dataset.url?.trim() ?? "";
  const icon = anchor.querySelector<HTMLImageElement>("img");
  return {
    id: anchor.dataset.id ?? url,
    title:
      anchor.querySelector("strong")?.textContent?.trim() ||
      anchor.getAttribute("title") ||
      url,
    description:
      anchor.querySelector("p")?.textContent?.trim() ||
      anchor.getAttribute("title") ||
      "",
    category,
    url,
    icon: icon?.dataset.src || icon?.src || "",
    sourceUrl: new URL(anchor.getAttribute("href") ?? "/", SOURCE_URL).href,
  };
}

function isUsableItem(item: AiDirectoryItem): boolean {
  try {
    const url = new URL(item.url);
    return /^https?:$/.test(url.protocol) && !/ai-bot\.cn$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function uniqueByUrl(item: AiDirectoryItem, index: number, list: AiDirectoryItem[]) {
  return list.findIndex((candidate) => candidate.url === item.url) === index;
}

function attrOf(tag: string, name: string): string {
  return decodeHtml(
    tag.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "",
  );
}

function textOf(value?: string): string {
  return decodeHtml((value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    if (hasStorage) {
      const saved = await chrome.storage.local.get(CACHE_KEY);
      return (saved[CACHE_KEY] as CacheEntry | undefined) ?? null;
    }
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  if (hasStorage) {
    await chrome.storage.local.set({ [CACHE_KEY]: entry });
  } else {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  }
}
