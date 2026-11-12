import { normalizeBookmarkTags } from "./bookmarkTaxonomy.ts";

const KNOWN_TAG_RULES: Array<{ tags: string[]; pattern: RegExp }> = [
  {
    tags: ["ComfyUI", "提示词", "AI"],
    pattern: /comfyui/i,
  },
  {
    tags: ["短剧", "视频生成", "剧本创作"],
    pattern: /短剧|short[\s_-]*drama|mini[\s_-]*drama/i,
  },
  {
    tags: ["Stable Diffusion", "图像生成", "AI"],
    pattern: /stable[\s_-]*diffusion|sd[\s_-]*webui/i,
  },
  {
    tags: ["Ollama", "大模型", "AI"],
    pattern: /ollama/i,
  },
  {
    tags: ["Hugging Face", "模型下载", "AI"],
    pattern: /hugging[\s_-]*face/i,
  },
  {
    tags: ["Civitai", "模型下载", "AI"],
    pattern: /civitai/i,
  },
  {
    tags: ["Midjourney", "图像生成", "AI"],
    pattern: /midjourney/i,
  },
  {
    tags: ["尼康", "摄影", "APP"],
    pattern: /nikon|尼康/i,
  },
  {
    tags: ["摄影", "相机", "图片管理"],
    pattern: /摄影|相机|拍照|lightroom|联机拍摄/i,
  },
  {
    tags: ["Figma", "设计", "APP"],
    pattern: /figma/i,
  },
  {
    tags: ["Notion", "笔记", "效率"],
    pattern: /notion/i,
  },
  {
    tags: ["Obsidian", "笔记", "效率"],
    pattern: /obsidian/i,
  },
  {
    tags: ["提示词", "AI", "图像生成"],
    pattern: /提示词|prompt/i,
  },
  {
    tags: ["AI", "大模型", "模型推理"],
    pattern: /(^|[^a-z])ai([^a-z]|$)|人工智能|aigc/i,
  },
];

const DOMAIN_WORDS = [
  "短剧",
  "小说",
  "漫画",
  "动漫",
  "影视",
  "电影",
  "电视剧",
  "视频",
  "音乐",
  "音频",
  "游戏",
  "摄影",
  "直播",
  "设计",
  "编程",
  "开发",
  "教育",
  "学习",
  "办公",
  "电商",
  "购物",
  "金融",
  "健康",
  "医疗",
  "旅行",
  "美食",
  "网盘",
  "素材",
  "剧本",
  "分镜",
  "提示词",
  "模型",
  "图像",
  "数据",
  "安全",
  "效率",
  "笔记",
  "翻译",
];

const GENERIC_WORDS = [
  "本地",
  "开源",
  "一站式",
  "专业",
  "免费",
  "在线",
  "中文",
  "官方",
  "工具",
  "平台",
  "网站",
  "生成器",
  "创作",
  "制作",
  "助手",
  "系统",
  "软件",
  "应用",
  "项目",
  "合集",
  "大全",
  "资源",
  "下载",
  "管理",
  "管理器",
  "导航",
  "集合",
];

export function inferTagHintsFromText(
  text: string,
  title: string,
): string[] {
  const known = KNOWN_TAG_RULES.filter((rule) =>
    rule.pattern.test(text),
  ).flatMap((rule) => rule.tags);
  return normalizeBookmarkTags([
    ...known,
    ...extractTitleKeywords(title),
  ]);
}

export function extractTitleKeywords(title: string): string[] {
  const lower = title.toLowerCase();
  const out: string[] = DOMAIN_WORDS.filter((word) =>
    lower.includes(word.toLowerCase()),
  );
  const segments = title
    .replace(/\.(?:exe|app|apk|zip)$/i, "")
    .split(/[\s|｜/\\,，:：;；\-—_+()（）[\]【】]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    let cleaned = segment;
    for (const word of GENERIC_WORDS) {
      cleaned = cleaned.replaceAll(word, "");
    }
    cleaned = cleaned
      .replace(/[^\p{L}\p{N}+#]/gu, "")
      .trim();
    if (
      cleaned.length < 2 ||
      cleaned.length > 8 ||
      /^\d+$/.test(cleaned) ||
      GENERIC_WORDS.includes(cleaned)
    ) {
      continue;
    }
    const hasDomainWord = DOMAIN_WORDS.some((word) =>
      cleaned.toLowerCase().includes(word.toLowerCase()),
    );
    if (!hasDomainWord || cleaned.length <= 4) out.push(cleaned);
  }
  return normalizeBookmarkTags(out);
}
