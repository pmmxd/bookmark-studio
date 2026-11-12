export const BOOKMARK_GROUPS = [
  "AI 与模型",
  "开发编程",
  "设计创作",
  "媒体娱乐",
  "学习阅读",
  "数据存储",
  "安全隐私",
  "系统效率",
  "软件工具",
  "网络资源",
  "生活服务",
  "综合其他",
] as const;

export type BookmarkGroup = (typeof BOOKMARK_GROUPS)[number];

const GROUP_ALIASES: Record<string, BookmarkGroup> = {
  ai: "AI 与模型",
  人工智能: "AI 与模型",
  人工智能工具: "AI 与模型",
  ai工具: "AI 与模型",
  ai应用: "AI 与模型",
  大模型: "AI 与模型",
  llm: "AI 与模型",
  开发: "开发编程",
  开发工具: "开发编程",
  代码开发: "开发编程",
  dev: "开发编程",
  design: "设计创作",
  设计工具: "设计创作",
  media: "媒体娱乐",
  音视频: "媒体娱乐",
  study: "学习阅读",
  学习资料: "学习阅读",
  data: "数据存储",
  存储备份: "数据存储",
  security: "安全隐私",
  安全工具: "安全隐私",
  system: "系统效率",
  系统工具: "系统效率",
  software: "软件工具",
  软件资源: "软件工具",
  tools: "软件工具",
  资源: "网络资源",
  资源网站: "网络资源",
  network: "网络资源",
  life: "生活服务",
  生活工具: "生活服务",
  other: "综合其他",
  其他: "综合其他",
  其他分类: "综合其他",
};

const TAG_SYNONYMS: Record<string, string> = {
  ai: "AI",
  ai工具: "AI",
  ai应用: "AI",
  ai模型: "AI",
  人工智能: "AI",
  人工智能工具: "AI",
  llm: "大模型",
  大语言模型: "大模型",
  开源软件: "开源",
  代码开发: "开发",
  软件开发: "开发",
  软件下载: "下载",
  下载工具: "下载",
  应用软件: "软件",
  软件工具: "工具",
  mac: "macOS",
  macos: "macOS",
  macos系统: "macOS",
  windows系统: "Windows",
  电子书资源: "电子书",
  ebook: "电子书",
  数据备份: "备份",
  云存储: "网盘",
  隐私安全: "隐私",
  网站导航: "导航",
  资源导航: "导航",
  视频播放器: "播放器",
  音乐播放器: "播放器",
};

const groupByKey = new Map<string, BookmarkGroup>(
  BOOKMARK_GROUPS.map((group) => [normalizeKey(group), group]),
);

export function cleanBookmarkTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").trim();
}

export function normalizeBookmarkGroup(
  value: unknown,
): BookmarkGroup | null {
  if (typeof value !== "string") return null;
  const key = normalizeKey(value);
  return groupByKey.get(key) ?? GROUP_ALIASES[key] ?? null;
}

export function normalizeBookmarkTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，;；]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const cleaned = cleanBookmarkTag(item);
    if (
      !cleaned ||
      cleaned.length > 24 ||
      /^(?:https?:\/\/|www\.)/i.test(cleaned)
    ) {
      continue;
    }
    const key = normalizeKey(cleaned);
    const canonical = TAG_SYNONYMS[key] ?? cleaned;
    const canonicalKey = normalizeKey(canonical);
    if (!canonicalKey || seen.has(canonicalKey)) continue;
    seen.add(canonicalKey);
    out.push(canonical);
    if (out.length >= 5) break;
  }
  return out;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\s_-]+/g, "");
}
