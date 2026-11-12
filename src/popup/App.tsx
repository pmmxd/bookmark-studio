import { useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FolderPicker from "@/components/FolderPicker";
import {
  allFolders,
  createFolderPath,
  getVisibleTree,
} from "@/lib/bookmarks";
import { collectBookmark } from "@/lib/bookmarkDetails";
import {
  generateBookmarkPurpose,
  generateBookmarkTags,
} from "@/lib/bookmarkPurpose";
import { loadBookmarkMeta } from "@/lib/bookmarkMeta";
import {
  MAX_BOOKMARK_TAGS,
  sanitizeBaseTitle,
} from "@/lib/bookmarkTitle";
import { normalizeBookmarkTags } from "@/lib/bookmarkTaxonomy";
import { getSettings } from "@/lib/storage";
import { unloadOllamaModel } from "@/lib/ai";
import type { FolderStat, Settings } from "@/types";

export default function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folders, setFolders] = useState<FolderStat[]>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [baseTitle, setBaseTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeSource, setPurposeSource] = useState<"manual" | "ai">(
    "manual",
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingTags, setGeneratingTags] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      getSettings(),
      getVisibleTree(),
      loadBookmarkMeta(),
    ])
      .then(([tabs, savedSettings, tree, metaStore]) => {
        if (!alive) return;
        const active = tabs[0] ?? null;
        const folderList = allFolders(tree);
        const counts = new Map<string, number>();
        for (const meta of Object.values(metaStore)) {
          for (const tag of [...(meta.manualTags ?? []), ...meta.tags]) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        }
        setTab(active);
        setSettings(savedSettings);
        setFolders(folderList);
        setKnownTags(
          Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag]) => tag),
        );
        setBaseTitle(
          sanitizeBaseTitle(active?.title ?? active?.url ?? "未命名书签"),
        );
        setParentId(
          folderList.find(
            (folder) => folder.id === savedSettings.rootFolderId,
          )?.id ||
            folderList[0]?.id ||
            "",
        );
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "读取网页信息失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    return knownTags
      .filter(
        (tag) =>
          !manualTags.includes(tag) && tag.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [knownTags, manualTags, tagInput]);

  const addTag = (value: string) => {
    const tag = normalizeBookmarkTags([value])[0];
    if (!tag || manualTags.includes(tag)) {
      setTagInput("");
      return;
    }
    if (manualTags.length + aiTags.length >= MAX_BOOKMARK_TAGS) {
      setError(`最多添加 ${MAX_BOOKMARK_TAGS} 个标签`);
      return;
    }
    setManualTags([...manualTags, tag]);
    setTagInput("");
    setError("");
  };

  const onGeneratePurpose = async () => {
    if (!settings) return;
    setGenerating(true);
    setError("");
    try {
      const generated = await generateBookmarkPurpose(
        settings,
        baseTitle,
        tab?.url ?? "",
      );
      setPurpose(generated);
      setPurposeSource("ai");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成用途失败");
    } finally {
      void unloadOllamaModel(settings);
      setGenerating(false);
    }
  };

  const onGenerateTags = async () => {
    if (!settings) return;
    if (manualTags.length >= MAX_BOOKMARK_TAGS) {
      setError("标签名额已用完，请先删除一个标签");
      return;
    }
    setGeneratingTags(true);
    setError("");
    try {
      const generated = await generateBookmarkTags(
        settings,
        baseTitle,
        tab?.url ?? "",
        purpose,
        knownTags,
        manualTags,
      );
      setAiTags(
        generated
          .filter((tag) => !manualTags.includes(tag))
          .slice(0, MAX_BOOKMARK_TAGS - manualTags.length),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成标签失败");
    } finally {
      void unloadOllamaModel(settings);
      setGeneratingTags(false);
    }
  };

  const onSave = async () => {
    if (!tab?.url) {
      setError("当前页面不能收藏");
      return;
    }
    if (!baseTitle.trim()) {
      setError("请输入网站名称");
      return;
    }
    if (!parentId) {
      setError("请选择保存文件夹");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await collectBookmark({
        parentId,
        url: tab.url,
        baseTitle,
        manualTags,
        aiTags,
        purpose,
        purposeSource,
      });
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存书签失败");
    } finally {
      setSaving(false);
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

  const openFullEditor = () => {
    const params = new URLSearchParams({
      tab: "dashboard",
      collect: "1",
      url: tab?.url ?? "",
      title: baseTitle,
    });
    void chrome.tabs.create({
      url: chrome.runtime.getURL(`newtab.html#${params.toString()}`),
    });
    window.close();
  };

  if (loading) {
    return (
      <div className="flex h-40 w-[368px] items-center justify-center rounded-2xl border border-border/80 bg-background/95 text-sm text-muted-foreground shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:ring-white/10">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        读取当前网页…
      </div>
    );
  }

  return (
    <div className="relative w-[368px] rounded-2xl border border-border/80 bg-background/95 text-foreground shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:ring-white/10">
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/[0.07] via-transparent to-background/35" />
      <div className="relative p-3">
      <div className="mb-3 flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
          <BookmarkPlus className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">收藏当前网页</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {tab?.url || "当前页面地址不可用"}
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">网站名称</span>
          <Input
            value={baseTitle}
            onChange={(event) => setBaseTitle(event.target.value)}
            className="h-8 text-xs"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium">保存到</span>
          <FolderPicker
            folders={folders}
            value={parentId}
            onChange={(folder) => setParentId(folder?.id || "")}
            allowCreate
            onCreate={createFolderFromPicker}
            placeholder="搜索文件夹，或输入 /子文件夹"
          />
        </label>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] font-medium">
              <Tags className="h-3.5 w-3.5" />
              标签
            </span>
            <span className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {manualTags.length + aiTags.length}/{MAX_BOOKMARK_TAGS}
              </span>
              <button
                type="button"
                onClick={onGenerateTags}
                disabled={
                  generatingTags ||
                  manualTags.length + aiTags.length >= MAX_BOOKMARK_TAGS
                }
                className="inline-flex items-center gap-1 text-[10px] text-primary disabled:opacity-50"
              >
                {generatingTags ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                AI 生成标签
              </button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {manualTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 text-[10px] text-amber-700 dark:text-amber-300"
              >
                <LockKeyhole className="h-2.5 w-2.5" />
                {tag}
                <button
                  type="button"
                  onClick={() =>
                    setManualTags(manualTags.filter((item) => item !== tag))
                  }
                  aria-label={`移除 ${tag}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {aiTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-primary/10 px-2 text-[10px] text-primary"
              >
                <Sparkles className="h-2.5 w-2.5" />
                {tag}
                <button
                  type="button"
                  onClick={() =>
                    setAiTags(aiTags.filter((item) => item !== tag))
                  }
                  aria-label={`移除 ${tag}`}
                >
                  <X className="h-2.5 w-2.5" />
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
                className="h-8 text-xs"
              />
              {suggestions.length > 0 && (
                <div className="absolute inset-x-0 top-[calc(100%+3px)] z-20 rounded-md border bg-popover p-1 shadow-lg">
                  {suggestions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="flex w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">用途备注</span>
            <button
              type="button"
              onClick={onGeneratePurpose}
              disabled={generating || !tab?.url}
              className="inline-flex items-center gap-1 text-[10px] text-primary disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              AI 生成
            </button>
          </div>
          <textarea
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
              setPurposeSource("manual");
            }}
            rows={2}
            maxLength={140}
            placeholder="以后会用它做什么？"
            className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={openFullEditor}
          className="inline-flex h-8 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          完整编辑
        </button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || !tab?.url}
          className="ml-auto h-8 px-4 text-xs"
        >
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          保存书签
        </Button>
      </div>
      </div>
    </div>
  );
}
