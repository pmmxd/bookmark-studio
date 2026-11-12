# 隐私政策 / Privacy Policy

**生效日期 / Effective date:** 2026-11-12

**维护者 / Maintainer:** [pmmxd](https://github.com/pmmxd)

**项目 / Project:** [pmmxd/bookmark-studio](https://github.com/pmmxd/bookmark-studio)

## 中文

书签工坊是一个本地优先的浏览器扩展。本项目不运营收集用户数据的服务器，不包含统计分析或遥测。

### 本地数据

- 书签、历史记录、常去网站和浏览器权限由浏览器提供。
- 扩展设置、API Key、GitHub Token、标签、用途和分析结果保存在浏览器扩展存储中。
- API Key 与 GitHub Token 不会写入 Bookmark Studio JSON 备份。
- 卸载扩展会清除扩展存储，但不会删除浏览器书签。

### AI 请求

- 选择 Ollama 时，请求发送到用户配置的本地 Ollama 地址。
- 选择 OpenAI 或 Anthropic 时，浏览器直接向对应服务商发起请求。
- 发送内容仅包含当前 AI 任务所需的书签信息或用户输入。
- 隐私文件夹以及被设置为禁止 AI 读取的文件夹及子目录不会发送给 AI。

### 同步

- AI 渠道分组和备注可能使用 `chrome.storage.sync`。
- 浏览器书签标题与网址是否同步由浏览器账户设置决定。
- 本项目未提供自建云端数据服务。

### 联系方式

请通过 [GitHub Issues](https://github.com/pmmxd/bookmark-studio/issues) 反馈隐私问题。

## English

Bookmark Studio is a local-first browser extension. This project does not operate a server that collects user data and contains no analytics or telemetry.

### Local data

- Bookmarks, history, top sites, and browser data are provided by the browser.
- Extension settings, API keys, GitHub tokens, tags, purposes, and analysis results are stored in extension storage.
- API keys and GitHub tokens are excluded from Bookmark Studio JSON backups.
- Uninstalling the extension clears extension storage but does not delete browser bookmarks.

### AI requests

- With Ollama, requests go to the user-configured local Ollama endpoint.
- With OpenAI or Anthropic, the browser sends requests directly to the selected provider.
- Requests include only the bookmark information required by the active AI task or text entered by the user.
- Private folders and folders configured as excluded from AI, including descendants, are not sent to AI.

### Sync

- AI channel groups and notes may use `chrome.storage.sync`.
- Bookmark title and URL sync is controlled by the browser account settings.
- This project does not provide its own cloud data service.

### Contact

Report privacy issues through [GitHub Issues](https://github.com/pmmxd/bookmark-studio/issues).

This privacy policy is available under the MIT-0 license.
