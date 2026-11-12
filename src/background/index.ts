import { flatten, getVisibleTree } from "@/lib/bookmarks";
import { getCachedSiteIcon } from "@/lib/iconCache";

export {};

const MENU_IDS = {
  SEARCH_BOOKMARKS: "sb-search-bookmarks",
  COLLECT_PAGE: "sb-collect-page",
  COLLECT_PAGE_ACTION: "sb-collect-page-action",
  COPY_URL: "sb-copy-url",
  COPY_LINK: "sb-copy-link",
  QR_PAGE: "sb-qr-page",
  QR_LINK: "sb-qr-link",
  OPEN_CLEANER: "sb-open-cleaner",
  OPEN_SIDEPANEL: "sb-open-sidepanel",
  OPEN_DASHBOARD: "sb-open-dashboard",
  TOGGLE_FLOAT: "sb-toggle-float",
  ACTION_ROOT: "sb-action-root",
} as const;

const SETTINGS_KEY = "smart-bookmark::settings";

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  try {
    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
  } catch (err) {
    console.warn("[smart-bookmark] sidePanel.setPanelBehavior failed", err);
  }
});

chrome.runtime.onStartup?.addListener(() => setupContextMenus());

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.COLLECT_PAGE,
      title: "收藏当前网页到书签工坊",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.SEARCH_BOOKMARKS,
      title: '在书签工坊中搜索 "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.COPY_URL,
      title: "复制当前页面地址",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.COPY_LINK,
      title: "复制链接地址",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.QR_PAGE,
      title: "生成当前页面二维码",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.QR_LINK,
      title: "生成链接二维码",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.ACTION_ROOT,
      title: "书签工坊",
      contexts: ["action"],
    });
    for (const [id, title] of [
      [MENU_IDS.COLLECT_PAGE_ACTION, "收藏当前网页"],
      [MENU_IDS.OPEN_DASHBOARD, "打开书签看板"],
      [MENU_IDS.OPEN_SIDEPANEL, "打开侧边栏"],
      [MENU_IDS.OPEN_CLEANER, "打开清理中心"],
      [MENU_IDS.TOGGLE_FLOAT, "切换网页悬浮球"],
    ] as const) {
      chrome.contextMenus.create({
        id,
        parentId: MENU_IDS.ACTION_ROOT,
        title,
      });
    }
  });
}

async function openCollectPage(tab?: chrome.tabs.Tab) {
  const params = new URLSearchParams({
    tab: "dashboard",
    collect: "1",
    url: tab?.url ?? "",
    title: tab?.title ?? "",
  });
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`newtab.html#${params.toString()}`),
  });
}

async function copyViaTab(tabId: number, text: string) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t: string) => {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch {}
        ta.remove();
        try {
          navigator.clipboard?.writeText?.(t);
        } catch {}
      },
      args: [text],
    });
  } catch (err) {
    console.warn("[smart-bookmark] copy failed", err);
  }
}

async function openQrTab(url: string) {
  const target = chrome.runtime.getURL(
    `newtab.html#tab=dashboard&qr=${encodeURIComponent(url)}`,
  );
  await chrome.tabs.create({ url: target });
}

async function toggleFloatingBall() {
  const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = saved ?? {};
  const next = !settings.floatingBall;
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...settings, floatingBall: next },
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case MENU_IDS.SEARCH_BOOKMARKS: {
      const q = encodeURIComponent(info.selectionText ?? "");
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`newtab.html#q=${q}`),
      });
      break;
    }
    case MENU_IDS.COLLECT_PAGE:
    case MENU_IDS.COLLECT_PAGE_ACTION: {
      await openCollectPage(tab);
      break;
    }
    case MENU_IDS.COPY_URL: {
      const url = tab?.url;
      if (!url || !tab?.id) return;
      await copyViaTab(tab.id, url);
      break;
    }
    case MENU_IDS.COPY_LINK: {
      const link = info.linkUrl;
      if (!link || !tab?.id) return;
      await copyViaTab(tab.id, link);
      break;
    }
    case MENU_IDS.QR_PAGE: {
      if (tab?.url) await openQrTab(tab.url);
      break;
    }
    case MENU_IDS.QR_LINK: {
      if (info.linkUrl) await openQrTab(info.linkUrl);
      break;
    }
    case MENU_IDS.OPEN_CLEANER: {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("newtab.html#tab=cleaner"),
      });
      break;
    }
    case MENU_IDS.OPEN_DASHBOARD: {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("newtab.html#tab=dashboard"),
      });
      break;
    }
    case MENU_IDS.OPEN_SIDEPANEL: {
      if (tab?.windowId) {
        await chrome.sidePanel
          ?.open?.({ windowId: tab.windowId })
          .catch(() => {});
      }
      break;
    }
    case MENU_IDS.TOGGLE_FLOAT: {
      await toggleFloatingBall();
      break;
    }
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "open-side-panel") {
    if (tab?.windowId) {
      await chrome.sidePanel
        ?.open?.({ windowId: tab.windowId })
        .catch(() => {});
    }
  } else if (command === "open-cleaner") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("newtab.html#tab=cleaner"),
    });
  } else if (command === "toggle-float") {
    await toggleFloatingBall();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "open-newtab") {
        await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-sidepanel") {
        if (sender.tab?.windowId) {
          await chrome.sidePanel
            ?.open?.({ windowId: sender.tab.windowId })
            .catch(() => {});
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-cleaner") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("newtab.html#tab=cleaner"),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-settings") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("newtab.html#tab=settings"),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-qr" && typeof msg.url === "string") {
        await openQrTab(msg.url);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "search-bookmarks" && typeof msg.query === "string") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(
            `newtab.html#q=${encodeURIComponent(msg.query)}`,
          ),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "bookmarks-search" && typeof msg.query === "string") {
        const tree = await getVisibleTree();
        const visibleIds = new Set(flatten(tree).map((item) => item.id));
        chrome.bookmarks.search(msg.query, async (items) => {
          const visible = (items || [])
            .filter((item) => !!item.url && visibleIds.has(item.id))
            .slice(0, 20);
          const results = await Promise.all(
            visible.map(async (item) => ({
              id: item.id,
              title: item.title || item.url!,
              url: item.url!,
              icon: await getCachedSiteIcon(item.url!),
            })),
          );
          sendResponse({ ok: true, items: results });
        });
        return;
      }
      sendResponse({ ok: false });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});
