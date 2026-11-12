import { useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  Loader2,
  LockKeyhole,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FolderPicker from "@/components/FolderPicker";
import { toast } from "@/components/ui/toast";
import {
  allFolders,
  createFolderPath,
  getVisibleTree,
} from "@/lib/bookmarks";
import { loadBookmarkMeta } from "@/lib/bookmarkMeta";
import {
  collectBookmark,
  updateBookmarkDetails,
} from "@/lib/bookmarkDetails";
import {
  buildTaggedTitle,
  getBookmarkPurpose,
  getBookmarkTagParts,
  MAX_BOOKMARK_TAGS,
  mergeTags,
  sanitizeBaseTitle,
} from "@/lib/bookmarkTitle";
import {
  generateBookmarkPurpose,
  generateBookmarkTags,
} from "@/lib/bookmarkPurpose";
import { normalizeBookmarkTags } from "@/lib/bookmarkTaxonomy";
import { organizeBookmarks } from "@/lib/bookmarkOrganizer";
import { unloadOllamaModel } from "@/lib/ai";
import type { FolderStat, Settings } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  initialUrl?: string;
  initialTitle?: string;
  editBookmarkId?: string;
  onSaved?: () => void;
}

export default function BookmarkCollectDialog({
  open,
  onOpenChange,
  settings,
  initialUrl = "",
  initialTitle = "",
  editBookmarkId,
  onSaved,
}: Props) {
  const [folders, setFolders] = useState<FolderStat[]>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [baseTitle, setBaseTitle] = useState("");
  const [url, setUrl] = useState("");
  const [parentId, setParentId] = useState("");
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [blockedTags, setBlockedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeSource, setPurposeSource] = useState<"manual" | "ai">(
    "manual",
  );
  const [purposeLocked, setPurposeLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"save" | "analyze" | null>(null);
  const [generatingPurpose, setGeneratingPurpose] = useState(false);
  const [generatingTags, setGeneratingTags] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void Promise.all([
      getVisibleTree(),
      loadBookmarkMeta(),
      editBookmarkId
        ? chrome.bookmarks.get(editBookmarkId).then((rows) => rows[0])
        : Promise.resolve(undefined),
    ])
      .then(([tree, metaStore, bookmark]) => {
        if (!alive) return;
        const folderList = allFolders(tree);
        setFolders(folderList);
        const tags = new Map<string, number>();
        for (const meta of Object.values(metaStore)) {
          for (const tag of [...(meta.manualTags ?? []), ...meta.tags]) {
            tags.set(tag, (tags.get(tag) ?? 0) + 1);
          }
        }
        setKnownTags(
          Array.from(tags.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag]) => tag),
        );

        if (editBookmarkId && bookmark?.url) {
          const meta = metaStore[editBookmarkId];
          const parts = getBookmarkTagParts(bookmark.title, meta);
          setBaseTitle(parts.baseTitle);
          setUrl(bookmark.url);
          setParentId(bookmark.parentId || folderList[0]?.id || "");
          setManualTags(parts.manualTags);
          setAiTags(parts.aiTags);
          setBlockedTags(meta?.blockedTags ?? []);
          setPurpose(getBookmarkPurpose(meta));
          setPurposeSource(meta?.purposeSource ?? "manual");
          setPurposeLocked(!!meta?.purposeLocked);
        } else {
          const parsed = getBookmarkTagParts(
            initialTitle || initialUrl,
            undefined,
          );
          setBaseTitle(parsed.baseTitle);
          setUrl(initialUrl);
          setParentId(
            folderList.find((folder) => folder.id === settings.rootFolderId)
              ?.id ||
              folderList[0]?.id ||
              "",
          );
          setManualTags([]);
          setAiTags([]);
          setBlockedTags([]);
          setPurpose("");
          setPurposeSource("manual");
          setPurposeLocked(false);
        }
      })
      .catch((err) => {
        toast(err instanceof Error ? err.message : "读取书签信息失败", "error");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [editBookmarkId, initialTitle, initialUrl, open, settings.rootFolderId]);

  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    return knownTags
      .filter(
        (tag) =>
          !manualTags.includes(tag) && tag.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [knownTags, manualTags, tagInput]);

  const addTag = (value: string) => {
    const tag = normalizeBookmarkTags([value])[0];
    if (!tag || manualTags.includes(tag)) {
      setTagInput("");
      return;
    }
    if (manualTags.length + aiTags.length >= MAX_BOOKMARK_TAGS) {
      toast(`最多添加 ${MAX_BOOKMARK_TAGS} 个标签`, "error");
      return;
    }
    setManualTags([...manualTags, tag]);
    setBlockedTags(blockedTags.filter((item) => item !== tag));
    setTagInput("");
  };

  const removeTag = (tag: string, source: "manual" | "ai") => {
    if (source === "manual") {
      setManualTags(manualTags.filter((item) => item !== tag));
    } else {
      setAiTags(aiTags.filter((item) => item !== tag));
    }
    setBlockedTags(Array.from(new Set([...blockedTags, tag])));
  };

  const onGeneratePurpose = async () => {
    setGeneratingPurpose(true);
    try {
      const generated = await generateBookmarkPurpose(settings, baseTitle, url);
      setPurpose(generated);
      setPurposeSource("ai");
      setPurposeLocked(false);
      toast("用途已生成，可继续修改", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "生成用途失败", "error");
    } finally {
      void unloadOllamaModel(settings);
      setGeneratingPurpose(false);
    }
  };

  const onGenerateTags = async () => {
    if (manualTags.length + aiTags.length >= MAX_BOOKMARK_TAGS) {
      toast("标签名额已用完，请先删除一个标签", "error");
      return;
    }
    setGeneratingTags(true);
    try {
      const generated = await generateBookmarkTags(
        settings,
        baseTitle,
        url,
        purpose,
        knownTags,
        manualTags,
      );
      const available = MAX_BOOKMARK_TAGS - manualTags.length;
      setAiTags(
        generated
          .filter(
            (tag) => !manualTags.includes(tag) && !blockedTags.includes(tag),
          )
          .slice(0, available),
      );
      toast("AI 标签已生成，可继续修改或删除", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "生成标签失败", "error");
    } finally {
      void unloadOllamaModel(settings);
      setGeneratingTags(false);
    }
  };

  const onSave = async (analyze: boolean) => {
    const cleanTitle = sanitizeBaseTitle(baseTitle);
    if (!url.trim()) {
      toast("请输入网址", "error");
      return;
    }
    if (!cleanTitle) {
      toast("请输入网站名称", "error");
      return;
    }
    if (!parentId) {
      toast("请选择保存文件夹", "error");
      return;
    }
    setSaving(analyze ? "analyze" : "save");
    try {
      const tags = mergeTags(manualTags, aiTags);
      const saved = editBookmarkId
        ? await updateBookmarkDetails(editBookmarkId, {
            baseTitle: cleanTitle,
            manualTags,
            aiTags,
            blockedTags,
            purpose,
            purposeSource,
            parentId,
          })
        : await collectBookmark({
            parentId,
            url: url.trim(),
            baseTitle: cleanTitle,
            manualTags,
            purpose,
            purposeSource,
          });
      if (analyze) {
        await organizeBookmarks(
          [
            {
              id: saved.bookmarkId,
              parentId,
              title: buildTaggedTitle(cleanTitle, tags),
              url: url.trim(),
              path: "",
            },
          ],
          settings,
        );
      }
      onSaved?.();
      toast(analyze ? "已保存并完成 AI 整理" : "书签已保存", "success");
      onOpenChange(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "保存书签失败", "error");
    } finally {
      setSaving(null);
    }
  };

  const createFolderFromPicker = async (
    base: FolderStat | undefined,
    segments: string[],
  ): Promise<FolderStat | undefined> => {
    const parent = base?.id || parentId;
    if (!parent) return undefined;
    const node = await createFolderPath(parent, segments);
    const folder: FolderStat = {
      id: node.id,
      title: node.title,
      path: [base?.path, ...segments].filter(Boolean).join(" / "),
      count: 0,
    };
    setFolders((current) => [
      ...current.filter((item) => item.id !== folder.id),
      folder,
    ]);
    setParentId(node.id);
    return folder;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="h-5 w-5 text-primary" />
            {editBookmarkId ? "编辑书签" : "收藏当前网页"}
          </DialogTitle>
          <DialogDescription>
            名称写入浏览器，标签与用途保存在书签工坊。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            读取书签…
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">网站名称</span>
              <Input
                value={baseTitle}
                onChange={(event) => setBaseTitle(event.target.value)}
                placeholder="例如：Notion｜知识库"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium">网址</span>
              <Input
                value={url}
                readOnly={!!editBookmarkId}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium">保存到</span>
              <FolderPicker
                folders={folders}
                value={parentId}
                onChange={(folder) => setParentId(folder?.id || "")}
                allowCreate
                onCreate={createFolderFromPicker}
                placeholder="搜索文件夹，或输入 /子文件夹"
              />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Tags className="h-3.5 w-3.5" />
                  标签
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {manualTags.length + aiTags.length}/{MAX_BOOKMARK_TAGS}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onGenerateTags}
                    disabled={
                      generatingTags ||
                      saving !== null ||
                      manualTags.length + aiTags.length >= MAX_BOOKMARK_TAGS
                    }
                    className="h-7 gap-1 text-[11px]"
                  >
                    {generatingTags ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    AI 生成标签
                  </Button>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {manualTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs text-amber-700 dark:text-amber-300"
                  >
                    <LockKeyhole className="h-3 w-3" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag, "manual")}
                      className="rounded-full p-0.5 hover:bg-background/60"
                      aria-label={`移除标签 ${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {aiTags.length > 0 &&
                  aiTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-xs text-primary"
                      title="AI 标签"
                    >
                      <Sparkles className="h-3 w-3" />
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag, "ai")}
                        className="rounded-full p-0.5 hover:bg-background/60"
                        aria-label={`移除标签 ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
              </div>
              {manualTags.length + aiTags.length < MAX_BOOKMARK_TAGS && (
                <div className="relative">
                  <Input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        addTag(event.currentTarget.value);
                      }
                    }}
                    placeholder="输入标签，回车添加"
                    className="h-9"
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute inset-x-0 top-[calc(100%+4px)] z-20 rounded-lg border bg-popover p-1 shadow-lg">
                      {suggestions.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => addTag(tag)}
                          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                        >
                          <span>{tag}</span>
                          <span className="text-muted-foreground">匹配</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  用途备注
                  {purposeLocked && (
                    <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-300">
                      人工锁定
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onGeneratePurpose}
                  disabled={generatingPurpose || saving !== null}
                  className="h-7 gap-1 text-[11px]"
                >
                  {generatingPurpose ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  AI 生成
                </Button>
              </div>
              <textarea
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  setPurposeSource("manual");
                  setPurposeLocked(!!event.target.value.trim());
                }}
                rows={3}
                maxLength={140}
                placeholder="例如：整理个人知识、查找设计灵感、跟踪项目更新…"
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving !== null}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onSave(false)}
            disabled={loading || saving !== null}
          >
            {saving === "save" && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            仅保存
          </Button>
          <Button
            type="button"
            onClick={() => onSave(true)}
            disabled={loading || saving !== null || settings.aiProvider === "none"}
          >
            {saving === "analyze" && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            保存并 AI 整理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
