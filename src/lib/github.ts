import type {
  TrendingMode,
  TrendingRange,
  TrendingRepo,
  TrendingSource,
  TrendingSort,
} from "@/types";

const CACHE_KEY = "smart-bookmark::github-trending-cache";
const CACHE_TTL_MS = 60 * 60 * 1000;

/** 每个仓库的历史 star 快照，用于计算「自上次快照以来的 star 增量」 */
const SNAPSHOT_KEY = "smart-bookmark::github-repo-snapshots";
/** 仅当上次快照的年龄 ≥ 此阈值时才展示 delta（避免频繁刷新时显示无意义的 +0） */
const SNAPSHOT_MIN_AGE_MS = 30 * 60 * 1000;
/** 超过此年龄的快照会被重置，避免无限增长 */
const SNAPSHOT_PRUNE_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  at: number;
  data: TrendingRepo[];
}
type CacheMap = Record<string, CacheEntry>;

interface RepoSnapshot {
  stars: number;
  at: number;
}
type SnapshotMap = Record<string, RepoSnapshot>;

const hasStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

async function readCache(): Promise<CacheMap> {
  if (!hasStorage) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as CacheMap) : {};
    } catch {
      return {};
    }
  }
  const { [CACHE_KEY]: saved } = await chrome.storage.local.get(CACHE_KEY);
  return (saved as CacheMap) ?? {};
}

async function writeCache(next: CacheMap): Promise<void> {
  if (!hasStorage) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    return;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: next });
}

async function readSnapshots(): Promise<SnapshotMap> {
  if (!hasStorage) {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      return raw ? (JSON.parse(raw) as SnapshotMap) : {};
    } catch {
      return {};
    }
  }
  const { [SNAPSHOT_KEY]: saved } =
    await chrome.storage.local.get(SNAPSHOT_KEY);
  return (saved as SnapshotMap) ?? {};
}

async function writeSnapshots(next: SnapshotMap): Promise<void> {
  if (!hasStorage) {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
    return;
  }
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: next });
}

/** 时间窗内「新建仓库」的天数，用于 UI 与 Search API。 */
export function rangeToWindowDays(range: TrendingRange): number {
  return range === "daily"
    ? 1
    : range === "weekly"
      ? 7
      : range === "monthly"
        ? 30
        : 365;
}

