export interface FriendLink {
  title: string;
  description: string;
  url: string;
}

export const DASHBOARD_FRIEND_LINKS: FriendLink[] = [
  {
    title: "GitHub Trending",
    description: "GitHub 官方趋势仓库榜",
    url: "https://github.com/trending",
  },
  {
    title: "AI 工具集",
    description: "国内外 AI 工具与产品导航",
    url: "https://ai-bot.cn/",
  },
  {
    title: "FMHY Backups",
    description: "免费资源与备份导航",
    url: "https://fmhy.net/other/backups",
  },
  {
    title: "AI 工具集资讯",
    description: "AI 产品、模型与行业新闻",
    url: "https://ai-bot.cn/ai-news/",
  },
  {
    title: "AIHOT 模型榜",
    description: "AI 模型热度排行",
    url: "https://aihot.news/leaderboard",
  },
  {
    title: "AIHOT",
    description: "每日精选 AI 行业动态",
    url: "https://aihot.news/",
  },
  {
    title: "GitCN Trending",
    description: "中文 GitHub 趋势榜",
    url: "https://gitcn.org/trending",
  },
  {
    title: "GitHot",
    description: "热门 GitHub 项目聚合",
    url: "https://githot.dev",
  },
  {
    title: "RepoWatch",
    description: "GitHub 仓库趋势监测",
    url: "https://repowatch.top/",
  },
  {
    title: "RayByte Trending",
    description: "GitHub 趋势项目周期榜",
    url: "https://raybyte.cn/github-trending?period=2",
  },
  {
    title: "开源帮周榜",
    description: "每周开源项目排行榜",
    url: "https://kaiyuanbang.cn/zh-cn/rankings/weekly.html",
  },
  {
    title: "Hopmmp GitHub",
    description: "GitHub 热门榜单聚合",
    url: "https://h.hopmmp.com/list/github",
  },
];

const AI_NAV_ONLY_LINKS: FriendLink[] = [
  {
    title: "GitHub Hot",
    description: "GitHub 热门项目入口",
    url: "https://github.hot/",
  },
  {
    title: "Open Repo",
    description: "开源仓库发现与导航",
    url: "https://www.open-repo.com/",
  },
  {
    title: "FMHY Backups",
    description: "免费资源与备份导航",
    url: "https://fmhy.net/other/backups",
  },
];

export const AI_NAV_FRIEND_LINKS: FriendLink[] = [
  ...AI_NAV_ONLY_LINKS,
  ...DASHBOARD_FRIEND_LINKS,
].filter(
  (link, index, list) =>
    list.findIndex((candidate) => candidate.url === link.url) === index,
);
