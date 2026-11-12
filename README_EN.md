# Bookmark Studio

> [中文](./README.md) · **English**

Bookmark Studio is a local-first Chrome / Edge extension for organizing bookmarks from a unified new-tab dashboard, generating tags, managing private folders, and using local Ollama or user-configured AI providers.

## Based on the Original Project

This project is based on and substantially extends [xiaoniuge36/Smart-Bookmark](https://github.com/xiaoniuge36/Smart-Bookmark).

- Original author: [@xiaoniuge36](https://github.com/xiaoniuge36)
- Original repository: [https://github.com/xiaoniuge36/Smart-Bookmark](https://github.com/xiaoniuge36/Smart-Bookmark)
- The original README states that the project is licensed under MIT.
- This project retains attribution and rebuilds the bookmark tagging, collection flow, folder picker, privacy exclusions, and AI organization workflow.
- The original project also credits [LazyCat Bookmark Cleaner](https://github.com/Alanrk/LazyCat-Bookmark-Cleaner) and [TabMark](https://github.com/Alanrk/TabMark-Bookmark-New-Tab) as inspiration.

See [NOTICE.md](./NOTICE.md) for details.

## Features

- New-tab bookmark dashboard with folder navigation, search, and drag-and-drop ordering.
- Left-click the toolbar action to collect the current page in a compact popup.
- Searchable destination picker with `/child/grandchild` quick folder creation.
- Manual and AI tags share a three-tag limit; both can be edited or removed.
- AI tagging prioritizes platforms, use cases, topics, and broad domains using the title, summary, folder, and GitHub README.
- Ollama, OpenAI, and Anthropic support.
- Incremental and full AI re-analysis modes with batch persistence and resumable progress.
- Private folders and configurable AI folder exclusions.
- Friend-link and private folders are tracked by browser folder ID, so moves and renames are followed automatically.
- Integrity-checked JSON backups, Netscape HTML import/export, and browser bookmark restoration.
- Compare search, floating widget, QR codes, cached favicons, and AI news navigation.

## Privacy

- Bookmark data is processed locally by default.
- Ollama requests go to the local Ollama endpoint configured by the user.
- OpenAI and Anthropic requests are sent directly from the browser to the selected provider.
- API keys and GitHub tokens are kept in extension-local browser storage.
- Private folders are excluded from the dashboard, search, and AI jobs.
- Folder names and their descendants can be excluded from all AI processing.
- This project contains no analytics, telemetry, or behavioral tracking.

See [PRIVACY.md](./PRIVACY.md) for details.

## Installation

```bash
git clone https://github.com/pmmxd/bookmark-studio.git
cd bookmark-studio
npm install
npm run build
```

### Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click “Load unpacked”
4. Select the `dist` directory

### Edge

1. Open `edge://extensions`
2. Enable Developer mode
3. Click “Load unpacked”
4. Select the `dist` directory

Select the `dist` directory containing `manifest.json`, not the source root.

## Browser Data

- Use separate extension directories for separate browsers or profiles.
- Internal storage keys retain the `smart-bookmark::*` prefix for backward compatibility.
- `chrome.storage.local` stores local tags, purposes, and analysis data.
- AI channel annotations may sync through `chrome.storage.sync`.
- Tags stored in bookmark titles follow browser bookmark sync. Purposes and tag-source metadata require a JSON backup.

## Development

```bash
npm install
npm run typecheck
npm run test:core
npm run build
```

Stack: React, TypeScript, Vite, Tailwind CSS, and Manifest V3.

## License

MIT License. See [LICENSE](./LICENSE).
