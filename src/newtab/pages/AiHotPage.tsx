import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Flame,
  Loader2,
  Newspaper,
  RefreshCw,
  Search,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import CachedFavicon from "@/components/CachedFavicon";
import {
  fetchAiHot,
  fetchAiLeaderboard,
  type AiHotItem,
  type AiLeaderboardItem,
} from "@/lib/aiHot";
import { cn } from "@/lib/utils";

type AiHotView = "feed" | "leaderboard";

export default function AiHotPage() {
  const [view, setView] = useState<AiHotView>("feed");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AiHotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [leaderboard, setLeaderboard] = useState<AiLeaderboardItem[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [leaderboardStale, setLeaderboardStale] = useState(false);
  const [leaderboardFetchedAt, setLeaderboardFetchedAt] = useState(0);

  const loadFeed = async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAiHot(force);
      setItems(result.items);
      setFetchedAt(result.fetchedAt);
      setStale(result.stale);
    } catch (err: any) {
      setError(err?.message ?? "AI 快讯加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadLeaderboard = async (force = false) => {
    setLeaderboardLoading(true);
    setLeaderboardError("");
    try {
      const result = await fetchAiLeaderboard(force);
      setLeaderboard(result.items);
      setLeaderboardFetchedAt(result.fetchedAt);
      setLeaderboardStale(result.stale);
    } catch (err: any) {
      setLeaderboardError(err?.message ?? "AI 模型排行榜加载失败");
    } finally {
      setLeaderboardLoading(false);
    }
  };

  useEffect(() => {
    if (view === "feed" && !items.length) void loadFeed();
    if (view === "leaderboard" && !leaderboard.length) void loadLeaderboard();
  }, [view]);

  useEffect(() => {
    if (view !== "leaderboard") return;
    const timer = window.setInterval(
      () => void loadLeaderboard(true),
      15 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [view]);

  const filteredFeed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.title} ${item.summary} ${item.source} ${item.category}`
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  const filteredLeaderboard = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leaderboard;
    return leaderboard.filter((item) => item.name.toLowerCase().includes(q));
  }, [leaderboard, query]);

  const currentLoading = view === "feed" ? loading : leaderboardLoading;
  const currentFetchedAt = view === "feed" ? fetchedAt : leaderboardFetchedAt;
  const currentStale = view === "feed" ? stale : leaderboardStale;
  const currentError = view === "feed" ? error : leaderboardError;

  const refresh = () => {
    if (view === "feed") void loadFeed(true);
    else void loadLeaderboard(true);
  };

  const switchView = (next: AiHotView) => {
    setView(next);
    setQuery("");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Newspaper className="h-5 w-5 text-primary" />
            AI 快讯
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {view === "feed" ? "来自 AIHOT 的精选动态" : "AIHOT 大模型综合排行榜"}
            {currentFetchedAt
              ? ` · ${new Date(currentFetchedAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })} 更新`
              : ""}
            {currentStale ? " · 当前使用缓存" : ""}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={view === "feed" ? "搜索快讯" : "搜索模型"}
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={currentLoading}
            title={view === "feed" ? "刷新 AI 快讯" : "刷新模型排行"}
          >
            {currentLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button asChild variant="outline" size="icon">
            <a
              href={
                view === "feed"
                  ? "https://aihot.news/"
                  : "https://aihot.news/leaderboard"
              }
              target="_blank"
              rel="noreferrer"
              title={view === "feed" ? "打开 AIHOT" : "打开 AI 模型排行榜"}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <div className="inline-flex rounded-lg border bg-card p-0.5 text-xs">
        <button
          type="button"
          onClick={() => switchView("feed")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition",
            view === "feed"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Newspaper className="h-3.5 w-3.5" />
          AIHOT 精选
        </button>
        <button
          type="button"
          onClick={() => switchView("leaderboard")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition",
            view === "leaderboard"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Trophy className="h-3.5 w-3.5" />
          AI 大模型排行榜
        </button>
      </div>

      {currentError && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            {currentError}
          </CardContent>
        </Card>
      )}

      {view === "feed" ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {loading && !items.length
            ? Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[150px] animate-pulse rounded-xl border bg-card"
                />
              ))
            : filteredFeed.map((item) => (
                <a
                  key={item.id}
                  href={item.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex min-h-[150px] gap-3 rounded-xl border bg-card p-4 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
                    <CachedFavicon
                      url={item.originalUrl}
                      className="h-5 w-5 rounded-full"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{item.source}</span>
                      <span>·</span>
                      <span className="shrink-0">
                        {formatPublishedAt(item.publishedAt)}
                      </span>
                      {item.score > 0 && (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400">
                          <Flame className="h-3 w-3" />
                          {item.score}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug">
                      {item.title}
                    </h2>
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      {item.summary}
                    </p>
                    <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground/75">
                      {item.reason}
                    </p>
                  </div>
                </a>
              ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {leaderboardLoading && !leaderboard.length
            ? Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[88px] animate-pulse rounded-xl border bg-card"
                />
              ))
            : filteredLeaderboard.map((item) => (
                <a
                  key={`${item.rank}-${item.name}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex min-h-[88px] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums ring-1",
                      item.rank === 1
                        ? "bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300"
                        : item.rank === 2
                          ? "bg-slate-500/15 text-slate-600 ring-slate-500/30 dark:text-slate-300"
                          : item.rank === 3
                            ? "bg-orange-500/15 text-orange-600 ring-orange-500/30 dark:text-orange-300"
                            : "bg-muted text-muted-foreground ring-border",
                    )}
                  >
                    #{item.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">
                      {item.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      AIHOT 大模型综合榜
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-70" />
                </a>
              ))}
        </div>
      )}

      {!currentLoading &&
        !currentError &&
        (view === "feed" ? !filteredFeed.length : !filteredLeaderboard.length) && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {query ? "没有匹配结果" : "暂无数据"}
          </div>
        )}
    </div>
  );
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
