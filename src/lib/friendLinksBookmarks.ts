import { createFolder, flatten, getTree } from "./bookmarks.ts";
import { getSettings } from "./storage.ts";
import type { BookmarkNode } from "@/types";
import type { FriendLink } from "@/lib/friendLinks";

export async function ensureFriendLinksFolder(
  folderName: string,
  links: FriendLink[],
  folderId?: string,
): Promise<{ folderId: string; added: number }> {
  const run = friendLinksQueue.then(() =>
    ensureFriendLinksFolderInternal(folderName, links, folderId),
  );
  friendLinksQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let friendLinksQueue: Promise<void> = Promise.resolve();

async function ensureFriendLinksFolderInternal(
  folderName: string,
  links: FriendLink[],
  folderId?: string,
): Promise<{ folderId: string; added: number }> {
  if (!chrome?.bookmarks) throw new Error("浏览器书签 API 不可用");
  const [tree, settings] = await Promise.all([getTree(), getSettings()]);
  const bookmarksBar = tree[0]?.children?.find(
    (node) => !node.url && (node.id === "1" || /bookmarks bar/i.test(node.title)),
  );
  if (!bookmarksBar) throw new Error("未找到收藏夹栏");

  let folder = findFriendLinksFolder(tree, folderName, folderId);
  if (folder && folder.id === settings.privateFolderId) {
    throw new Error("友情链接文件夹已被设为隐私收藏夹");
  }
  if (!folder) {
    folder = (await createFolder(bookmarksBar.id, folderName.trim() || "Link")) ?? undefined;
  }
  if (!folder) throw new Error("创建友情链接文件夹失败");

  const existing = new Set(
    flatten([folder]).map((bookmark) => bookmark.url.toLowerCase()),
  );
  let added = 0;
  for (const link of links) {
    const key = link.url.toLowerCase();
    if (existing.has(key)) continue;
    await chrome.bookmarks.create({
      parentId: folder.id,
      title: link.title,
      url: link.url,
    });
    existing.add(key);
    added += 1;
  }
  return { folderId: folder.id, added };
}

export function findFriendLinksFolder(
  tree: BookmarkNode[],
  folderName: string,
  folderId?: string,
): BookmarkNode | undefined {
  if (folderId) {
    const byId = findFolder(tree, folderId);
    if (byId) return byId;
  }
  const bookmarksBar = tree[0]?.children?.find(
    (node) => !node.url && (node.id === "1" || /bookmarks bar/i.test(node.title)),
  );
  const normalizedName = folderName.trim().toLowerCase() || "link";
  const direct = (bookmarksBar?.children ?? []).find(
    (node) => !node.url && node.title.trim().toLowerCase() === normalizedName,
  );
  return direct ?? findFolderByName(tree, normalizedName);
}

function findFolder(nodes: BookmarkNode[], id: string): BookmarkNode | undefined {
  for (const node of nodes) {
    if (!node.url && node.id === id) return node;
    const found = node.children
      ? findFolder(node.children, id)
      : undefined;
    if (found) return found;
  }
  return undefined;
}

function findFolderByName(
  nodes: BookmarkNode[],
  normalizedName: string,
): BookmarkNode | undefined {
  for (const node of nodes) {
    if (
      !node.url &&
      node.title.trim().toLowerCase() === normalizedName
    ) {
      return node;
    }
    const found = node.children
      ? findFolderByName(node.children, normalizedName)
      : undefined;
    if (found) return found;
  }
  return undefined;
}
