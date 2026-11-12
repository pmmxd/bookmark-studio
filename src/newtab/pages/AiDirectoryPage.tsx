import { useEffect, useMemo, useState } from "react";
import {
  Compass,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchAiDirectory,
  type AiDirectoryItem,
} from "@/lib/aiDirectory";
import { cn } from "@/lib/utils";
import FriendLinksCard from "@/components/FriendLinksCard";
import { AI_NAV_FRIEND_LINKS } from "@/lib/friendLinks";
import { useFriendLinks } from "@/hooks/useFriendLinks";
import type { Settings } from "@/types";

const PAGE_STEP = 48;

export default function AiDirectoryPage({ settings }: { settings: Settings }) {
  const [items, setItems] = useState<AiDirectoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [limit, setLimit] = useState(PAGE_STEP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const friendLinks = useFriendLinks(
    settings.friendLinksFolderName ?? "Link",
    settings.friendLinksFolderId,
    AI_NAV_FRIEND_LINKS,
  );

  const load = async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAiDirectory(force);
      setItems(result.items);
      setFetchedAt(result.fetchedAt);
      setStale(result.stale);
    } catch (err: any) {
      setError(err?.message ?? "AI 工具集加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "全部" && item.category !== category) return false;
      if (!q) return true;
      return `${item.title} ${item.description} ${item.category} ${item.url}`
        .toLowerCase()
        .includes(q);
    });
  }, [category, items, query]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    return ["全部", ...items.map((item) => item.category)].filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [items]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Compass className="h-5 w-5 text-primary" />
            AI 工具导航
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            收录 {items.length} 个工具
            {fetchedAt
              ? ` · ${new Date(fetchedAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })} 更新`
              : ""}
            {stale ? " · 当前使用缓存" : ""}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_STEP);
              }}
              placeholder="搜索工具或用途"
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void load(true)}
            disabled={loading}
            title="刷新 AI 工具集"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button asChild variant="outline" size="icon">
            <a
              href="https://ai-bot.cn/"
              target="_blank"
              rel="noreferrer"
              title="打开 AI 工具集"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <FriendLinksCard
        links={friendLinks.links}
        title="推荐入口"
        compact
        sourceLabel={
          friendLinks.folderFound
            ? settings.friendLinksFolderName || "Link"
            : "默认入口"
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {categories.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setCategory(name);
              setLimit(PAGE_STEP);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs transition",
              category === name
                ? "border-primary/30 bg-primary/10 font-medium text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {name}
            <span className="ml-1 opacity-60">
              {name === "全部"
                ? items.length
                : items.filter((item) => item.category === name).length}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5">
        {loading && !items.length
          ? Array.from({ length: 9 }).map((_, index) => (
              <div
                key={index}
                className="h-[92px] animate-pulse rounded-xl border bg-card"
              />
            ))
          : filtered.slice(0, limit).map((item) => (
              <a
                key={`${item.id}-${item.url}`}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={`${item.title} · ${item.description}`}
                className={cn(
                  "group flex min-h-[88px] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-sm",
                  "transition duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
                )}
              >
                <ToolLogo item={item} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
                      {item.title}
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] text-primary">
                      {item.category}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    {item.description || "AI 工具"}
                  </p>
                </div>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-70" />
              </a>
            ))}
      </div>

      {!loading && !filtered.length && !error && (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          没有匹配的工具
        </div>
      )}

      {limit < filtered.length && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setLimit((value) => value + PAGE_STEP)}
          >
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolLogo({ item }: { item: AiDirectoryItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.icon || failed) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
        <Compass className="h-5 w-5" />
      </span>
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border">
      <img
        src={item.icon}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