/** 根据 range 返回 GitHub Search API 用的 created 起始日期（YYYY-MM-DD）。 */
export function rangeToSinceDate(range: TrendingRange, now = new Date()): string {
  const days = rangeToWindowDays(range);
  const d = new Date(now.getTime() - days * 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export interface FetchTrendingOptions {
  range: TrendingRange;
  /** 热门模式：created=时间窗内新建，hottest=时间窗内活跃仓库 */
  mode?: TrendingMode;
  /**
   * 客户端排序口径。`auto` 时根据 mode 自适应：
   * created → velocity-since-creation；hottest → total-stars。
   */
  sort?: TrendingSort;
  /** api = 现有 Search API 聚合；github = github.com/trending 官方页。 */
  source?: TrendingSource;
  /** 为空即全部语言。使用 GitHub `language:xxx` 限定词。 */
  language?: string;
  /** 返回数量上限，默认 30，最大 100。 */
  limit?: number;
  /** GitHub Personal Access Token，可选，用于提高限额。 */
  token?: string;
  /** 是否强制刷新（跳过缓存）。 */
  force?: boolean;
  signal?: AbortSignal;
}

/**
 * 缓存 schema 版本前缀。当 TrendingRepo 结构变化时升版本，
 * 以自动无效化老版本的缓存条目。
 *
 * - v3: 统一按 starsPerDay 排序
 * - v4: 排序参数化（auto/velocity-since-creation/recent-growth/total-stars），
 *       hottest 模式候选池收紧到 created>5y，
 *       新增 recentVelocity 字段（基于本地快照）
 */
const CACHE_SCHEMA = "v5";

function buildCacheKey(o: FetchTrendingOptions): string {
  // 注意：sort 不进入缓存 key —— sort 只决定客户端排序，
  // 候选池本身（mode/range/language/limit）才决定服务端拉取的内容。
  if ((o.source ?? "api") === "github") {
    return `${CACHE_SCHEMA}::github::${o.range}::${(o.language ?? "").toLowerCase()}::${o.limit ?? 30}`;
  }
  return `${CACHE_SCHEMA}::${o.source ?? "api"}::${o.mode ?? "created"}::${o.range}::${(o.language ?? "").toLowerCase()}::${o.limit ?? 30}`;
}

/**
 * Hottest 模式候选池的最大年龄（年）。把活跃但超老的项目（如 React 12 年）
 * 排除掉，避免它们用极小的 starsPerDay 把列表稀释。
 */
const HOTTEST_MAX_AGE_YEARS = 5;

/** 兼容旧版缓存：若缺少 starsPerDay，从 stars + createdAt 现算补上。 */
function rehydrateRepo(r: TrendingRepo): TrendingRepo {
  if (typeof r.starsPerDay === "number" && Number.isFinite(r.starsPerDay)) {
    return r;
  }
  const createdMs = r.createdAt ? Date.parse(r.createdAt) : NaN;
  const ageDays = Number.isFinite(createdMs)
    ? Math.max(1, (Date.now() - createdMs) / 86_400_000)
    : 1;
  return { ...r, starsPerDay: (r.stars ?? 0) / ageDays };
}

export async function fetchTrending(
  opts: FetchTrendingOptions,
): Promise<TrendingRepo[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const source = opts.source ?? "api";
  const mode: TrendingMode = opts.mode ?? "created";
  const sort = resolveSort(opts.sort, mode);
  const key = buildCacheKey({ ...opts, limit });

  if (!opts.force) {
    const cache = await readCache();
    const hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      // 缓存命中：候选池没变，仅用本地最新快照刷新 recentVelocity，
      // 然后在本地按用户当前选择的 sort 重排、切片即可。
      // 注意：缓存的是完整候选池（≤ candidateLimit），而非 sliced 后的列表，
      // 这样切换 sort 时不会丢失边缘候选项。
      const fresh = hit.data.map(rehydrateRepo);
      if (source === "github") return fresh.slice(0, limit);
      await applyDeltaFromSnapshots(fresh);
      sortRepos(fresh, sort);
      return fresh.slice(0, limit);
    }
  }

  if (source === "github") {
    const data = await fetchGithubTrendingPage(opts);
    const cache = await readCache();
    cache[key] = { at: Date.now(), data };
    await writeCache(cache);
    return data.slice(0, limit);
  }

  const since = rangeToSinceDate(opts.range);
  const candidateLimit = Math.min(100, Math.max(limit, 50, limit * 5));
  const qs = buildCandidateQuery({
    mode,
    since,
    language: opts.language,
  });
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", qs);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(candidateLimit));

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(url.toString(), { headers, signal: opts.signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const snippet = text.slice(0, 200);
    if (res.status === 403 && /rate limit/i.test(text)) {
      throw new Error(
        `GitHub 限流（未认证 60/h，已用尽）。到设置里填 Personal Access Token 可提升到 5000/h。`,
      );
    }
    throw new Error(`GitHub ${res.status}: ${snippet}`);
  }
  const json = (await res.json()) as { items?: RawGithubRepo[] };
  const pool: TrendingRepo[] = (json.items ?? []).map(normalizeRepo);

  // 先 apply 快照差，把 recentVelocity 填进每条记录
  await applyDeltaFromSnapshots(pool);

  // 缓存写入完整候选池（不切片），让后续切换 sort 时仍能看到边缘候选项。
  const cache = await readCache();
  cache[key] = { at: Date.now(), data: pool };
  await writeCache(cache);

  // 当前调用按用户的 sort 排序 + 切片返回
  sortRepos(pool, sort);
  return pool.slice(0, limit);
}

async function fetchGithubTrendingPage(
  opts: FetchTrendingOptions,
): Promise<TrendingRepo[]> {
  const since =
    opts.range === "daily"
      ? "daily"
      : opts.range === "weekly"
        ? "weekly"
        : "monthly";
  const url = new URL(
    opts.language
      ? `/trending/${encodeURIComponent(opts.language.trim().toLowerCase())}`
      : "/trending",
    "https://github.com",
  );
  url.searchParams.set("since", since);
  const response = await fetch(url, {
    headers: { Accept: "text/html" },
    signal: opts.signal,
  });
  if (!response.ok) {
    throw new Error(`GitHub Trending HTTP ${response.status}`);
  }
  const repos = parseGithubTrendingHtml(await response.text());
  if (!repos.length) throw new Error("GitHub Trending 页面没有解析到仓库");
  return repos;
}

export function parseGithubTrendingHtml(html: string): TrendingRepo[] {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll("article.Box-row"))
      .map((article) => {
        const href = article.querySelector<HTMLAnchorElement>("h2 a")?.href ?? "";
        const fullName = repoNameFromHref(href);
        if (!fullName) return null;
        const description =
          article.querySelector("p")?.textContent?.replace(/\s+/g, " ").trim() ??
          "";
        const language =
          article.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim() ??
          "";
        const stars = parseCount(
          article.querySelector<HTMLAnchorElement>('a[href$="/stargazers"]')
            ?.textContent ?? "",
        );
        const forks = parseCount(
          article.querySelector<HTMLAnchorElement>('a[href$="/forks"]')
            ?.textContent ?? "",
        );
        return toOfficialRepo(fullName, description, language, stars, forks);
      })
      .filter((repo): repo is TrendingRepo => !!repo);
  }

  const out: TrendingRepo[] = [];
  const articleRe =
    /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  for (const match of html.matchAll(articleRe)) {
    const article = match[1];
    const repoHref =
      article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const fullName = repoNameFromHref(repoHref);
    if (!fullName) continue;
    const description = textOnly(
      article.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1],
    );
    const language =
      article.match(
        /itemprop="programmingLanguage"[^>]*>([^<]+)</i,
      )?.[1]?.trim() ?? "";
    const stars = parseCount(
      article.match(
        /href="[^"]*\/stargazers"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/i,
      )?.[1],
    );
    const forks = parseCount(
      article.match(
        /href="[^"]*\/forks"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/i,
      )?.[1],
    );
    out.push(toOfficialRepo(fullName, description, language, stars, forks));
  }
  return out;
}

