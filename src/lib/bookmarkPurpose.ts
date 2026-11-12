import { chat } from "@/lib/ai";
import type { Settings } from "@/types";
import { sanitizeBaseTitle } from "@/lib/bookmarkTitle";
import { normalizeBookmarkTags } from "@/lib/bookmarkTaxonomy";
import { inferTagHintsFromText } from "@/lib/bookmarkTagHints";

export async function generateBookmarkPurpose(
  settings: Settings,
  title: string,
  url: string,
): Promise<string> {
  if (settings.aiProvider === "none") {
    throw new Error("请先在设置中启用 AI");
  }
  const response = await chat({
    settings,
    jsonMode: true,
    jsonSchema: {
      type: "object",
      properties: { purpose: { type: "string" } },
      required: ["purpose"],
      additionalProperties: false,
    },
    messages: [
      {
        role: "system",
        content:
          "你是书签用途助手。只输出 JSON。purpose 用 15-40 个汉字说明用户以后会访问这个网站做什么，不要复述标题。",
      },
      {
        role: "user",
        content: JSON.stringify({
          title: sanitizeBaseTitle(title),
          url,
        }),
      },
    ],
  });
  try {
    const parsed = JSON.parse(response) as { purpose?: unknown };
    const purpose = String(parsed.purpose ?? "").trim().slice(0, 140);
    if (!purpose) throw new Error("AI 未生成用途");
    return purpose;
  } catch {
    const fallback = response.trim().replace(/^```(?:json)?|```$/g, "").trim();
    if (!fallback) throw new Error("AI 未生成用途");
    return fallback.slice(0, 140);
  }
}

export async function generateBookmarkTags(
  settings: Settings,
  title: string,
  url: string,
  purpose: string,
  preferredTags: string[],
  lockedTags: string[],
): Promise<string[]> {
  if (settings.aiProvider === "none") {
    throw new Error("请先在设置中启用 AI");
  }
  const response = await chat({
    settings,
    jsonMode: true,
    jsonSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 5,
        },
      },
      required: ["tags"],
      additionalProperties: false,
    },
    messages: [
      {
        role: "system",
        content: [
          "你是书签标签助手。只输出 JSON。",
          "tags 输出 3-5 个短标签：优先包含具体平台/工具、宽泛领域和多个实际用途。",
          "不要使用仓库 slug 或自创代码名；插件应优先使用所属平台名。",
          "标签要短、可搜索，每个 2-8 个字；禁止整句、网址、形容词和同义重复。",
          "示例：ComfyUI 提示词插件 => [\"ComfyUI\",\"AI\",\"提示词\",\"图像生成\",\"工作流\"]；本地 AI 短剧生成器 => [\"短剧\",\"AI\",\"视频生成\",\"剧本创作\",\"分镜\"]。",
          "preferredTags 是已有标签，含义相同时优先复用其中写法。",
          "lockedTags 是人工标签，不得重复或改写。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          title: sanitizeBaseTitle(title),
          url,
          purpose,
          preferredTags: preferredTags.slice(0, 80),
          lockedTags,
        }),
      },
    ],
  });
  let parsed: { tags?: unknown };
  try {
    parsed = JSON.parse(response) as { tags?: unknown };
  } catch {
    const start = response.indexOf("{");
    const end = response.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 未生成标签");
    parsed = JSON.parse(response.slice(start, end + 1)) as { tags?: unknown };
  }
  const hintedTags = inferTagHintsFromText(
    `${title} ${url} ${purpose}`,
    title,
  );
  const tags = normalizeBookmarkTags([
    ...hintedTags,
    ...normalizeBookmarkTags(parsed.tags),
  ])
    .filter((tag) => !lockedTags.includes(tag))
    .slice(0, 5);
  if (!tags.length) throw new Error("AI 未生成标签");
  return tags;
}
