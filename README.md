# 书签工坊 · Bookmark Studio

> **中文** · [English](./README_EN.md)

书签工坊是一个本地优先的 Chrome / Edge 扩展，用统一的新标签页整理书签、生成标签、管理隐私文件夹，并通过本地 Ollama 或你自行配置的 AI 服务辅助分类。

## 基于原作者项目

本项目基于 [xiaoniuge36/Smart-Bookmark](https://github.com/xiaoniuge36/Smart-Bookmark) 修改和扩展。

- 原作者：[@xiaoniuge36](https://github.com/xiaoniuge36)
- 原始项目：[https://github.com/xiaoniuge36/Smart-Bookmark](https://github.com/xiaoniuge36/Smart-Bookmark)
- 原项目 README 声明使用 MIT License。
- 本项目保留原项目署名，并在其基础上重构书签标签、收藏流程、文件夹选择、隐私排除和 AI 整理任务。
- 原项目本身也注明受到 [LazyCat Bookmark Cleaner](https://github.com/Alanrk/LazyCat-Bookmark-Cleaner) 与 [TabMark](https://github.com/Alanrk/TabMark-Bookmark-New-Tab) 启发。

详细归属说明见 [NOTICE.md](./NOTICE.md)。

## 主要功能

- 新标签页书签看板、文件夹导航、搜索和拖拽排序。
- 工具栏左键直接打开当前网页收藏小窗。
- 保存位置支持搜索，并可通过 `/子文件夹/二级文件夹` 快速创建层级目录。
- 人工标签与 AI 标签共用最多 3 个名额，二者均可修改和删除。
- AI 标签优先提取平台、用途、主题和宽泛领域，并参考标题、简介、文件夹与 GitHub README。
- 支持 Ollama、OpenAI 和 Anthropic。
- AI 整理采用增量模式与整体重跑模式，支持分批保存和断点续跑。
- 支持隐私文件夹、Tool/VPN 等 AI 排除规则。
- 友情链接文件夹与隐私文件夹支持搜索选择，并按文件夹 ID 自动适配移动和改名。
- 支持 JSON 完整性校验备份、Netscape HTML 导入导出和浏览器书签恢复。
- 支持对比搜索、悬浮球、二维码、图标缓存和 AI 快讯导航。

## 隐私

- 书签数据默认只在浏览器本地处理。
- 使用 Ollama 时，请求发送到你本机配置的 Ollama 地址。
- 使用 OpenAI 或 Anthropic 时，扩展从浏览器直接请求对应 API，不经过本项目自建服务器。
- API Key 与 GitHub Token 保存在浏览器扩展本地存储中。
- 隐私文件夹不会出现在看板、搜索或 AI 任务中。
- 可在设置中指定禁止 AI 读取的文件夹名称及其全部子目录。
- 本项目不包含统计、遥测或用户行为分析。

完整说明见 [PRIVACY.md](./PRIVACY.md)。

## 安装

### 从源码构建

```bash
git clone https://github.com/pmmxd/bookmark-studio.git
cd bookmark-studio
npm install
npm run build
```

### Chrome

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择项目中的 `dist` 目录

### Edge

1. 打开 `edge://extensions`
2. 开启开发人员模式
3. 点击“加载解压缩的扩展”
4. 选择项目中的 `dist` 目录

必须选择包含 `manifest.json` 的 `dist` 目录，不要选择源码根目录。

## 浏览器数据说明

- 不同浏览器或浏览器用户资料应分别加载各自目录，避免共享静态配置。
- 内部存储键仍保留 `smart-bookmark::*` 前缀，以兼容原项目已有数据。
- `chrome.storage.local` 保存本机标签、用途和分析数据。
- AI 渠道的分组与备注可能通过 `chrome.storage.sync` 同步。
- 浏览器书签标题中的标签会随浏览器书签同步；用途与人工/AI 来源需要 Bookmark Studio JSON 备份迁移。

## 开发

```bash
npm install
npm run typecheck
npm run test:core
npm run build
```

技术栈：React、TypeScript、Vite、Tailwind CSS、Manifest V3。

## 许可证

MIT License。详见 [LICENSE](./LICENSE)。
