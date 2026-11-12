import type { BookmarkAiMeta, BookmarkMetaStore } from "@/types";

const KEY = "smart-bookmark::bookmark-meta";
const hasChromeStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function loadBookmarkMeta(): Promise<BookmarkMetaStore> {
  if (!hasChromeStorage) {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BookmarkMetaStore) : {};
  }
  const saved = await chrome.storage.local.get(KEY);
  return (saved[KEY] as BookmarkMetaStore | undefined) ?? {};
}

export async function saveBookmarkMeta(
  entries: BookmarkAiMeta[],
): Promise<BookmarkMetaStore> {
  const current = await loadBookmarkMeta();
  for (const entry of entries) current[entry.bookmarkId] = entry;
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [KEY]: current });
  } else {
    localStorage.setItem(KEY, JSON.stringify(current));
  }
  return current;
}

export async function getBookmarkMeta(
  bookmarkId: string,
): Promise<BookmarkAiMeta | undefined> {
  return (await loadBookmarkMeta())[bookmarkId];
}

export async function removeBookmarkMeta(
  bookmarkIds: string[],
): Promise<void> {
  if (!bookmarkIds.length) return;
  const current = await loadBookmarkMeta();
  let changed = false;
  for (const id of bookmarkIds) {
    if (current[id]) {
      delete current[id];
      changed = true;
    }
  }
  if (!changed) return;
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [KEY]: current });
  } else {
    localStorage.setItem(KEY, JSON.stringify(current));
  }
}

export function onBookmarkMetaChange(
  handler: (store: BookmarkMetaStore) => void,
): () => void {
  if (!hasChromeStorage) return () => {};
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === "local" && changes[KEY]) {
      handler((changes[KEY].newValue as BookmarkMetaStore | undefined) ?? {});
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
