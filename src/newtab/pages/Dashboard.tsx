import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getVisibleTree,
  flatten,
  findFolder,
  createFolder,
  moveBookmark,
  collectBookmarkIdsInNamedFolders,
} from "@/lib/bookmarks";
import type {
  BookmarkMetaStore,
  BookmarkNode,
  FlatBookmark,
  Settings,
  TrendingMode,
  TrendingRange,
} from "@/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, hostnameOf } from "@/lib/utils";
import {
  Search,
  Bookmark as BookmarkIcon,
  Bot,
  Columns,
  Command,
  ExternalLink,
  GripVertical,
  MoreHorizontal,
  Pin,
  Folder,
  ChevronRight,
  X,
  HardDriveDownload,
  Settings2,
  Wand2,
  Loader2,
  Sparkles,
  Tags,
  FolderInput,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { setSettings } from "@/lib/storage";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/toast";
import QrDialog from "./QrDialog";
import FolderTree from "@/components/FolderTree";
import EngineSwitcher from "@/components/EngineSwitcher";
import { findEngine } from "@/lib/engines";
import { InfoEntries, InfoLiveNews } from "@/components/InfoCollections";
import { isHomeWidgetVisible } from "@/lib/homeWidgets";
import TopSitesSidebar from "@/components/widgets/TopSitesSidebar";
import TrendingSidebar from "@/components/widgets/TrendingSidebar";
import { rankSearchItems } from "@/lib/searchRank";
import CachedFavicon from "@/components/CachedFavicon";
import {
  loadBookmarkMeta,
  onBookmarkMetaChange,
  removeBookmarkMeta,
} from "@/lib/bookmarkMeta";
import { organizeBookmarks } from "@/lib/bookmarkOrganizer";
import { unloadOllamaModel } from "@/lib/ai";
import { planBookmarkFolders } from "@/lib/bookmarkFolderPlanner";
import FriendLinksCard from "@/components/FriendLinksCard";
import { DASHBOARD_FRIEND_LINKS } from "@/lib/friendLinks";
import { useFriendLinks } from "@/hooks/useFriendLinks";
import {
  buildBookmarkTagGroups,
} from "@/lib/bookmarkTagGroups";
import { cleanBookmarkTag } from "@/lib/bookmarkTaxonomy";
import {
  getBookmarkPurpose,
  getBookmarkTagParts,
  isNewTagSchema,
} from "@/lib/bookmarkTitle";
import BookmarkCollectDialog from "@/components/BookmarkCollectDialog";
import {
  finishOrganizeJob,
  getActiveOrganizeJob,
  markOrganizeJobProgress,
  markOrganizeJobStopped,
  startOrganizeJob,
} from "@/lib/organizeJob";
import type { OrganizeJob } from "@/lib/organizeJob";

interface Props {
  settings: Settings;
  initialQuery?: string;
  /** 从首页热门 widget 跳到「发现」页（与地址栏 hash 同步，避免点击无反应） */
  onOpenDiscover?: () => void;
}

type DashboardTabId =
  | "dashboard"
  | "discover"
  | "cleaner"
  | "ai"
  | "compare"
  | "backup"
  | "settings";

interface FolderBookmark extends FlatBookmark {
  index: number;
}

interface TopSite {
  url: string;
  title: string;
}

interface SearchCommandItem {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  iconUrl?: string;
  Icon?: React.ComponentType<{ className?: string }>;
  onRun: () => void;
}

export default function Dashboard({
  settings,
  initialQuery,
  onOpenDiscover,
}: Props) {
  const t = useT();
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  const [selected, setSelected] = useState<string>(
    settings.rootFolderId ?? "",
  );
  const [items, setItems] = useState<FolderBookmark[]>([]);
  const [subFolders, setSubFolders] = useState<BookmarkNode[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | { id: string; url: string; x: number; y: number; title: string }
    | null
  >(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [topSites, setTopSites] = useState<TopSite[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeCommand, setActiveCommand] = useState(0);
  const [bookmarkMeta, setBookmarkMeta] = useState<BookmarkMetaStore>({});
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagCategory, setTagCategory] = useState<string | null>(null);
  const [editBookmarkId, setEditBookmarkId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const [organizeMode, setOrganizeMode] = useState<
    "incremental" | "rebuild" | null
  >(null);
  const [pendingOrganizeJob, setPendingOrganizeJob] =
    useState<OrganizeJob | null>(null);
  const [applyingFolders, setApplyingFolders] = useState(false);
  const friendLinks = useFriendLinks(
    settings.friendLinksFolderName ?? "Link",
    settings.friendLinksFolderId,
    DASHBOARD_FRIEND_LINKS,
  );
  const [widgetRange, setWidgetRange] = useState<TrendingRange>(
    settings.discoverDefaultRange ?? "weekly",
  );
  const [widgetMode, setWidgetMode] = useState<TrendingMode>(
    settings.discoverDefaultMode ?? "created",
  );
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem("sb_pageSize");
    if (raw === "Infinity") return Infinity;
    const n = Number(raw);
    return [24, 60, 120, 240].includes(n) ? n : 60;
  });
  const [page, setPage] = useState<number>(1);
  const searchWrapRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const organizeBusyRef = useRef(false);
  const resumedJobRef = useRef<string | null>(null);
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    [],
  );

  const expanded = useMemo(
    () => new Set(settings.expandedFolders ?? []),
    [settings.expandedFolders],
  );
  const pinnedIds = useMemo(
    () => new Set(settings.pinnedFolderIds ?? []),
    [settings.pinnedFolderIds],
  );

  const reload = useCallback(async () => {
    const tr = await getVisibleTree();
    setTree(tr);
  }, []);

  useEffect(() => {
    reload();
    const on = () => reload();
    const onRemoved = (id: string) => {
      void removeBookmarkMeta([id]);
      reload();
    };
    chrome.bookmarks?.onChanged?.addListener(on);
    chrome.bookmarks?.onCreated?.addListener(on);
    chrome.bookmarks?.onRemoved?.addListener(onRemoved);
    chrome.bookmarks?.onMoved?.addListener(on);
    return () => {
      chrome.bookmarks?.onChanged?.removeListener(on);
      chrome.bookmarks?.onCreated?.removeListener(on);
      chrome.bookmarks?.onRemoved?.removeListener(onRemoved);
      chrome.bookmarks?.onMoved?.removeListener(on);
    };
  }, [reload, settings.privateFolderId]);

  useEffect(() => {
    loadBookmarkMeta().then(setBookmarkMeta);
    return onBookmarkMetaChange(setBookmarkMeta);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      searchInputRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    chrome.topSites?.get?.((sites) => {
      setTopSites(
        (sites || []).slice(0, 10).map((s) => ({ url: s.url, title: s.title })),
      );
    });
  }, []);

  useEffect(() => {
    if (!tree.length) return;
    if (selected) {
      const folder = findFolder(tree, selected);
      if (!folder) {
        setItems([]);
        setSubFolders([]);
        setBreadcrumb([]);
        return;
      }
      const subs = (folder.children ?? []).filter((c) => !c.url);
      setSubFolders(subs);
      const all = flatten([folder], "");
      setItems(all.map((b, i) => ({ ...b, index: i })));
      setBreadcrumb(buildBreadcrumb(tree, folder.id));
    } else {
      const flat = flatten(tree);
      setItems(flat.map((b, i) => ({ ...b, index: i })));
      setSubFolders([]);
      setBreadcrumb([]);
    }
  }, [tree, selected]);

  const aiTagGroups = useMemo(
    () => buildBookmarkTagGroups(items, bookmarkMeta),
    [bookmarkMeta, items],
  );
  const aiExcludedBookmarkIds = useMemo(
    () =>
      collectBookmarkIdsInNamedFolders(
        tree,
        settings.aiExcludedFolderNames ?? ["Tool", "VPN"],
      ),
    [settings.aiExcludedFolderNames, tree],
  );
  const aiProgress = useMemo(() => {
    const eligible = items.filter(
      (item) => !aiExcludedBookmarkIds.has(item.id),
    );
    const done = eligible.filter((item) =>
      isNewTagSchema(bookmarkMeta[item.id]),
    ).length;
    return {
      total: eligible.length,
      done,
      remaining: eligible.length - done,
      skipped: items.length - eligible.length,
    };
  }, [aiExcludedBookmarkIds, bookmarkMeta, items]);
  const activeTagGroup =
    aiTagGroups.find((group) => group.name === tagCategory) ?? aiTagGroups[0];

  useEffect(() => {
    if (
      !tagCategory ||
      !aiTagGroups.some((group) => group.name === tagCategory)
    ) {
      setTagCategory(aiTagGroups[0]?.name ?? null);
    }
  }, [aiTagGroups, tagCategory]);

  useEffect(() => {
    if (
      tagFilter &&
      !activeTagGroup?.tags.some(([tag]) => tag === tagFilter)
    ) {
      setTagFilter(null);
    }
  }, [activeTagGroup, tagFilter]);

  const filtered = useMemo(() => {
    const scoped = tagFilter
      ? items.filter((item) =>
          bookmarkMeta[item.id]?.tags.some(
            (tag) => cleanBookmarkTag(tag) === tagFilter,
          ),
        )
      : items;
    const q = query.trim();
    if (!q) return scoped;
    return rankSearchItems(q, scoped, scoped.length).map(({ item }) => item);
  }, [bookmarkMeta, items, query, tagFilter]);

  const pageCount = Math.max(
    1,
    pageSize === Infinity ? 1 : Math.ceil(filtered.length / pageSize),
  );

  useEffect(() => {
    setPage(1);
  }, [selected, query, pageSize, tagFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pagedItems = useMemo(() => {
    if (pageSize === Infinity) return filtered;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const onChangePageSize = (n: number) => {
    setPageSize(n);
    localStorage.setItem(
      "sb_pageSize",
      n === Infinity ? "Infinity" : String(n),
    );
  };

  const onSelectFolder = async (id: string) => {
    setSelected(id);
    await setSettings({ rootFolderId: id || undefined });
  };

  const onToggleExpand = async (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    await setSettings({ expandedFolders: [...next] });
  };

  const onTogglePin = async (id: string) => {
    const next = new Set(pinnedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    await setSettings({ pinnedFolderIds: [...next] });
  };

  const onChangeEngine = async (id: string) => {
    await setSettings({ searchEngine: id });
  };

  const openExternal = useCallback((url: string) => {
    window.open(url, "_blank");
    setSearchFocused(false);
  }, []);

  const openDashboardTab = useCallback((id: DashboardTabId) => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.set("tab", id);
    const next = params.toString();
    window.location.hash = next ? "#" + next : "#";
    window.scrollTo({ top: 0, behavior: "smooth" });
    setSearchFocused(false);
  }, []);

  const executeOrganization = useCallback(
    async (
      pendingItems: FolderBookmark[],
      jobId: string,
      automatic = false,
    ) => {
      if (organizeBusyRef.current) return;
      organizeBusyRef.current = true;
      try {
        const run = async () => {
          setOrganizing({ done: 0, total: pendingItems.length, failed: 0 });
          try {
            if (settings.aiProvider === "none") {
              await markOrganizeJobStopped(jobId, "AI 未启用");
              toast("AI 未启用，任务已保留，配置后可继续", "error");
              return;
            }
            const result = await organizeBookmarks(
              pendingItems,
              settings,
              (done, total, failed) => {
                setOrganizing({ done, total, failed });
                void markOrganizeJobProgress(jobId, done, failed);
              },
            );
            setBookmarkMeta(await loadBookmarkMeta());
            await reload();
            if (result.stoppedEarly || result.failed > 0) {
              await markOrganizeJobStopped(
                jobId,
                result.stopReason ?? `失败 ${result.failed} 个`,
              );
              setPendingOrganizeJob(await getActiveOrganizeJob());
            } else {
              await finishOrganizeJob(jobId);
              resumedJobRef.current = null;
              setPendingOrganizeJob(null);
            }
            const prefix = automatic ? "已恢复任务：" : "";
            if (result.stoppedEarly) {
              toast(
                `${prefix}已保存 ${result.organized} 个，失败 ${result.failed} 个；${result.stopReason ?? "任务暂停"}。再次点击可继续`,
                "error",
              );
            } else if (result.failed) {
              toast(
                `${prefix}已整理 ${result.organized} 个，失败 ${result.failed} 个。再次点击会只处理未完成项`,
                "error",
              );
            } else {
              toast(
                `${prefix}已整理 ${result.organized} 个，重命名 ${result.renamed} 个`,
                "success",
              );
            }
          } finally {
            await unloadOllamaModel(settings);
          }
        };
        if (navigator.locks) {
          let lockAcquired = false;
          await navigator.locks.request(
            "smart-bookmark-organize-lock",
            { ifAvailable: true },
            async (lock) => {
              if (!lock) return;
              lockAcquired = true;
              await run();
            },
          );
          if (!lockAcquired) {
            toast("另一个看板页面正在整理书签，此页面没有重复启动", "error");
          }
        } else {
          await run();
        }
      } catch (err: any) {
        await markOrganizeJobStopped(
          jobId,
          err?.message ?? "AI 整理失败",
        );
        setPendingOrganizeJob(await getActiveOrganizeJob());
        toast(err?.message ?? "AI 整理失败", "error");
      } finally {
        organizeBusyRef.current = false;
        setOrganizing(null);
      }
    },
    [reload, settings],
  );

  useEffect(() => {
    let alive = true;
    void getActiveOrganizeJob().then((job) => {
      if (alive) setPendingOrganizeJob(job);
    });
    return () => {
      alive = false;
    };
  }, []);

  const continuePendingOrganizeJob = useCallback(async () => {
    const job = pendingOrganizeJob;
    if (!job || !tree.length || organizeBusyRef.current) return;
    const byId = new Map(flatten(tree).map((item) => [item.id, item]));
    const pending = job.bookmarkIds
      .map((id) => byId.get(id))
      .filter(
        (item): item is FlatBookmark =>
          !!item &&
          !aiExcludedBookmarkIds.has(item.id) &&
          (!bookmarkMeta[item.id] ||
            bookmarkMeta[item.id].analyzedAt < job.createdAt),
      )
      .map((item, index) => ({ ...item, index }));
    if (!pending.length) {
      await finishOrganizeJob(job.id);
      setPendingOrganizeJob(null);
      toast("未完成任务已全部处理", "success");
      return;
    }
    resumedJobRef.current = job.id;
    await executeOrganization(pending, job.id, true);
  }, [
    aiExcludedBookmarkIds,
    bookmarkMeta,
    executeOrganization,
    pendingOrganizeJob,
    tree,
  ]);

  const discardPendingOrganizeJob = async () => {
    const job = pendingOrganizeJob;
    if (!job) return;
    await finishOrganizeJob(job.id);
    setPendingOrganizeJob(null);
    resumedJobRef.current = null;
    toast("未完成任务已清除，不会再自动运行", "success");
  };

  const onOrganizeBookmarks = async (
    mode: "incremental" | "rebuild",
  ) => {
    if (!items.length || organizing) return;
    if (settings.aiProvider === "none") {
      toast("请先在设置中启用 Ollama 或其他 AI", "error");
      openDashboardTab("settings");
      return;
    }
    const eligibleItems = items.filter(
      (item) => !aiExcludedBookmarkIds.has(item.id),
    );
    const skippedCount = items.length - eligibleItems.length;
    if (!eligibleItems.length) {
      toast("当前范围属于禁止 AI 读取的文件夹", "error");
      return;
    }
    const pendingItems = mode === "rebuild"
      ? eligibleItems
      : eligibleItems.filter(
          (item) => !isNewTagSchema(bookmarkMeta[item.id]),
        );
    if (!pendingItems.length) {
      toast("当前范围没有新增或未分析书签，请使用“重新整理”", "success");
      return;
    }
    if (mode === "rebuild" && !window.confirm(
      `将按新的标签规则重新整理当前范围全部 ${eligibleItems.length} 个书签${skippedCount ? `，另有 ${skippedCount} 个隐私文件夹书签会跳过` : ""}。人工标签、用途和已删除标签会保留。继续吗？`,
    )) {
      return;
    }
    if (
      mode === "rebuild" &&
      !window.confirm(
        "第二次确认：重新整理会覆盖当前范围全部 AI 标签，并重新请求 Ollama，耗时可能较长。确定开始吗？",
      )
    ) {
      return;
    }
    if (mode === "incremental" &&
      !window.confirm(
        `将增量整理 ${pendingItems.length} 个新增或未分析书签${skippedCount ? `，${skippedCount} 个隐私文件夹书签会跳过` : ""}。每批立即保存，可以中断后继续。继续吗？`,
      )
    ) {
      return;
    }
    setOrganizeMode(mode);
    try {
      const job = await startOrganizeJob(
        pendingItems.map((item) => item.id),
        selected || undefined,
      );
      setPendingOrganizeJob(null);
      resumedJobRef.current = job.id;
      await executeOrganization(pendingItems, job.id);
    } finally {
      setOrganizeMode(null);
    }
  };

  const onApplyFolders = async () => {
    if (applyingFolders) return;
    if (!selected) {
      toast("请先在左侧选择要整理的文件夹", "error");
      return;
    }
    const folder = findFolder(tree, selected);
    const plan = planBookmarkFolders(
      items,
      bookmarkMeta,
      selected,
      subFolders,
    );
    const total = plan.reduce((sum, group) => sum + group.bookmarkIds.length, 0);
    if (!folder || !total) {
      toast("当前文件夹没有可归类的直属书签，请先运行 AI 整理", "error");
      return;
    }
    const preview = plan
      .map((group) => `${group.category}：${group.bookmarkIds.length} 个`)
      .join("\n");
    if (
      !window.confirm(
        `将在“${folder.title}”下创建或复用分类文件夹：\n\n${preview}\n\n将移动 ${total} 个直属书签，已有子文件夹的内容不会移动。继续吗？`,
      )
    ) {
      return;
    }

    setApplyingFolders(true);
    let moved = 0;
    try {
      for (const group of plan) {
        const target =
          group.existingFolderId ??
          (
            await createFolder(selected, group.category)
          )?.id;
        if (!target) throw new Error(`创建文件夹失败：${group.category}`);
        for (const bookmarkId of group.bookmarkIds) {
          await moveBookmark(bookmarkId, target);
          moved += 1;
        }
      }
      await reload();
      toast(`已归入文件夹 ${moved} 个书签`, "success");
    } catch (err: any) {
      await reload();
      toast(err?.message ?? "应用到文件夹失败", "error");
    } finally {
      setApplyingFolders(false);
    }
  };

  const runEngineSearch = useCallback(
    (text: string, engineId = settings.searchEngine) => {
      const q = text.trim();
      if (!q) return;
      const engine =
        findEngine(settings, engineId) ?? findEngine(settings, "google");
      if (engine) openExternal(engine.url(q));
    },
    [openExternal, settings],
  );

  const runCompareSearch = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q) return;
      for (const id of settings.compareEngines) {
        const eng = findEngine(settings, id);
        if (eng) window.open(eng.url(q), "_blank");
      }
      setSearchFocused(false);
    },
    [settings],
  );

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    runEngineSearch(q);
  };

  const canReorder = !!selected && !query.trim() && items.length > 0;

  const onDragStart = (e: React.DragEvent, id: string) => {
    if (!canReorder) return;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    document.body.style.cursor = "grabbing";
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!canReorder || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverId(id);
  };
  const onDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!canReorder || !dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const src = items.find((i) => i.id === dragId);
    const tgt = items.find((i) => i.id === targetId);
    if (!src || !tgt || src.parentId !== tgt.parentId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const siblingIds = items
      .filter((x) => x.parentId === tgt.parentId)
      .map((x) => x.id);
    const srcIdx = siblingIds.indexOf(dragId);
    const dstIdx = siblingIds.indexOf(targetId);
    const nextAll = [...items];
    const srcInAll = nextAll.findIndex((x) => x.id === dragId);
    const [moved] = nextAll.splice(srcInAll, 1);
    const dstInAll = nextAll.findIndex((x) => x.id === targetId);
    nextAll.splice(dstInAll, 0, moved);
    setItems(nextAll.map((x, i) => ({ ...x, index: i })));
    try {
      if (src.parentId) {
        await moveBookmark(dragId, src.parentId, dstIdx);
      }
    } catch (err) {
      console.warn("reorder failed", err, srcIdx, dstIdx);
      toast("排序失败", "error");
      reload();
    } finally {
      setDragId(null);
      setOverId(null);
    }
  };

  const closeCtx = useCallback(() => setCtxMenu(null), []);
  useEffect(() => {
    if (!ctxMenu) return;
    const fn = () => closeCtx();
    window.addEventListener("click", fn);
    window.addEventListener("resize", fn);
    return () => {
      window.removeEventListener("click", fn);
      window.removeEventListener("resize", fn);
    };
  }, [ctxMenu, closeCtx]);

  useEffect(() => {
    if (!searchFocused) return;
    const close = (e: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node))
        setSearchFocused(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [searchFocused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (target?.isContentEditable ?? false);
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setSearchFocused(true);
        return;
      }
      if (!isTyping && e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMac]);

  const pinnedFolders = useMemo(() => {
    const ids = Array.from(pinnedIds);
    return ids
      .map((id) => findFolder(tree, id))
      .filter(Boolean) as BookmarkNode[];
  }, [pinnedIds, tree]);

  const commandItems = useMemo<SearchCommandItem[]>(() => {
    const q = query.trim();
    const currentEngine =
      findEngine(settings, settings.searchEngine) ??
      findEngine(settings, "google");
    const out: SearchCommandItem[] = [];

    if (q && currentEngine) {
      out.push({
        id: "engine-default",
        title: `用 ${currentEngine.name} 搜索 "${q}"`,
        subtitle: "默认回车执行搜索，书签结果可用方向键选择",
        badge: "Enter",
        iconUrl: `https://${currentEngine.host}`,
        onRun: () => runEngineSearch(q),
      });
      if (settings.compareEngines.length > 1) {
        out.push({
          id: "engine-compare",
          title: `在对比搜索中打开 "${q}"`,
          subtitle: `${settings.compareEngines.length} 个搜索引擎并行查询`,
          badge: isMac ? "⌘ Enter" : "Ctrl Enter",
          Icon: Columns,
          onRun: () => runCompareSearch(q),
        });
      }
    }

    const bookmarkResults = q ? filtered.slice(0, 6) : [];
    for (const b of bookmarkResults) {
      out.push({
        id: `bookmark-${b.id}`,
        title: b.title,
        subtitle: b.path
          ? `${hostnameOf(b.url)} · ${b.path}`
          : hostnameOf(b.url),
        badge: "bookmark",
        iconUrl: b.url,
        onRun: () => openExternal(b.url),
      });
    }

    const actions: SearchCommandItem[] = [
      {
        id: "action-cleaner",
        title: "打开清理中心",
        subtitle: "重复、失效、空文件夹扫描",
        badge: "action",
        Icon: Wand2,
        onRun: () => openDashboardTab("cleaner"),
      },
      {
        id: "action-compare",
        title: "打开对比搜索",
        subtitle: "多个搜索引擎并排查询",
        badge: "action",
        Icon: Columns,
        onRun: () => openDashboardTab("compare"),
      },
      {
        id: "action-ai",
        title: "打开 AI 助手",
        subtitle: "基于书签快照整理和检索",
        badge: "action",
        Icon: Bot,
        onRun: () => openDashboardTab("ai"),
      },
      {
        id: "action-backup",
        title: "打开备份",
        subtitle: "导入、导出 JSON 或 HTML",
        badge: "action",
        Icon: HardDriveDownload,
        onRun: () => openDashboardTab("backup"),
      },
      {
        id: "action-settings",
        title: "打开设置",
        subtitle: "主题、搜索引擎、AI 和扩展功能",
        badge: "action",
        Icon: Settings2,
        onRun: () => openDashboardTab("settings"),
      },
    ];
    const actionSource = q
      ? actions.filter((a) =>
          `${a.title} ${a.subtitle}`.toLowerCase().includes(q.toLowerCase()),
        )
      : actions.slice(0, 3);
    out.push(...actionSource);

    return out.slice(0, q ? 14 : 10);
  }, [
    filtered,
    isMac,
    openDashboardTab,
    openExternal,
    query,
    runCompareSearch,
    runEngineSearch,
    settings,
  ]);

  useEffect(() => {
    setActiveCommand(0);
  }, [commandItems.length, query]);

  const runCommand = useCallback(
    (index = activeCommand) => {
      const cmd = commandItems[index] ?? commandItems[0];
      cmd?.onRun();
    },
    [activeCommand, commandItems],
  );

  const greeting = useGreeting();
  const showHero = !selected && !query.trim();
  const isFolderView = !!selected;
  const showGithubTrendingWidget = settings.showGithubTrendingWidget ?? true;
  // 信息差雷达按子模块独立显隐：
  // - showInfoLiveNews   → NewsNow iframe
  // - showInfoEntries    → 下方「热点入口 + 信息差工具」资源入口卡片
  // 老版本只有 showInfoCollections 总开关，通过 isHomeWidgetVisible 回退兼容。
  const showInfoLiveNews = isHomeWidgetVisible(settings, "showInfoLiveNews");
  const showInfoEntries = isHomeWidgetVisible(settings, "showInfoEntries");
  const hasInfoRadar = showInfoLiveNews || showInfoEntries;
  const showTopSites = settings.showTopSites ?? true;
  const hasTopSitesSection = showTopSites && topSites.length > 0;

  const hideHomeWidget = useCallback(
    async (
      key:
        | "showGithubTrendingWidget"
        | "showInfoLiveNews"
        | "showInfoEntries"
        | "showTopSites",
      shortNameKey: string,
    ) => {
      await setSettings({ [key]: false });
      toast(t("home.widgetHidden", t(shortNameKey)), "success");
    },
    [t],
  );

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)]",
        isFolderView &&
          "md:h-[calc(100vh-13.5rem)] md:min-h-0 md:overflow-hidden",
      )}
    >
      <aside
        className={cn(
          "space-y-3 md:sticky md:top-20 md:self-start",
          isFolderView && "md:flex md:h-full md:min-h-0 md:flex-col",
        )}
      >
        {pinnedFolders.length > 0 && (
          <Card className="p-2">
            <div className="mb-1 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
              <Pin className="h-3.5 w-3.5" /> 置顶
            </div>
            <div className="space-y-0.5 text-sm">
              {pinnedFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFolder(f.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-accent",
                    selected === f.id && "bg-accent",
                  )}
                >
                  <span className="h-2 w-2 rounded-full bg-gradient-to-br from-blue-500 to-fuchsia-500" />
                  <span className="flex-1 truncate">{f.title}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
        <Card
          className={cn(
            "p-2 max-h-[76vh] overflow-auto scrollbar-thin",
            isFolderView && "md:min-h-0 md:max-h-none md:flex-1",
          )}
        >
          <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
            {t("dash.folders")}
          </div>
          <FolderTree
            tree={tree}
            selectedId={selected}
            expanded={expanded}
            pinnedIds={pinnedIds}
            onToggle={onToggleExpand}
            onSelect={(id) => onSelectFolder(id)}
            onTogglePin={onTogglePin}
          />
        </Card>
      </aside>

      <section
        className={cn(
          "min-w-0",
          isFolderView
            ? "flex h-full min-h-0 flex-col gap-5 space-y-0"
            : "space-y-5",
        )}
      >
        {showHero && (
          <div className="mb-2 pt-4 text-center">
            <div className="text-2xl font-semibold tracking-tight text-foreground/90">
              {greeting} <span className="ml-1">👋</span>
            </div>
          </div>
        )}

        <form
          onSubmit={onSubmitSearch}
          className="relative mx-auto w-full max-w-3xl"
          ref={searchWrapRef}
        >
          <div
            className={cn(
              "group/search relative flex items-center gap-1.5 rounded-2xl border bg-card pl-1.5 pr-1.5 shadow-sm transition-all duration-200",
              "focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/20",
            )}
          >
            <EngineSwitcher
              settings={settings}
              value={settings.searchEngine}
              onChange={onChangeEngine}
              onOpenChange={(open) => {
                if (open) setSearchFocused(false);
              }}
            />
            <span
              aria-hidden
              className="h-5 w-px bg-border/80"
            />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value) setSearchFocused(true);
                }}
                onClick={() => setSearchFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (query) {
                      setQuery("");
                    } else {
                      setSearchFocused(false);
                      searchInputRef.current?.blur();
                    }
                    return;
                  }
                  if (
                    (e.key === "ArrowDown" || e.key === "ArrowUp") &&
                    commandItems.length
                  ) {
                    e.preventDefault();
                    setSearchFocused(true);
                    setActiveCommand((idx) => {
                      const delta = e.key === "ArrowDown" ? 1 : -1;
                      return (idx + delta + commandItems.length) %
                        commandItems.length;
                    });
                    return;
                  }
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    query.trim()
                  ) {
                    e.preventDefault();
                    runCompareSearch(query);
                    return;
                  }
                  if (e.key === "Enter" && searchFocused && commandItems.length) {
                    e.preventDefault();
                    runCommand(activeCommand);
                    return;
                  }
                  if (!searchFocused) setSearchFocused(true);
                }}
                placeholder={t("dash.searchPlaceholder")}
                className="h-11 border-0 bg-transparent pl-8 pr-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {query && (
              <button
                type="button"
                aria-label={t("dash.searchClear")}
                title={t("dash.searchClear")}
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {!query && (
              <kbd
                aria-hidden
                className="pointer-events-none hidden select-none items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-muted-foreground shadow-sm sm:inline-flex"
              >
                <span className="text-[11px] leading-none">
                  {isMac ? "⌘" : "Ctrl"}
                </span>
                <span className="leading-none">K</span>
              </kbd>
            )}
            <Button
              type="submit"
              className="ml-1 h-9 w-9 rounded-xl p-0 sm:w-auto sm:px-4"
              variant="default"
              aria-label={t("common.search")}
              title={t("common.search")}
            >
              <Search className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">{t("common.search")}</span>
            </Button>
          </div>

          {searchFocused && query.trim() && (
            <div className="mx-2 mt-1.5 flex items-center px-1 text-[11px] text-muted-foreground">
              <span>
                {filtered.length > 0
                  ? t("dash.matchCount", String(filtered.length))
                  : t("dash.matchNone")}
              </span>
            </div>
          )}

          {searchFocused && commandItems.length > 0 && (
            <SearchCommandPalette
              items={commandItems}
              activeIndex={activeCommand}
              onActiveChange={setActiveCommand}
              query={query}
              onClose={() => setSearchFocused(false)}
            />
          )}


        </form>

        {showHero && hasTopSitesSection && (
          <div className="md:hidden mx-auto flex max-w-4xl flex-wrap items-start justify-center gap-4 pt-2">
            {topSites.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="group flex w-20 flex-col items-center gap-1"
                title={s.url}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition group-hover:-translate-y-0.5 group-hover:shadow-md">
                  <CachedFavicon
                    url={s.url}
                    className="h-7 w-7 rounded-full"
                  />
                </div>
                <div className="w-full truncate text-center text-[11px] text-muted-foreground">
                  {s.title || hostnameOf(s.url)}
                </div>
              </a>
            ))}
          </div>
        )}

        {showHero && (
          <FriendLinksCard
            links={friendLinks.links}
            sourceLabel={
              friendLinks.folderFound
                ? settings.friendLinksFolderName || "Link"
                : "默认入口"
            }
          />
        )}

        {showHero && (() => {
          // 信息差雷达拆分成 2 个独立模块（iframe + 资源入口卡片），与右栏
          // sidebar widgets 一起共 4 个可选块。自适应布局按「主区是否有内容」
          // 与「右栏是否有内容」组合：
          //   A. 主区有信息雷达 + 右栏有 widgets → 三栏（主区雷达 + sidebar 280）
          //   B. 主区有信息雷达 + 右栏无 widgets → 主区独占全宽
          //   C. 主区无信息雷达 + 右栏有 widgets → widgets fallback 升级到主区
          //   D. 全部隐藏 → 不渲染（返回 null）
          const hasRightWidgets = hasTopSitesSection || showGithubTrendingWidget;
          if (!hasInfoRadar && !hasRightWidgets) return null;

          // 复用同一份 JSX 避免 props 列表重复；在三栏场景中会被渲染两次
          // （中小屏 fallback + xl sidebar），这点与旧逻辑保持一致
          const liveNewsEl = showInfoLiveNews && (
            <InfoLiveNews
              language={settings.language}
              onHide={() =>
                hideHomeWidget(
                  "showInfoLiveNews",
                  "home.widgetShort.infoLiveNews",
                )
              }
              hideLabel={t("home.hideWidget")}
              hideTooltip={t(
                "home.hideWidgetTooltip",
                t("home.widgetShort.infoLiveNews"),
              )}
            />
          );
          const entriesEl = showInfoEntries && (
            <InfoEntries
              language={settings.language}
              onHide={() =>
                hideHomeWidget(
                  "showInfoEntries",
                  "home.widgetShort.infoEntries",
                )
              }
              hideLabel={t("home.hideWidget")}
              hideTooltip={t(
                "home.hideWidgetTooltip",
                t("home.widgetShort.infoEntries"),
              )}
            />
          );
          // 主区信息雷达堆叠容器：上 iframe（可拉伸）+ 下资源入口卡（自然高度）。
          // 当只剩 entries 时，section 退化为单卡，不需要外层 flex-col 拉伸。
          // 当只剩 iframe 时，iframe 自然撑满（其内部 flex-1 + min-h 已处理）。
          const infoRadarStack = hasInfoRadar && (
            <div className="flex h-full min-h-0 flex-col gap-3.5">
              {liveNewsEl}
              {entriesEl}
            </div>
          );
          const topSitesEl = hasTopSitesSection && (
            <TopSitesSidebar
              items={topSites}
              onHide={() =>
                hideHomeWidget("showTopSites", "home.widgetShort.topSites")
              }
              hideLabel={t("home.hideWidget")}
              hideTooltip={t(
                "home.hideWidgetTooltip",
                t("home.widgetShort.topSites"),
              )}
            />
          );
          const trendingEl = showGithubTrendingWidget && (
            <TrendingSidebar
              settings={settings}
              mode={widgetMode}
              onModeChange={setWidgetMode}
              range={widgetRange}
              onRangeChange={setWidgetRange}
              onOpenDiscover={onOpenDiscover}
              onHide={() =>
                hideHomeWidget(
                  "showGithubTrendingWidget",
                  "home.widgetShort.githubTrending",
                )
              }
              hideLabel={t("home.hideWidget")}
              hideTooltip={t(
                "home.hideWidgetTooltip",
                t("home.widgetShort.githubTrending"),
              )}
            />
          );

          // Case C: 信息差雷达全部隐藏 → sidebar widget 升级到主区
          if (!hasInfoRadar) {
            const twoWidgets = hasTopSitesSection && showGithubTrendingWidget;
            return (
              <div
                className={cn(
                  "grid gap-5 pt-2 grid-cols-1",
                  twoWidgets && "md:grid-cols-2",
                )}
              >
                {topSitesEl}
                {trendingEl}
              </div>
            );
          }

          // Case B: 只有信息差雷达 → 主区独占全宽
          if (!hasRightWidgets) {
            return <div className="pt-2">{infoRadarStack}</div>;
          }

          // Case A: 三栏（主区信息雷达堆叠 + 右栏 widget 堆叠）
          // 主区 grid cell 默认 stretch 到 sidebar 高度；主区内用 flex flex-col 让
          // iframe 撑满（其内部 flex-1，拉伸消除底部留白）。
          return (
            <div className="grid grid-cols-1 gap-5 pt-2 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 space-y-5 xl:flex xl:flex-col xl:gap-5 xl:space-y-0">
                <div className="xl:flex xl:flex-1 xl:min-h-0 xl:flex-col">
                  {infoRadarStack}
                </div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:hidden">
                  {topSitesEl}
                  {trendingEl}
                </div>
              </div>
              {/* 右栏：仅 xl+，280px 固定，sticky 跟随主区滚动 */}
              <aside className="hidden space-y-5 xl:block xl:sticky xl:top-20 xl:self-start">
                {topSitesEl}
                {trendingEl}
              </aside>
            </div>
          );
        })()}

        {!showHero && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <button onClick={() => onSelectFolder("")} className="hover:text-foreground">
              全部书签
            </button>
            {breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  onClick={() => onSelectFolder(b.id)}
                  className="hover:text-foreground"
                >
                  {b.title}
                </button>
              </span>
            ))}
          </nav>
        )}

        {!showHero && subFolders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {subFolders.map((f) => (
              <button
                key={f.id}
                onClick={() => onSelectFolder(f.id)}
                className="group flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-sm shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.25)] hover:ring-1 hover:ring-primary/20"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 text-primary">
                  <Folder className="h-3.5 w-3.5" />
                </div>
                <span className="max-w-[140px] truncate">
                  {f.title || "(未命名)"}
                </span>
              </button>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div
            data-ai-progress
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              新范式进度
            </span>
            <span>
              已整理{" "}
              <strong className="text-foreground">{aiProgress.done}</strong>/
              {aiProgress.total}
            </span>
            <span>
              剩余{" "}
              <strong
                className={
                  aiProgress.remaining
                    ? "text-amber-600 dark:text-amber-300"
                    : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {aiProgress.remaining}
              </strong>
            </span>
            {aiProgress.skipped > 0 && (
              <span>隐私文件夹跳过 {aiProgress.skipped}</span>
            )}
          </div>
        )}

        {activeTagGroup && (
          <div className="w-full space-y-1.5 pb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <Tags className="h-3.5 w-3.5" />
                AI 标签
              </span>
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                className={cn(
                  "h-7 shrink-0 rounded-full border px-2.5 text-[11px] transition",
                  !tagFilter
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                本类全部
              </button>
              {aiTagGroups.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  onClick={() => setTagCategory(group.name)}
                  className={cn(
                    "h-7 max-w-44 truncate rounded-full border px-2.5 text-[11px] transition",
                    group.name === activeTagGroup.name
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {group.name}
                  <span className="ml-1 opacity-60">{group.tags.length}</span>
                </button>
              ))}
            </div>
            <div className="flex max-h-[3.875rem] flex-wrap content-start gap-1.5 overflow-y-auto scrollbar-thin">
              {activeTagGroup.tags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  title={`${tag} (${count})`}
                  onClick={() =>
                    setTagFilter((current) => (current === tag ? null : tag))
                  }
                  className={cn(
                    "h-7 max-w-44 truncate rounded-full border px-2.5 text-[11px] transition",
                    tagFilter === tag
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tag}
                  <span className="ml-1 opacity-60">{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {pendingOrganizeJob && !organizing && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <RefreshCw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
            <span className="min-w-0 flex-1">
              检测到未完成的 AI 整理任务
              {pendingOrganizeJob.processed
                ? `，已处理 ${pendingOrganizeJob.processed}/${pendingOrganizeJob.bookmarkIds.length}`
                : ""}
              。任务不会自动继续。
            </span>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => void continuePendingOrganizeJob()}
            >
              继续
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => void discardPendingOrganizeJob()}
            >
              清除任务
            </Button>
          </div>
        )}

        <div
          data-bookmark-scroll
          className={cn(
            isFolderView &&
              "min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 scrollbar-thin",
          )}
        >
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-1.5 pt-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 text-primary">
                <Folder className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">
                我的书签
              </h2>
              <span className="text-[11px] text-muted-foreground">
                · 共 {filtered.length} 个
                {query.trim() ? "（已过滤）" : ""}
              </span>
              {pageSize !== Infinity && filtered.length > pageSize && (
                <span className="text-[11px] text-muted-foreground/70">
                  · 第 {(page - 1) * pageSize + 1}-
                  {Math.min(page * pageSize, filtered.length)} 条
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canReorder && (
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                  <GripVertical className="h-3 w-3" />
                  {t("dash.dragHint")}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onOrganizeBookmarks("incremental")}
                disabled={!!organizing || items.length === 0}
                className="h-7 gap-1.5 rounded-md px-2 text-[11px]"
                title="只处理新增或尚未分析的书签"
              >
                {organizing && organizeMode !== "rebuild" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {organizing && organizeMode !== "rebuild"
                  ? `${organizing.done}/${organizing.total}`
                  : "增量整理"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onOrganizeBookmarks("rebuild")}
                disabled={!!organizing || items.length === 0}
                className="h-7 gap-1.5 rounded-md px-2 text-[11px]"
                title="忽略已有分析记录，按新规则重新整理当前范围全部书签"
              >
                {organizing && organizeMode === "rebuild" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {organizing && organizeMode === "rebuild"
                  ? `${organizing.done}/${organizing.total}`
                  : "重新整理"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onApplyFolders}
                disabled={
                  applyingFolders || !selected || items.length === 0
                }
                className="h-7 gap-1.5 rounded-md px-2 text-[11px]"
                title="按 AI 分类把当前文件夹的直属书签归入子文件夹"
              >
                {applyingFolders ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FolderInput className="h-3 w-3" />
                )}
                {applyingFolders ? "归入中" : "归入文件夹"}
              </Button>
              <PageSizePicker value={pageSize} onChange={onChangePageSize} />
              {pageSize !== Infinity && pageCount > 1 && (
                <Pager page={page} pageCount={pageCount} onChange={setPage} />
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5">
          {pagedItems.map((b) => {
            const meta = bookmarkMeta[b.id];
            const tagParts = getBookmarkTagParts(b.title, meta);
            const purpose = getBookmarkPurpose(meta);
            return (
              <div
              key={b.id}
              draggable={canReorder}
              onDragStart={(e) => onDragStart(e, b.id)}
              onDragEnd={() => {
                document.body.style.cursor = "";
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => onDragOver(e, b.id)}
              onDrop={(e) => onDrop(e, b.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({
                  id: b.id,
                  url: b.url,
                  title: b.title,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              className={cn(
                "group relative flex min-h-[108px] items-start rounded-xl border border-border/60 bg-card p-3.5 text-left shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all duration-200 ease-out",
                "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.25)] hover:ring-1 hover:ring-primary/20",
                canReorder && "cursor-grab",
                dragId === b.id && "cursor-grabbing opacity-50",
                overId === b.id && dragId !== b.id && "ring-2 ring-primary/60",
                settings.cardDensity === "compact" && "min-h-[96px] p-3",
              )}
              title={purpose ? `${tagParts.baseTitle}\n${purpose}` : b.url}
            >
              <a
                href={b.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "flex w-full min-w-0 items-start gap-3 pr-4",
                  canReorder && "cursor-inherit",
                )}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-50 to-slate-100 ring-1 ring-inset ring-black/5 transition-all duration-200 group-hover:ring-primary/30 group-hover:shadow-sm dark:from-slate-800 dark:to-slate-900 dark:ring-white/5">
                  <CachedFavicon
                    url={b.url}
                    className="h-6 w-6"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold tracking-tight">
                    {tagParts.baseTitle}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] text-muted-foreground"
                    title={b.url}
                  >
                    {bookmarkUrlLabel(b.url)}
                  </div>
                  {meta && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        {tagParts.manualTags.map((tag) => (
                          <span
                            key={`manual-${tag}`}
                            className="inline-flex max-w-[100px] items-center gap-1 truncate rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
                            title="人工标签，AI 不会修改"
                          >
                            <LockKeyhole className="h-2.5 w-2.5 shrink-0" />
                            {tag}
                          </span>
                        ))}
                        {tagParts.aiTags.map((tag) => (
                          <span
                            key={`ai-${tag}`}
                            className="inline-flex max-w-[100px] items-center gap-1 truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                            title="AI 标签"
                          >
                            <Sparkles className="h-2.5 w-2.5 shrink-0" />
                            {tag}
                          </span>
                        ))}
                        {!tagParts.tags.length && (
                          <span className="max-w-full truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {meta.category}
                          </span>
                        )}
                      </div>
                      {purpose && (
                        <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                          {purpose}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </a>
              <ExternalLink className="absolute right-2 top-2 h-3 w-3 text-muted-foreground opacity-0 transition group-hover:opacity-70" />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtxMenu({
                    id: b.id,
                    url: b.url,
                    title: b.title,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                className="absolute bottom-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
                aria-label="more"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {canReorder && (
                <GripVertical className="pointer-events-none absolute left-1 top-1 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-60" />
              )}
              </div>
            );
          })}
          {!filtered.length && !subFolders.length && (
            <div className="col-span-full rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              {t("dash.empty")}
            </div>
          )}
        </div>

        {pageSize !== Infinity &&
          pageCount > 1 &&
          filtered.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Pager page={page} pageCount={pageCount} onChange={setPage} />
              <span className="text-[11px] text-muted-foreground">
                共 {filtered.length} 条
              </span>
            </div>
          )}
        </div>
      </section>

      {ctxMenu && (
        <BookmarkCtxMenu
          {...ctxMenu}
          onCopy={async () => {
            await navigator.clipboard.writeText(ctxMenu.url);
            toast(t("common.copied"), "success");
            setCtxMenu(null);
          }}
          onQr={() => {
            setQrUrl(ctxMenu.url);
            setCtxMenu(null);
          }}
          onEdit={() => {
            setEditBookmarkId(ctxMenu.id);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {qrUrl && <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />}
      <BookmarkCollectDialog
        open={!!editBookmarkId}
        onOpenChange={(next) => {
          if (!next) setEditBookmarkId(null);
        }}
        settings={settings}
        editBookmarkId={editBookmarkId ?? undefined}
        onSaved={async () => {
          setBookmarkMeta(await loadBookmarkMeta());
          await reload();
        }}
      />
    </div>
  );
}

function SearchCommandPalette({
  items,
  activeIndex,
  onActiveChange,
  query,
  onClose,
}: {
  items: SearchCommandItem[];
  activeIndex: number;
  onActiveChange: (index: number) => void;
  query: string;
  onClose: () => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex]);

  return (
    <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-slate-950/10 ring-1 ring-black/5 backdrop-blur supports-[backdrop-filter]:bg-popover/90 dark:ring-white/10">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
        className="absolute right-2 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
        title="关闭"
        aria-label="关闭搜索结果"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-3 py-2 pr-10 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Command className="h-3.5 w-3.5" />
          {query.trim() ? "统一搜索" : "快捷入口"}
        </span>
        <span>↑↓ 选择 · Enter 打开</span>
      </div>
      <div className="max-h-[360px] overflow-auto px-1.5 py-1 scrollbar-thin">
        <div className="divide-y divide-border/60">
          {items.map((item, index) => {
            const active = activeIndex === index;
            const Icon = item.Icon ?? BookmarkIcon;
            return (
              <div key={item.id} className="py-1 first:pt-0 last:pb-0">
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  onMouseEnter={() => onActiveChange(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={item.onRun}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-150",
                    active
                      ? "bg-primary/10 text-foreground shadow-sm ring-1 ring-primary/20"
                      : "text-foreground hover:bg-accent/70",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background shadow-[0_1px_0_rgba(15,23,42,0.03)] ring-1 ring-border/80">
                    {item.iconUrl ? (
                      <CachedFavicon
                        url={item.iconUrl}
                        className="h-4 w-4 rounded"
                      />
                    ) : (
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                      searchBadgeClass(item),
                    )}
                  >
                    {searchBadgeLabel(item)}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function searchBadgeLabel(item: SearchCommandItem): string {
  if (item.id === "engine-default") return "回车";
  if (item.id === "engine-compare") return "对比";
  if (item.id.startsWith("bookmark-")) return "书签";
  if (item.id.startsWith("history-")) return "历史";
  if (item.id.startsWith("top-")) return "常去";
  if (item.id.startsWith("action-")) return "动作";
  return item.badge;
}

function searchBadgeClass(item: SearchCommandItem): string {
  if (item.id === "engine-default") {
    return "bg-primary/10 text-primary ring-primary/20";
  }
  if (item.id === "engine-compare") {
    return "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300";
  }
  if (item.id.startsWith("bookmark-")) {
    return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300";
  }
  if (item.id.startsWith("history-")) {
    return "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
  }
  if (item.id.startsWith("top-")) {
    return "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300";
  }
  return "bg-muted text-muted-foreground ring-border";
}

function buildBreadcrumb(
  tree: BookmarkNode[],
  id: string,
): Array<{ id: string; title: string }> {
  const path: Array<{ id: string; title: string }> = [];
  const walk = (nodes: BookmarkNode[], chain: Array<{ id: string; title: string }>): boolean => {
    for (const n of nodes) {
      if (!n.url) {
        const here = n.title
          ? [...chain, { id: n.id, title: n.title }]
          : chain;
        if (n.id === id) {
          path.push(...here);
          return true;
        }
        if (n.children && walk(n.children, here)) return true;
      }
    }
    return false;
  };
  walk(tree, []);
  return path;
}

function bookmarkUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, "")}${path}${parsed.search}`.slice(
      0,
      120,
    );
  } catch {
    return url;
  }
}

function useGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "深夜好";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  if (h < 22) return "晚上好";
  return "夜深了";
}

function PageSizePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const options: Array<{ v: number; label: string }> = [
    { v: 24, label: "24" },
    { v: 60, label: "60" },
    { v: 120, label: "120" },
    { v: 240, label: "240" },
    { v: Infinity, label: "全部" },
  ];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  const current = options.find((o) => o.v === value)?.label ?? String(value);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
        title="每页条数"
      >
        每页 {current}
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-40 w-28 rounded-lg border bg-popover p-1 shadow-xl ring-1 ring-black/5 dark:ring-white/5"
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                onChange(o.v);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-accent",
                value === o.v && "bg-accent font-medium",
              )}
            >
              <span>{o.label}</span>
              {value === o.v && (
                <span className="text-[10px] text-primary">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 生成现代风格分页的页码序列：[1, "...", 4, 5, 6, "...", 19]
 * 始终显示首末页，当前页±1 作为邻页，其余用 ellipsis 合并。
 */
function buildPageRange(
  current: number,
  total: number,
  neighbor = 1,
): Array<number | "ellipsis-l" | "ellipsis-r"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | "ellipsis-l" | "ellipsis-r"> = [];
  const left = Math.max(2, current - neighbor);
  const right = Math.min(total - 1, current + neighbor);
  out.push(1);
  if (left > 2) out.push("ellipsis-l");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push("ellipsis-r");
  out.push(total);
  return out;
}

function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const jumpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!jumpOpen) return;
    const close = (e: MouseEvent) => {
      if (!jumpRef.current) return;
      if (!jumpRef.current.contains(e.target as Node)) setJumpOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [jumpOpen]);

  const prev = () => onChange(Math.max(1, page - 1));
  const next = () => onChange(Math.min(pageCount, page + 1));
  const items = buildPageRange(page, pageCount);

  const doJump = () => {
    const n = Number(jumpValue);
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
      onChange(Math.floor(n));
      setJumpOpen(false);
      setJumpValue("");
    }
  };

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={page <= 1}
        onClick={prev}
        className="flex h-7 w-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-muted-foreground"
        aria-label="上一页"
      >
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      </button>
      {items.map((it, idx) => {
        if (it === "ellipsis-l" || it === "ellipsis-r") {
          return (
            <div
              key={`${it}-${idx}`}
              ref={it === "ellipsis-r" ? jumpRef : undefined}
              className="relative"
            >
              <button
                type="button"
                onClick={() => {
                  setJumpOpen((v) => !v);
                  setJumpValue("");
                }}
                className="flex h-7 min-w-[28px] items-center justify-center rounded-md text-[12px] text-muted-foreground/80 transition hover:bg-accent hover:text-foreground"
                title="跳转页"
              >
                …
              </button>
              {jumpOpen && it === "ellipsis-r" && (
                <div
                  className="absolute left-1/2 top-9 z-40 -translate-x-1/2 rounded-lg border bg-popover p-2 shadow-xl ring-1 ring-black/5 dark:ring-white/5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      max={pageCount}
                      value={jumpValue}
                      onChange={(e) => setJumpValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doJump();
                        else if (e.key === "Escape") setJumpOpen(false);
                      }}
                      placeholder={`1-${pageCount}`}
                      className="h-7 w-24 rounded-md border bg-background px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      type="button"
                      onClick={doJump}
                      className="h-7 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      跳转
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }
        const active = it === page;
        return (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-[12px] tabular-nums transition",
              active
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "border bg-card text-muted-foreground hover:border-primary/30 hover:bg-accent hover:text-foreground",
            )}
          >
            {it}
          </button>
        );
      })}
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={next}
        className="flex h-7 w-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-muted-foreground"
        aria-label="下一页"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function BookmarkCtxMenu({
  x,
  y,
  onCopy,
  onQr,
  onEdit,
}: {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  onCopy: () => void;
  onQr: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(x, window.innerWidth - r.width - pad);
    const top = Math.min(y, window.innerHeight - r.height - pad);
    setPos({ left, top });
  }, [x, y]);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[60] min-w-[180px] rounded-lg border bg-popover p-1 text-sm shadow-lg"
      style={{ left: pos.left, top: pos.top }}
    >
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onEdit}
      >
        编辑标签与用途
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onCopy}
      >
        复制链接
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onQr}
      >
        生成二维码
      </button>
    </div>
  );
}
