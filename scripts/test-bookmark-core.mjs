import assert from "node:assert/strict";
import { normalizeOllamaBase } from "../src/lib/ai.ts";
import {
  buildBookmarkTagGroups,
  classifyBookmarkTag,
} from "../src/lib/bookmarkTagGroups.ts";
import {
  BOOKMARK_GROUPS,
  cleanBookmarkTag,
  normalizeBookmarkGroup,
  normalizeBookmarkTags,
} from "../src/lib/bookmarkTaxonomy.ts";
import { parseOrganizerResponse } from "../src/lib/bookmarkOrganizerParser.ts";
import { iconCacheKey } from "../src/lib/iconCache.ts";
import {
  planBookmarkFolders,
  safeFolderName,
} from "../src/lib/bookmarkFolderPlanner.ts";
import {
  extractReadmeExcerpt,
  parseGitHubRepo,
} from "../src/lib/githubContext.ts";
import { parseAiDirectoryHtml } from "../src/lib/aiDirectory.ts";
import { isNewtabTabVisible } from "../src/lib/newtabTabs.ts";
import { parseGithubTrendingHtml } from "../src/lib/github.ts";
import { AI_NAV_FRIEND_LINKS } from "../src/lib/friendLinks.ts";
import { findFriendLinksFolder } from "../src/lib/friendLinksBookmarks.ts";
import {
  collectBookmarkIdsInNamedFolders,
  flatten,
  withoutNamedFolders,
} from "../src/lib/bookmarks.ts";
import {
  buildTaggedTitle,
  getBookmarkTagParts,
  isNewTagSchema,
  mergeTags,
  parseTaggedTitle,
} from "../src/lib/bookmarkTitle.ts";
import {
  extractTitleKeywords,
  inferTagHintsFromText,
} from "../src/lib/bookmarkTagHints.ts";
import { parseAiLeaderboardHtml } from "../src/lib/aiHot.ts";
import { allEngines } from "../src/lib/engines.ts";
import {
  buildIntegrity,
  verifyIntegrity,
} from "../src/lib/backupIntegrity.ts";

