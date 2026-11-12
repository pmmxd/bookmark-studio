import { chat } from "@/lib/ai";
import { loadBookmarkMeta, saveBookmarkMeta } from "@/lib/bookmarkMeta";
import {
  parseOrganizerResponse,
  type OrganizerSuggestion,
} from "@/lib/bookmarkOrganizerParser";
import { updateBookmark } from "@/lib/bookmarks";
import {
  enrichGitHubBookmarks,
  type GitHubRepoContext,
} from "@/lib/githubContext";
import { BOOKMARK_GROUPS } from "@/lib/bookmarkTaxonomy";
import { classifyBookmarkTag } from "@/lib/bookmarkTagGroups";
import {
  buildTaggedTitle,
  getBookmarkPurpose,
  getBookmarkTagParts,
  mergeTags,
  sanitizeBaseTitle,
} from "@/lib/bookmarkTitle";
import { normalizeBookmarkTags } from "@/lib/bookmarkTaxonomy";
import { inferTagHintsFromText } from "./bookmarkTagHints.ts";
import type {
  BookmarkAiMeta,
  FlatBookmark,
  Settings,
} from "@/types";

const BATCH_SIZE = 5;
const REQUEST_IDLE_TIMEOUT_MS = 45_000;
const REQUEST_HARD_TIMEOUT_MS = 240_000;
const MAX_CONSECUTIVE_SERVICE_FAILURES = 3;
const ORGANIZER_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          group: { type: "string", enum: [...BOOKMARK_GROUPS] },
          category: { type: "string" },
          title: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
            minItems: 3,
            maxItems: 5,
          },
          purpose: { type: "string" },
          summary: { type: "string" },
        },
        required: [
          "id",
          "group",
          "category",
          "title",
          "tags",
          "purpose",
          "summary",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export interface OrganizeResult {
  items: BookmarkAiMeta[];
  organized: number;
  renamed: number;
  failed: number;
  failedBookmarkIds: string[];
  stoppedEarly: boolean;
  stopReason?: string;
}

export async function organizeBookmarks(
  bookmarks: FlatBookmark[],
  settings: Settings,
  onProgress?: (done: number, total: number, failed: number) => void,
): Promise<OrganizeResult> {
  if (settings.aiProvider === "none") {
    throw new Error("请先在设置中启用 AI 或 Ollama");
  }
  if (!bookmarks.length) {
    return {
      items: [],
      organized: 0,
      renamed: 0,
      failed: 0,
      failedBookmarkIds: [],
      stoppedEarly: false,
    };
  }

  const existingMeta = await loadBookmarkMeta();
  const items: BookmarkAiMeta[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  let renamed = 0;
  let done = 0;
  let stoppedEarly = false;
  let stopReason = "";
  let consecutiveServiceFailures = 0;

  for (let start = 0; start < bookmarks.length; start += BATCH_SIZE) {
    const batch = bookmarks.slice(start, start + BATCH_SIZE);
    let github: Record<string, GitHubRepoContext> = {};
    try {
      github = await enrichGitHubBookmarks(batch);
    } catch (err) {
      console.warn("github context enrichment failed", err);
    }

    let suggestions: OrganizerSuggestion[] = [];
    try {
      suggestions = await analyzeWithFallback(
        batch,
        settings,
        github,
        failures,
        existingMeta,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordFailures(batch, failures, message);
      consecutiveServiceFailures += 1;
      done = Math.min(done + batch.length, bookmarks.length);
      onProgress?.(done, bookmarks.length, failures.length);
      if (
        isAiServiceError(message) &&
        consecutiveServiceFailures >= MAX_CONSECUTIVE_SERVICE_FAILURES
      ) {
        stoppedEarly = true;
        stopReason = `连续 ${MAX_CONSECUTIVE_SERVICE_FAILURES} 批无法连接 AI：${message}`;
        break;
      }
      await delay(Math.min(1000 * 2 ** (consecutiveServiceFailures - 1), 5000));
      continue;
    }

    const now = Date.now();
    const batchMeta: BookmarkAiMeta[] = [];
    for (const suggestion of suggestions) {
      const bookmark = batch.find(
        (item) => item.id === suggestion.bookmarkId,
      );
      if (!bookmark) continue;
      const existing = existingMeta[bookmark.id];
      const previous = getBookmarkTagParts(bookmark.title, existing);
      const manualTags = previous.manualTags;
      const blockedTags = normalizeBookmarkTags(existing?.blockedTags);
      const aiLimit = Math.max(0, 5 - manualTags.length);
      const hintTitle = previous.baseTitle;
      const hintText = [
        hintTitle,
        bookmark.url,
        bookmark.path,
        github[bookmark.id]?.readmeExcerpt ?? "",
        existing?.summary ?? "",
        existing?.purpose ?? "",
        suggestion.summary,
        suggestion.purpose,
      ].join(" ");
      const hintedTags = inferTagHintsFromText(hintText, hintTitle);
      const aiTags = normalizeBookmarkTags([
        ...hintedTags,
        ...suggestion.tags,
      ])
        .filter(
          (tag) =>
            !manualTags.includes(tag) && !blockedTags.includes(tag),
        )
        .slice(0, aiLimit);
      const tags = mergeTags(manualTags, aiTags);
      const baseTitle =
        sanitizeBaseTitle(suggestion.title) || previous.baseTitle;
      const purpose = existing?.purposeLocked
        ? getBookmarkPurpose(existing)
        : suggestion.purpose || suggestion.summary;
      batchMeta.push({
        bookmarkId: bookmark.id,
        url: bookmark.url,
        title: baseTitle,
        baseTitle,
        group:
          suggestion.group ??
          classifyBookmarkTag(suggestion.category, suggestion.category),
        category: suggestion.category,
        tags,
        manualTags,
        aiTags,
        blockedTags,
        tagSchemaVersion: 2,
        purpose,
        purposeSource: existing?.purposeLocked ? "manual" : "ai",
        purposeLocked: existing?.purposeLocked,
        legacyTags: Array.from(
          new Set([
            ...previous.legacyTags,
            ...normalizeBookmarkTags(suggestion.tags).slice(aiLimit),
          ]),
        ).filter((tag) => !tags.includes(tag)),
        summary: suggestion.summary,
        analyzedAt: now,
      });
      const nextTitle = buildTaggedTitle(baseTitle, tags);
      if (nextTitle !== bookmark.title) {
        try {
          await updateBookmark(bookmark.id, { title: nextTitle });
          renamed += 1;
        } catch (err) {
          console.warn("bookmark rename failed", bookmark.id, err);
        }
      }
    }

    if (batchMeta.length) {
      try {
        await saveBookmarkMeta(batchMeta);
      } catch (err) {
        stoppedEarly = true;
        stopReason = `AI 结果无法保存，已停止以避免假进度：${
          err instanceof Error ? err.message : String(err)
        }`;
        break;
      }
      items.push(...batchMeta);
      consecutiveServiceFailures = 0;
    }

    done = Math.min(done + batch.length, bookmarks.length);
    onProgress?.(done, bookmarks.length, failures.length);
  }

  return {
    items,
    organized: items.length,
    renamed,
    failed: new Set(failures.map((item) => item.id)).size,
    failedBookmarkIds: Array.from(new Set(failures.map((item) => item.id))),
    stoppedEarly,
    stopReason: stopReason || undefined,
  };
}

async function analyzeWithFallback(
  batch: FlatBookmark[],
  settings: Settings,
  github: Record<string, GitHubRepoContext>,
  failures: Array<{ id: string; error: string }>,
  existingMeta: Awaited<ReturnType<typeof loadBookmarkMeta>>,
): Promise<OrganizerSuggestion[]> {
  if (!batch.length) return [];
  try {
    const suggestions = await requestSuggestionsWithRetry(
      batch,
      settings,
      github,
      existingMeta,
    );
    const received = new Set(
      suggestions.map((suggestion) => suggestion.bookmarkId),
    );
    const missing = batch.filter((bookmark) => !received.has(bookmark.id));
    if (!missing.length) return suggestions;
    if (batch.length === 1) {
      throw new Error("AI 未返回该书的完整结构");
    }
    const nested = await analyzeWithFallback(
      missing,
      settings,
      github,
      failures,
      existingMeta,
    );
    return mergeSuggestions(suggestions, nested);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAiServiceError(message)) throw err;
    if (batch.length === 1) {
      failures.push({ id: batch[0].id, error: message });
      return [];
    }
    const middle = Math.ceil(batch.length / 2);
    const left = await analyzeWithFallback(
      batch.slice(0, middle),
      settings,
      github,
      failures,
      existingMeta,
    );
    const right = await analyzeWithFallback(
      batch.slice(middle),
      settings,
      github,
      failures,
      existingMeta,
    );
    return mergeSuggestions(left, right);
  }
}

async function requestSuggestionsWithRetry(
  batch: FlatBookmark[],
  settings: Settings,
  github: Record<string, GitHubRepoContext>,
  existingMeta: Awaited<ReturnType<typeof loadBookmarkMeta>>,
): Promise<OrganizerSuggestion[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestSuggestions(batch, settings, github, existingMeta);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (/超时/.test(message)) throw err;
      if (attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
    }
  }
  throw lastError;
}

async function requestSuggestions(
  batch: FlatBookmark[],
  settings: Settings,
  github: Record<string, GitHubRepoContext>,
  existingMeta: Awaited<ReturnType<typeof loadBookmarkMeta>>,
): Promise<OrganizerSuggestion[]> {
  const allowed = Object.fromEntries(batch.map((item) => [item.id, item.url]));
  const preferredTags = collectPreferredTags(existingMeta);
  const payload = batch.map((item) => {
    const meta = existingMeta[item.id];
    const tagParts = getBookmarkTagParts(item.title, meta);
    return {
      id: item.id,
      title: tagParts.baseTitle,
      url: item.url,
      folder: item.path,
      github: github[item.id],
      manualTags: tagParts.manualTags,
      lockedPurpose: meta?.purposeLocked
        ? getBookmarkPurpose(meta)
        : undefined,
    };
  });
  const controller = new AbortController();
  let idleTimer = 0;
  const resetIdleTimer = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(
      () => controller.abort(),
      REQUEST_IDLE_TIMEOUT_MS,
    );
  };
  resetIdleTimer();
  const hardTimer = window.setTimeout(
    () => controller.abort(),
    REQUEST_HARD_TIMEOUT_MS,
  );
  try {
    const response = await chat({
      settings,
      jsonMode: true,
      jsonSchema: ORGANIZER_JSON_SCHEMA,
      signal: controller.signal,
      onDelta: resetIdleTimer,
      messages: [
        {
          role: "system",
          content: [
            "你是书签整理助手。只输出一个 JSON 对象，不要 Markdown。",
            '格式：{"items":[{"id":"原id","group":"一级分类","category":"细分分类","title":"用途化名称","tags":["标签"],"purpose":"用途备注","summary":"简介"}]}',
            `group 必须严格从以下清单选择一个：${BOOKMARK_GROUPS.join("、")}。`,
            "group 按用户访问该网址的主要目的分类，不按底层实现技术分类。",
            "大模型、LLM、AI 模型、智能体、提示词、模型推理和本地模型运行工具归入“AI 与模型”。",
            "代码仓库、编程语言、SDK、开发框架和版本控制工具才归入“开发编程”。",
            "category 表示更细的实际用途，用 2-8 个汉字，不要照抄 group。",
            "tags 固定输出 3-5 个规范短词，优先包含具体平台/工具、宽泛领域和多个实际用途。",
            "第1个标签优先使用网站明确出现的知名平台或工具；第2个是宽泛领域；其余标签写实际用途或主题。",
            "不要说仓库名或自创代码名；如果仓库是某个平台的插件，应使用平台名，而不是仓库 slug。",
            "标签要短、可搜索，每个 2-8 个字，不要写整句。",
            "示例：ComfyUI 提示词插件返回 [\"ComfyUI\",\"AI\",\"提示词\",\"图像生成\",\"工作流\"]；本地 AI 短剧生成器返回 [\"短剧\",\"AI\",\"视频生成\",\"剧本创作\",\"分镜\"]。",
            "preferredTags 是用户已有标签；含义相同时必须优先复用其中的写法。",
            "不得输出网址、整句、同义重复、形容词或无意义泛词。",
            "purpose 输出 15-40 个汉字的用户用途备注；若是已有网站，应与 summary 区分，purpose 说明“我会用它做什么”。",
            "manualTags 是用户人工标签，必须全部保留，不得重复、改写或建议删除。",
            "lockedPurpose 已由人工填写，不得覆盖；仍需按该用途理解网站。",
            "简介 20-45 个汉字；名称格式为“站点名｜主要用途”。",
            "名称要具体说明用途，不要只保留模糊的原标题；不得遗漏输入项。",
            "存在 github 字段时，优先依据仓库 README 摘要判断实际用途。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ items: payload, preferredTags }),
        },
      ],
    });
    return parseOrganizerResponse(response, allowed);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("AI 批次请求超时，已拆分重试");
    }
    throw err;
  } finally {
    window.clearTimeout(idleTimer);
    window.clearTimeout(hardTimer);
  }
}

function mergeSuggestions(
  left: OrganizerSuggestion[],
  right: OrganizerSuggestion[],
): OrganizerSuggestion[] {
  const merged = new Map<string, OrganizerSuggestion>();
  for (const suggestion of [...left, ...right]) {
    merged.set(suggestion.bookmarkId, suggestion);
  }
  return Array.from(merged.values());
}

function collectPreferredTags(
  existingMeta: Awaited<ReturnType<typeof loadBookmarkMeta>>,
): string[] {
  const counts = new Map<string, number>();
  for (const meta of Object.values(existingMeta)) {
    for (const tag of normalizeBookmarkTags([
      ...(meta.manualTags ?? []),
      ...(meta.aiTags ?? meta.tags),
    ])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 80)
    .map(([tag]) => tag);
}

function recordFailures(
  batch: FlatBookmark[],
  failures: Array<{ id: string; error: string }>,
  error: string,
): void {
  for (const bookmark of batch) {
    failures.push({ id: bookmark.id, error });
  }
}

function isAiServiceError(message: string): boolean {
  return /failed to fetch|networkerror|load failed|abort|timeout|timed out|超时|无法连接|连接失败|Ollama\s+\d{3}|HTTP\s+[45]\d\d/i.test(
    message,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
