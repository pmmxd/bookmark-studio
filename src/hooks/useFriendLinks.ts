import { useCallback, useEffect, useState } from "react";
import { flatten, getVisibleTree } from "@/lib/bookmarks";
import { findFriendLinksFolder } from "@/lib/friendLinksBookmarks";
import type { FriendLink } from "@/lib/friendLinks";

export function useFriendLinks(
  folderName: string,
  folderId: string | undefined,
  fallback: FriendLink[],
): { links: FriendLink[]; folderFound: boolean } {
  const [links, setLinks] = useState<FriendLink[]>(fallback);
  const [folderFound, setFolderFound] = useState(false);

  const reload = useCallback(async () => {
    const tree = await getVisibleTree();
    const folder = findFriendLinksFolder(tree, folderName, folderId);
    if (!folder) {
      setFolderFound(false);
      setLinks(fallback);
      return;
    }
    setFolderFound(true);
    setLinks(
      flatten([folder]).map((bookmark) => ({
        title: bookmark.title,
        description: bookmark.path,
        url: bookmark.url,
      })),
    );
  }, [fallback, folderId, folderName]);

  useEffect(() => {
    void reload();
    const events = [
      chrome.bookmarks?.onCreated,
      chrome.bookmarks?.onRemoved,
      chrome.bookmarks?.onChanged,
      chrome.bookmarks?.onMoved,
    ];
    for (const event of events) event?.addListener(reload);
    return () => {
      for (const event of events) event?.removeListener(reload);
    };
  }, [reload]);

  return { links, folderFound };
}