const suggestions = parseOrganizerResponse(
  '```json\n{"items":[{"id":"10","category":"开发","title":"GitHub｜代码托管","tags":["代码","协作"],"summary":"用于托管和协作开发代码。"},{"id":"unknown","category":"其他","title":"忽略","tags":[],"summary":"不应保留"}]}\n```',
  { "10": "https://github.com/" },
);
assert.equal(suggestions.length, 1);
assert.equal(suggestions[0].bookmarkId, "10");
assert.deepEqual(suggestions[0].tags, ["代码", "协作"]);
const recoveredSuggestions = parseOrganizerResponse(
  '{"items":{"11":{"category":"效率","title":"Notion｜笔记管理","tags":["笔记"],"summary":"用于记录与整理个人知识。"}}, "broken":',
  { "11": "https://www.notion.so/" },
);
assert.equal(recoveredSuggestions.length, 1);
assert.equal(recoveredSuggestions[0].bookmarkId, "11");
assert.equal(cleanBookmarkTag("  #Git  "), "Git");
assert.equal(normalizeBookmarkGroup("人工智能工具"), "AI 与模型");
assert.equal(normalizeBookmarkGroup("乱写分类"), null);
assert.deepEqual(
  normalizeBookmarkTags(["AI工具", "人工智能", "大模型", "https://a.test", "播放器"]),
  ["AI", "大模型", "播放器"],
);
const constrainedSuggestion = parseOrganizerResponse(
  JSON.stringify({
    items: [
      {
        id: "12",
        group: "AI 与模型",
        category: "模型推理",
        title: "Ollama｜本地模型运行",
        tags: ["AI工具", "人工智能", "本地部署"],
        summary: "用于在本地运行和测试开源大语言模型。",
      },
    ],
  }),
  { "12": "https://ollama.com/" },
);
assert.equal(constrainedSuggestion[0].group, "AI 与模型");
assert.deepEqual(constrainedSuggestion[0].tags, ["AI", "本地部署"]);
assert.equal(
  constrainedSuggestion[0].purpose,
  "用于在本地运行和测试开源大语言模型。",
);
assert.deepEqual(parseTaggedTitle("Notion #笔记 #效率"), {
  baseTitle: "Notion",
  tags: ["笔记", "效率"],
});
assert.equal(
  buildTaggedTitle("Notion", ["笔记", "效率"]),
  "Notion #笔记 #效率",
);
assert.deepEqual(mergeTags(["人工", "人工"], ["AI", "测试", "多余"]), [
  "人工",
  "AI",
  "测试",
  "多余",
]);
const titleParts = getBookmarkTagParts("Notion #笔记 #效率", {
  bookmarkId: "title",
  url: "https://notion.so/",
  baseTitle: "Notion",
  category: "笔记",
  tags: ["效率", "AI", "协作"],
  manualTags: ["笔记"],
  aiTags: ["效率", "AI"],
  summary: "知识库",
  analyzedAt: 1,
});
assert.deepEqual(titleParts.tags, ["笔记", "效率", "AI"]);
assert.deepEqual(titleParts.legacyTags, ["协作"]);
assert.ok(extractTitleKeywords("本地 AI 短剧生成器").includes("短剧"));
assert.ok(extractTitleKeywords("本地 AI 短剧生成器").includes("AI"));
assert.ok(
  inferTagHintsFromText(
    "用于短剧创作、分镜和视频生成",
    "内容创作工具",
  ).includes("短剧"),
);
assert.ok(
  extractTitleKeywords("塔罗牌在线占卜").some((tag) =>
    tag.includes("塔罗"),
  ),
);
assert.equal(
  isNewTagSchema({
    bookmarkId: "new",
    url: "https://new.test",
    baseTitle: "New",
    group: "软件工具",
    category: "工具",
    tags: ["工具"],
    aiTags: ["工具"],
    purpose: "测试",
    summary: "测试",
    analyzedAt: 1,
  }),
  true,
);
assert.equal(
  isNewTagSchema({
    bookmarkId: "old",
    url: "https://old.test",
    category: "工具",
    tags: ["旧标签"],
    summary: "旧记录",
    analyzedAt: 1,
  }),
  false,
);
const tagGroups = buildBookmarkTagGroups(
  [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }],
  {
    "1": {
      bookmarkId: "1",
      url: "https://a.test",
      category: "开发",
      tags: ["Git", "工具"],
      summary: "A",
      analyzedAt: 1,
    },
    "2": {
      bookmarkId: "2",
      url: "https://b.test",
      category: "开发",
      tags: ["#Git", "文档"],
      summary: "B",
      analyzedAt: 1,
    },
    "3": {
      bookmarkId: "3",
      url: "https://c.test",
      category: "设计",
      tags: ["Figma"],
      summary: "C",
      analyzedAt: 1,
    },
    "4": {
      bookmarkId: "4",
      url: "https://d.test",
      category: "开发",
      tags: ["工具"],
      summary: "D",
      analyzedAt: 1,
    },
  },
);
assert.equal(tagGroups[0].name, "开发编程");
assert.deepEqual(
  new Map(tagGroups[0].tags),
  new Map([
    ["Git", 2],
    ["工具", 2],
  ]),
);
assert.equal(tagGroups.some((group) => group.name === "设计创作"), false);
assert.equal(classifyBookmarkTag("下载", "软件资源"), "软件工具");
assert.equal(classifyBookmarkTag("工具", "软件资源"), "软件工具");
assert.equal(classifyBookmarkTag("macos", "系统工具"), "系统效率");
assert.equal(classifyBookmarkTag("Adobe", "设计工具"), "设计创作");
assert.equal(classifyBookmarkTag("音乐插件聚合", "软件资源"), "媒体娱乐");
assert.equal(classifyBookmarkTag("电子书资源", "软件资源"), "学习阅读");
assert.equal(classifyBookmarkTag("代码托管", "软件资源"), "开发编程");
assert.equal(classifyBookmarkTag("AI模型库", "软件资源"), "AI 与模型");
assert.equal(classifyBookmarkTag("开源软件", "软件资源"), "开发编程");
assert.equal(classifyBookmarkTag("纯净", "软件资源"), "软件工具");
assert.ok(tagGroups.length <= 20);
assert.equal(tagGroups.some((group) => group.name === "综合其他"), false);
const storedGroupTagGroups = buildBookmarkTagGroups(
  [{ id: "5" }, { id: "6" }],
  {
    "5": {
      bookmarkId: "5",
      url: "https://e.test",
      group: "媒体娱乐",
      category: "开发",
      tags: ["播放器"],
      summary: "E",
      analyzedAt: 1,
    },
    "6": {
      bookmarkId: "6",
      url: "https://f.test",
      group: "媒体娱乐",
      category: "开发",
      tags: ["播放器"],
      summary: "F",
      analyzedAt: 1,
    },
  },
);
assert.equal(storedGroupTagGroups[0].name, "媒体娱乐");
assert.ok(BOOKMARK_GROUPS.length <= 20);
const friendTree = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "收藏夹栏",
        children: [
          {
            id: "nested",
            title: "其他",
            children: [
              { id: "link-folder", title: "Link", children: [] },
            ],
          },
        ],
      },
    ],
  },
];
assert.equal(
  findFriendLinksFolder(friendTree, "未使用", "link-folder")?.id,
  "link-folder",
);
assert.equal(
  findFriendLinksFolder(friendTree, "Link")?.id,
  "link-folder",
);
const privacyTree = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "tool",
        title: "Tool",
        children: [
          {
            id: "tool-child",
            title: "相机",
            children: [
              {
                id: "tool-bookmark",
                parentId: "tool-child",
                title: "Tool bookmark",
                url: "https://tool.test/",
              },
            ],
          },
        ],
      },
      {
        id: "vpn",
        title: "vpn",
        children: [
          {
            id: "vpn-bookmark",
            parentId: "vpn",
            title: "VPN bookmark",
            url: "https://vpn.test/",
          },
        ],
      },
      {
        id: "normal",
        title: "普通",
        children: [
          {
            id: "normal-bookmark",
            parentId: "normal",
            title: "Normal bookmark",
            url: "https://normal.test/",
          },
        ],
      },
    ],
  },
];
assert.deepEqual(
  Array.from(
    collectBookmarkIdsInNamedFolders(privacyTree, ["Tool", "VPN"]),
  ).sort(),
  ["tool-bookmark", "vpn-bookmark"],
);
assert.deepEqual(
  flatten(withoutNamedFolders(privacyTree, ["Tool", "VPN"])).map(
    (bookmark) => bookmark.id,
  ),
  ["normal-bookmark"],
);
assert.equal(iconCacheKey("https://www.github.com/a/b"), "github.com");
assert.equal(iconCacheKey("not a url"), "");
assert.equal(
  normalizeOllamaBase("127.0.0.1:11434/v1"),
  "http://127.0.0.1:11434",
);
assert.equal(safeFolderName("开发/工具:*"), "开发 工具");
const folderPlan = planBookmarkFolders(
  [
    { id: "1", parentId: "root", title: "A", url: "https://a.test", path: "" },
    { id: "2", parentId: "root", title: "B", url: "https://b.test", path: "" },
    { id: "3", parentId: "other", title: "C", url: "https://c.test", path: "" },
  ],
  {
    "1": {
      bookmarkId: "1",
      url: "https://a.test",
      category: "开发/工具",
      tags: [],
      summary: "A",
      analyzedAt: 1,
    },
    "2": {
      bookmarkId: "2",
      url: "https://b.test",
      category: "开发/工具",
      tags: [],
      summary: "B",
      analyzedAt: 1,
    },
    "3": {
      bookmarkId: "3",
      url: "https://c.test",
      category: "其他",
      tags: [],
      summary: "C",
      analyzedAt: 1,
    },
  },
  "root",
  [{ id: "dev", parentId: "root", title: "开发 工具" }],
);
assert.deepEqual(folderPlan, [
  {
    category: "开发 工具",
    bookmarkIds: ["1", "2"],
    existingFolderId: "dev",
  },
]);
assert.equal(
  parseGitHubRepo("https://github.com/microsoft/vscode/issues/1"),
  "microsoft/vscode",
);
assert.equal(
  parseGitHubRepo("https://github.com/topics/typescript"),
  null,
);
assert.equal(
  extractReadmeExcerpt(
    '<article class="markdown-body"><h1>Project</h1><p>A build tool.</p></article>',
  ),
  "Project A build tool.",
);
const aiTools = parseAiDirectoryHtml(
  '<i class="site-tag" id="term-7"></i> AI写作工具<a href="https://ai-bot.cn/sites/1.html" data-id="1" data-url="https://loomy.test/" class="card" title="AI 智能体"><strong>Loomy</strong><p>AI 智能体</p><img data-src="https://ai-bot.cn/loomy.png"></a>',
);
assert.deepEqual(aiTools, [
  {
    id: "1",
    title: "Loomy",
    description: "AI 智能体",
    category: "AI写作工具",
    url: "https://loomy.test/",
    icon: "https://ai-bot.cn/loomy.png",
    sourceUrl: "https://ai-bot.cn/sites/1.html",
  },
]);
assert.equal(
  isNewtabTabVisible({ hiddenTabs: ["channels"] }, "dashboard"),
  true,
);
assert.equal(
  isNewtabTabVisible({ hiddenTabs: ["channels"] }, "channels"),
  false,
);
const officialTrending = parseGithubTrendingHtml(
  '<article class="Box-row"><h2><a href="/owner/project">owner / project</a></h2><p>Useful project.</p><span itemprop="programmingLanguage">TypeScript</span><a href="/owner/project/stargazers">1,234</a><a href="/owner/project/forks">56</a></article>',
);
assert.equal(officialTrending.length, 1);
assert.equal(officialTrending[0].fullName, "owner/project");
assert.equal(officialTrending[0].stars, 1234);
assert.equal(officialTrending[0].forks, 56);
assert.ok(AI_NAV_FRIEND_LINKS.length >= 14);
const leaderboard = parseAiLeaderboardHtml(
  '<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"position":1,"name":"Model A","url":"https://aihot.news/leaderboard/a"},{"position":2,"name":"Model B","url":"https://aihot.news/leaderboard/b"}]}</script>',
);
assert.deepEqual(leaderboard.map((item) => item.name), ["Model A", "Model B"]);
const engineIds = allEngines({ customEngines: [] }).map((engine) => engine.id);
assert.ok(engineIds.includes("bing"));
assert.ok(engineIds.includes("yandex"));
const backupCore = {
  app: "smart-bookmark",
  version: 2,
  tree: [{ id: "1", title: "Bookmarks", children: [] }],
  bookmarkMeta: {},
  settings: { theme: "system" },
};
const integrity = await buildIntegrity(backupCore);
assert.equal(await verifyIntegrity({ ...backupCore, integrity }), true);
assert.equal(
  await verifyIntegrity({ ...backupCore, theme: "dark", integrity }),
  false,
);
console.log("bookmark core checks passed");
