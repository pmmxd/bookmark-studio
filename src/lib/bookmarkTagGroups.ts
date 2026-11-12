import type { BookmarkMetaStore } from "@/types";
import {
  BOOKMARK_GROUPS,
  cleanBookmarkTag,
  normalizeBookmarkGroup,
  type BookmarkGroup,
} from "./bookmarkTaxonomy.ts";

export interface BookmarkTagGroup {
  name: string;
  tags: Array<[string, number]>;
}

interface TagRule {
  name: BookmarkGroup;
  patterns: string[];
}

interface TagStat {
  usage: number;
  groups: Map<BookmarkGroup, number>;
}

const MIN_TAG_USAGE = 2;
const OTHER_GROUP: BookmarkGroup = "综合其他";

// Specific themes come before broad software/tool terms so mixed tags keep their meaning.
const TAG_RULES: TagRule[] = [
  {
    name: "AI 与模型",
    patterns: [
      "人工智能",
      "机器学习",
      "深度学习",
      "大模型",
      "语言模型",
      "模型库",
      "神经网络",
      "多模态",
      "智能体",
      "提示词",
      "生成式",
      "ai",
      "llm",
      "gpt",
      "chatgpt",
      "openai",
      "claude",
      "gemini",
      "ollama",
      "huggingface",
      "hugging face",
      "stable diffusion",
      "comfyui",
      "midjourney",
      "aigc",
      "rag",
      "embedding",
      "prompt",
      "agent",
    ],
  },
  {
    name: "开发编程",
    patterns: [
      "代码",
      "编程",
      "开发",
      "前端",
      "后端",
      "全栈",
      "开源",
      "仓库",
      "部署",
      "服务器",
      "编译器",
      "算法",
      "命令行",
      "github",
      "gitlab",
      "gitee",
      "git",
      "sdk",
      "api",
      "framework",
      "docker",
      "kubernetes",
      "k8s",
      "linux",
      "shell",
      "python",
      "javascript",
      "typescript",
      "react",
      "vue",
      "nodejs",
      "node.js",
      "rust",
      "golang",
      "java",
      "sql",
      "npm",
      "devops",
    ],
  },
  {
    name: "设计创作",
    patterns: [
      "设计",
      "建模",
      "图片",
      "图像",
      "摄影",
      "剪辑",
      "视频编辑",
      "字体",
      "素材",
      "插画",
      "渲染",
      "配色",
      "绘图",
      "绘画",
      "ui",
      "ux",
      "figma",
      "photoshop",
      "adobe",
      "illustrator",
      "canva",
      "blender",
      "3d",
      "logo",
      "icon",
    ],
  },
  {
    name: "媒体娱乐",
    patterns: [
      "音乐",
      "音频",
      "视频",
      "影视",
      "电影",
      "电视剧",
      "动漫",
      "动画",
      "游戏",
      "直播",
      "播客",
      "电台",
      "播放器",
      "字幕",
      "歌曲",
      "媒体",
      "spotify",
      "youtube",
      "bilibili",
      "netflix",
      "kodi",
      "emby",
      "plex",
    ],
  },
  {
    name: "学习阅读",
    patterns: [
      "学习",
      "教程",
      "课程",
      "文档",
      "知识",
      "电子书",
      "书籍",
      "阅读",
      "论文",
      "百科",
      "学术",
      "科学",
      "研究",
      "字典",
      "翻译",
      "教育",
      "资料",
      "手册",
      "公开课",
      "ebook",
      "wiki",
      "docs",
      "documentation",
      "guide",
      "tutorial",
      "course",
    ],
  },
  {
    name: "数据存储",
    patterns: [
      "数据",
      "数据集",
      "数据库",
      "存储",
      "备份",
      "同步",
      "文件",
      "磁盘",
      "网盘",
      "云盘",
      "相册",
      "归档",
      "恢复",
      "nas",
    ],
  },
  {
    name: "安全隐私",
    patterns: [
      "安全",
      "隐私",
      "密码",
      "加密",
      "认证",
      "授权",
      "权限",
      "防火墙",
      "杀毒",
      "security",
      "privacy",
      "key",
      "token",
    ],
  },
  {
    name: "系统效率",
    patterns: [
      "系统",
      "效率",
      "启动",
      "快捷键",
      "窗口",
      "文件管理",
      "资源管理",
      "自动化",
      "终端",
      "驱动",
      "右键",
      "桌面",
      "macos",
      "windows",
      "terminal",
      "powershell",
      "cmd",
      "launcher",
      "everything",
      "utools",
      "alfred",
    ],
  },
  {
    name: "软件工具",
    patterns: [
      "软件",
      "工具",
      "应用",
      "插件",
      "扩展",
      "下载",
      "安装",
      "客户端",
      "便携",
      "商店",
      "app",
      "application",
      "portable",
      "office",
      "wps",
      "chrome",
      "edge",
      "utility",
    ],
  },
  {
    name: "网络资源",
    patterns: [
      "网络",
      "导航",
      "搜索",
      "网站",
      "网页",
      "镜像",
      "论坛",
      "社区",
      "订阅",
      "博客",
      "邮箱",
      "代理",
      "域名",
      "rss",
      "vpn",
      "dns",
      "cdn",
    ],
  },
  {
    name: "生活服务",
    patterns: [
      "生活",
      "购物",
      "美食",
      "旅游",
      "健康",
      "医疗",
      "银行",
      "支付",
      "地图",
      "天气",
      "招聘",
      "房产",
      "汽车",
      "运动",
      "健身",
    ],
  },
];

