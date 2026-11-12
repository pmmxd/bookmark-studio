import {
  allFolders,
  flatten,
  getVisibleTree,
  withoutNamedFolders,
} from "@/lib/bookmarks";
import { parseTaggedTitle } from "./bookmarkTitle.ts";
import { getSettings } from "@/lib/storage";

/**
 * 供 AI 调用的本机书签摘要（仅扩展内读取，不经过第三方）。
 */
export async function getBookmarkContextForAi(): Promise<string> {
  const [visibleTree, settings] = await Promise.all([
    getVisibleTree(),
    getSettings(),
  ]);
  const tree = withoutNamedFolders(
    visibleTree,
    settings.aiExcludedFolderNames ?? ["Tool", "VPN"],
  );
  const all = flatten(tree);
  const folders = allFolders(tree)
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 24);
  const folderLines = folders
    .map((f) => `  - ${f.path}：${f.count} 条`)
    .join("\n");
  const sample = all
    .slice(0, 60)
    .map((b) => `  - ${parseTaggedTitle(b.title).baseTitle} | ${b.url}`)
    .join("\n");
  return [
    `本机 Chrome 书签统计：共 ${all.length} 条书签。`,
    folders.length
      ? `按文件夹条数（节选）：\n${folderLines}`
      : "无文件夹级统计。",
    all.length
      ? `书签名与 URL 示例（最多 60 条，供回答「有哪些 / 查某类」时参考）：\n${sample}`
      : "当前没有可列出的书签。",
  ].join("\n");
}