function toOfficialRepo(
  fullName: string,
  description: string,
  language: string,
  stars: number,
  forks: number,
): TrendingRepo {
  const [owner, name] = fullName.split("/");
  return {
    id: stableRepoId(fullName),
    fullName,
    owner,
    name,
    description,
    language,
    stars,
    forks,
    url: `https://github.com/${fullName}`,
    avatar: `https://github.com/${owner}.png?size=64`,
    topics: [],
    createdAt: "",
    pushedAt: "",
    starsPerDay: 0,
  };
}

function repoNameFromHref(href: string): string {
  try {
    const url = new URL(href, "https://github.com");
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "";
  } catch {
    return "";
  }
}

function parseCount(value?: string | null): number {
  const number = (value ?? "").replace(/[^\d]/g, "");
  return number ? Number(number) : 0;
}

function textOnly(value?: string): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stableRepoId(fullName: string): number {
  let hash = 2166136261;
  for (let index = 0; index < fullName.length; index += 1) {
    hash ^= fullName.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 构造 GitHub Search API 的查询串。
 *
 * - created 模式：拉取「时间窗内新建的仓库」（`created:>since`），
 *   分母（仓库年龄）天然受时间窗限制，starsPerDay 口径合理。
 *
 * - hottest 模式：拉取「时间窗内有推送、且年龄 ≤ 5 年」的活跃仓库，
 *   通过 `created:>X` 排除超老项目（D 方案），避免巨型老仓库
 *   用极小的 starsPerDay 稀释列表。
 */
function buildCandidateQuery(o: {
  mode: TrendingMode;
  since: string;
  language?: string;
}): string {
  const qs: string[] = [];
  if (o.mode === "created") {
    qs.push(`created:>${o.since}`, "stars:>5");
  } else {
    const oldestCreated = new Date(
      Date.now() - HOTTEST_MAX_AGE_YEARS * 365 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    qs.push(
      `pushed:>${o.since}`,
      "stars:>50",
      `created:>${oldestCreated}`,
    );
  }
  if (o.language?.trim()) {
    qs.push(`language:${encodeQueryToken(o.language.trim())}`);
  }
  return qs.join(" ");
}

/** 把 `auto` 解析成具体排序：created → 创建以来均速；hottest → 总 star。 */
export function resolveSort(
  sort: TrendingSort | undefined,
  mode: TrendingMode,
): Exclude<TrendingSort, "auto"> {
  const s = sort ?? "auto";
  if (s !== "auto") return s;
  return mode === "hottest" ? "total-stars" : "velocity-since-creation";
}

/** 在本地按用户选择的口径排序（in-place）。 */
export function sortRepos(
  data: TrendingRepo[],
  sort: Exclude<TrendingSort, "auto">,
): void {
  switch (sort) {
    case "total-stars":
      data.sort(
        (a, b) =>
          b.stars - a.stars ||
          (b.starsPerDay ?? 0) - (a.starsPerDay ?? 0),
      );
      return;
    case "recent-growth":
      data.sort((a, b) => {
        // 主键：recentVelocity（没快照的退到最后）
        const av = a.recentVelocity ?? -1;
        const bv = b.recentVelocity ?? -1;
        if (bv !== av) return bv - av;
        // 次键：starsPerDay（兜底，让首次刷新也有合理顺序）
        const apd = a.starsPerDay ?? 0;
        const bpd = b.starsPerDay ?? 0;
        if (bpd !== apd) return bpd - apd;
        return b.stars - a.stars;
      });
      return;
    case "velocity-since-creation":
    default:
      data.sort(
        (a, b) =>
          (b.starsPerDay ?? 0) - (a.starsPerDay ?? 0) ||
          b.stars - a.stars,
      );
      return;
  }
}

/**
 * 读取上一轮快照 → 为每个仓库计算 star 增量与近期速度 → 更新并写回快照。
 *
 * 同时填充：
 * - `starsDelta`：自上次快照以来的 star 数变化（用于卡片角标）
 * - `recentVelocity`：自上次快照以来的 ★/天（用于 recent-growth 排序）
 *
 * 仅对年龄 ≥ SNAPSHOT_MIN_AGE_MS 的快照启用，避免刚刷新又刷新导致 +0/无穷大。
 */
async function applyDeltaFromSnapshots(list: TrendingRepo[]): Promise<void> {
  const snapshots = await readSnapshots();
  const now = Date.now();
  const next: SnapshotMap = { ...snapshots };

  for (const repo of list) {
    const key = String(repo.id);
    const prev = snapshots[key];
    if (prev && now - prev.at >= SNAPSHOT_MIN_AGE_MS) {
      const delta = repo.stars - prev.stars;
      const sinceMs = now - prev.at;
      const sinceDays = sinceMs / 86_400_000;
      // recentVelocity 在 delta=0 时也要给（=0），这样仍能参与排序，
      // 让没有近期增长的项目自然沉到底部。负数（取消 star）按 0 处理。
      if (sinceDays > 0) {
        repo.recentVelocity = Math.max(0, delta) / sinceDays;
      }
      if (delta > 0) {
        repo.starsDelta = { stars: delta, sinceMs };
      }
    }
    next[key] = { stars: repo.stars, at: now };
  }

  // 清理长期未出现的快照，避免 storage 无限膨胀
  for (const k of Object.keys(next)) {
    if (now - next[k].at > SNAPSHOT_PRUNE_MS) delete next[k];
  }

  await writeSnapshots(next);
}

/** 检查给定列表中是否已有任何项填充了 recentVelocity（即本地有快照可用）。 */
export function hasRecentVelocityData(list: TrendingRepo[]): boolean {
  return list.some((r) => typeof r.recentVelocity === "number");
}

export async function clearTrendingCache(): Promise<void> {
  if (!hasStorage) {
    localStorage.removeItem(CACHE_KEY);
    return;
  }
  await chrome.storage.local.remove(CACHE_KEY);
}

/** 把 trending 列表渲染成适合塞进 AI prompt 的 Markdown 摘要。 */
export function trendingToMarkdown(
  list: TrendingRepo[],
  meta: {
    range: TrendingRange;
    language?: string;
    mode?: TrendingMode;
    source?: TrendingSource;
  },
): string {
  const rangeLabel = {
    daily: "今日",
    weekly: "本周",
    monthly: "本月",
    yearly: "本年",
  }[meta.range];
  const modeLabel =
    meta.source === "github"
      ? "官方趋势"
      : (meta.mode ?? "created") === "hottest"
        ? "最热门"
        : "新建";
  const header = `# GitHub ${rangeLabel}${modeLabel}仓库${
    meta.language ? `（${meta.language}）` : ""
  } — 共 ${list.length} 条`;
  const body = list
    .map((r, i) => {
      const desc = r.description ? ` — ${r.description}` : "";
      const lang = r.language ? ` [${r.language}]` : "";
      return `${i + 1}. **${r.fullName}** (★${r.stars})${lang}${desc}\n   ${r.url}`;
    })
    .join("\n");
  return `${header}\n\n${body}`;
}

function encodeQueryToken(s: string): string {
  if (/\s/.test(s)) return `"${s}"`;
  return s;
}

interface RawGithubRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  created_at: string;
  pushed_at: string;
  topics?: string[];
  owner: { login: string; avatar_url: string };
}

function normalizeRepo(raw: RawGithubRepo): TrendingRepo {
  const stars = raw.stargazers_count ?? 0;
  const createdMs = raw.created_at ? Date.parse(raw.created_at) : NaN;
  const ageDays = Number.isFinite(createdMs)
    ? Math.max(1, (Date.now() - createdMs) / 86_400_000)
    : 1;
  const starsPerDay = stars / ageDays;
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    description: raw.description ?? "",
    language: raw.language ?? "",
    stars,
    forks: raw.forks_count ?? 0,
    url: raw.html_url,
    avatar: raw.owner.avatar_url,
    topics: raw.topics ?? [],
    createdAt: raw.created_at,
    pushedAt: raw.pushed_at,
    starsPerDay,
  };
}

/** 常用语言颜色（与 GitHub 官方 linguist 大致对齐，留作 UI 左色边等） */
export const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00B4AB",
  Lua: "#000080",
  Zig: "#ec915c",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  Elixir: "#6e4a7e",
  Solidity: "#AA6746",
};

export function langColor(lang: string): string {
  return LANG_COLORS[lang] || "#8a8f98";
}

/** 提供给 Discover UI 的常用语言下拉选项。 */
export const COMMON_LANGUAGES: string[] = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "Kotlin",
  "Swift",
  "C++",
  "C",
  "C#",
  "Ruby",
  "PHP",
  "Shell",
  "HTML",
  "CSS",
  "Vue",
  "Svelte",
  "Dart",
  "Lua",
  "Zig",
];