const GROUP_ORDER = new Map(
  BOOKMARK_GROUPS.map((name, index) => [name, index]),
);
const CONTEXTUAL_TAGS = new Set([
  "下载",
  "工具",
  "软件",
  "应用",
  "插件",
  "扩展",
  "资源",
  "平台",
  "服务",
  "内容",
  "在线",
]);

export function classifyBookmarkTag(
  tag: string,
  category: string,
): BookmarkGroup {
  const cleanedTag = cleanBookmarkTag(tag);
  if (CONTEXTUAL_TAGS.has(cleanedTag.toLowerCase())) {
    const fromCategory = matchTagRule(category);
    if (fromCategory) return fromCategory;
  }
  return matchTagRule(cleanedTag) ?? matchTagRule(category) ?? OTHER_GROUP;
}

export function buildBookmarkTagGroups(
  items: ReadonlyArray<{ id: string }>,
  meta: BookmarkMetaStore,
): BookmarkTagGroup[] {
  const stats = new Map<string, TagStat>();
  for (const item of items) {
    const data = meta[item.id];
    if (!data) continue;
    const category = data.category?.trim() || "未分类";
    const storedGroup = normalizeBookmarkGroup(data.group);
    const tags = new Set((data.tags ?? []).map(cleanBookmarkTag).filter(Boolean));
    for (const tag of tags) {
      const stat = stats.get(tag) ?? {
        usage: 0,
        groups: new Map<BookmarkGroup, number>(),
      };
      stat.usage += 1;
      const group = storedGroup ?? classifyBookmarkTag(tag, category);
      stat.groups.set(
        group,
        (stat.groups.get(group) ?? 0) + 1,
      );
      stats.set(tag, stat);
    }
  }

  const grouped = new Map<BookmarkGroup, Array<[string, number]>>();
  for (const [tag, stat] of stats) {
    if (stat.usage < MIN_TAG_USAGE) continue;
    const [group] = Array.from(stat.groups.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    const tags = grouped.get(group) ?? [];
    tags.push([tag, stat.usage]);
    grouped.set(group, tags);
  }

  return Array.from(grouped.entries())
    .map(([name, tags]) => ({
      name,
      tags: tags.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    }))
    .sort(
      (a, b) =>
        (GROUP_ORDER.get(a.name) ?? 99) - (GROUP_ORDER.get(b.name) ?? 99),
    );
}

function matchTagRule(value: string): BookmarkGroup | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  for (const rule of TAG_RULES) {
    if (rule.patterns.some((pattern) => includesPattern(text, pattern))) {
      return rule.name;
    }
  }
  return null;
}

function includesPattern(text: string, pattern: string): boolean {
  const term = pattern.toLowerCase();
  if (/^[a-z0-9.#+-]+$/.test(term) && term.length <= 4) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(
      text,
    );
  }
  return text.includes(term);
}
