import type {
  BookmarkMetaStore,
  BookmarkNode,
  FlatBookmark,
} from "@/types";

export interface BookmarkFolderPlan {
  category: string;
  bookmarkIds: string[];
  existingFolderId?: string;
}

export function planBookmarkFolders(
  bookmarks: FlatBookmark[],
  meta: BookmarkMetaStore,
  parentId: string,
  existingFolders: BookmarkNode[],
): BookmarkFolderPlan[] {
  const existingByTitle = new Map(
    existingFolders
      .filter((folder) => !folder.url)
      .map((folder) => [safeFolderName(folder.title || ""), folder.id]),
  );
  const groups = new Map<string, BookmarkFolderPlan>();

  for (const bookmark of bookmarks) {
    if (bookmark.parentId !== parentId) continue;
    const category = safeFolderName(meta[bookmark.id]?.category ?? "");
    const current = groups.get(category) ?? {
      category,
      bookmarkIds: [],
      existingFolderId: existingByTitle.get(category),
    };
    current.bookmarkIds.push(bookmark.id);
    groups.set(category, current);
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      b.bookmarkIds.length - a.bookmarkIds.length ||
      a.category.localeCompare(b.category),
  );
}

export function safeFolderName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || "未分类"
  );
}
