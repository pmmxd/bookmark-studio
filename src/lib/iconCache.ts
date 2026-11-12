const DB_NAME = "smart-bookmark-icons";
const STORE_NAME = "icons";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface IconCacheEntry {
  key: string;
  dataUrl: string;
  updatedAt: number;
}

const inFlight = new Map<string, Promise<string>>();
let dbPromise: Promise<IDBDatabase> | null = null;

export function iconCacheKey(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function getCachedSiteIcon(url: string): Promise<string> {
  const key = iconCacheKey(url);
  if (!key) return "";
  const cached = await readCache(key);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached.dataUrl;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = fetchAndCacheIcon(url, key).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function fetchAndCacheIcon(url: string, key: string): Promise<string> {
  const candidates = [chromeFaviconUrl(url), googleFaviconUrl(key)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const response = await fetch(candidate, { credentials: "omit" });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/") || blob.size < 64) continue;
      const dataUrl = await blobToDataUrl(blob);
      await writeCache({ key, dataUrl, updatedAt: Date.now() });
      return dataUrl;
    } catch {
      // Try the next source; a missing favicon should not break the page.
    }
  }
  return "";
}

function chromeFaviconUrl(url: string): string {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime?.id ||
    typeof chrome.runtime.getURL !== "function"
  ) {
    return "";
  }
  return chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`,
  );
}

function googleFaviconUrl(key: string): string {
  const host = key.split(":")[0];
  return host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
    : "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function readCache(key: string): Promise<IconCacheEntry | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () =>
        resolve(request.result as IconCacheEntry | undefined);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

async function writeCache(entry: IconCacheEntry): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Cache failures fall back to the live favicon on the next render.
  }
}
