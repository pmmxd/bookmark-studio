import type { FlatBookmark } from "@/types";

const CACHE_KEY = "smart-bookmark::github-readme-context";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_README_CHARS = 1800;
const REQUEST_GAP_MS = 300;

export interface GitHubRepoContext {
  repo: string;
  readmeExcerpt: string;
}

interface CacheEntry {
  at: number;
  data: GitHubRepoContext;
}

type CacheMap = Record<string, CacheEntry>;

const hasStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export function parseGitHubRepo(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^(www\.)?github\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const reserved = new Set([
      "about",
      "explore",
      "features",
      "login",
      "marketplace",
      "notifications",
      "orgs",
      "pricing",
      "search",
      "settings",
      "sponsors",
      "topics",
      "trending",
    ]);
    if (reserved.has(parts[0].toLowerCase())) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

export async function enrichGitHubBookmarks(
  bookmarks: FlatBookmark[],
  signal?: AbortSignal,
): Promise<Record<string, GitHubRepoContext>> {
  const bookmarkRepos = new Map<string, string>();
  for (const bookmark of bookmarks) {
    const repo = parseGitHubRepo(bookmark.url);
    if (repo) bookmarkRepos.set(bookmark.id, repo);
  }
  if (!bookmarkRepos.size) return {};

  const repos = Array.from(new Set(bookmarkRepos.values()));
  const cache = await readCache();
  const byRepo = new Map<string, GitHubRepoContext>();
  const missing: string[] = [];
  for (const repo of repos) {
    const hit = cache[repo];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      byRepo.set(repo, hit.data);
    } else {
      missing.push(repo);
    }
  }

  // Keep GitHub requests sequential and inside the current AI batch.
  for (let index = 0; index < missing.length; index += 1) {
    const repo = missing[index];
    try {
      const data = await fetchGitHubReadme(repo, signal);
      byRepo.set(repo, data);
      cache[repo] = { at: Date.now(), data };
    } catch (err) {
      console.warn("[github-readme] fetch failed", repo, err);
    }
    if (index < missing.length - 1) await delay(REQUEST_GAP_MS, signal);
  }
  if (missing.length) await writeCache(cache);

  const out: Record<string, GitHubRepoContext> = {};
  for (const [bookmarkId, repo] of bookmarkRepos) {
    const data = byRepo.get(repo);
    if (data) out[bookmarkId] = data;
  }
  return out;
}

async function fetchGitHubReadme(
  repo: string,
  signal: AbortSignal | undefined,
): Promise<GitHubRepoContext> {
  const response = await fetchWithTimeout(
    `https://github.com/${repo}`,
    12000,
    {
      Accept: "text/html",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
    signal,
  );
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const html = await response.text();
  const readmeExcerpt = extractReadmeExcerpt(html);
  if (!readmeExcerpt) throw new Error("README 内容为空");
  return { repo, readmeExcerpt };
}

export function extractReadmeExcerpt(html: string): string {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const article = doc.querySelector(
      "article.markdown-body, [data-testid='readme'] article, .markdown-body",
    );
    if (article?.textContent) {
      return article.textContent
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_README_CHARS);
    }
  }

  // Test/runtime fallback when DOMParser is unavailable.
  const article = html.match(
    /<article[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/article>/i,
  )?.[1];
  if (!article) return "";
  return article
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_README_CHARS);
}

function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return fetch(url, {
    headers,
    signal: controller.signal,
    credentials: "omit",
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function readCache(): Promise<CacheMap> {
  if (!hasStorage) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as CacheMap) : {};
    } catch {
      return {};
    }
  }
  const saved = await chrome.storage.local.get(CACHE_KEY);
  return (saved[CACHE_KEY] as CacheMap | undefined) ?? {};
}

async function writeCache(cache: CacheMap): Promise<void> {
  if (!hasStorage) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    return;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}
