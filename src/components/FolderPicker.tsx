import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FolderStat } from "@/types";

export default function FolderPicker({
  folders,
  value,
  onChange,
  placeholder = "选择书签文件夹",
  disabled = false,
  allowCreate = false,
  onCreate,
}: {
  folders: FolderStat[];
  value?: string;
  onChange: (folder: FolderStat | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  allowCreate?: boolean;
  onCreate?: (
    base: FolderStat | undefined,
    segments: string[],
  ) => Promise<FolderStat | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const selected = folders.find((folder) => folder.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", close);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      window.removeEventListener("mousedown", close);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return folders
      .filter(
        (folder) =>
          !q ||
          folder.path.toLowerCase().includes(q) ||
          folder.title.toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [folders, query]);

  const createSegments = useMemo(() => {
    if (!allowCreate || !query.trim()) return [];
    return query
      .replace(/^\/+/, "")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 12);
  }, [allowCreate, query]);

  const createFolder = async () => {
    if (!onCreate || !createSegments.length) return;
    setCreating(true);
    try {
      const folder = await onCreate(selected, createSegments);
      if (folder) onChange(folder);
      setOpen(false);
      setQuery("");
    } catch (err) {
      console.warn("folder creation failed", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div
        className={cn(
          "flex h-10 w-full min-w-0 items-center rounded-md border bg-background pl-3 pr-1 text-left text-sm transition",
          open && "ring-2 ring-ring",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !selected && "text-muted-foreground",
              value && !selected && "text-destructive",
            )}
          >
            {selected
              ? `${selected.path}（${selected.count}）`
              : value
                ? "文件夹已不存在，请重新选择"
                : placeholder}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {allowCreate && !disabled && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
              setQuery("/");
            }}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-primary"
            title="新建子文件夹"
            aria-label="新建子文件夹"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        )}
        {value && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange(undefined);
            }}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label="清除文件夹选择"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border bg-popover shadow-xl">
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文件夹名称或路径"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                  return;
                }
                if (event.key === "Enter") {
                  if (
                    createSegments.length > 0 &&
                    (query.trim().startsWith("/") || !filtered.length)
                  ) {
                    event.preventDefault();
                    void createFolder();
                    return;
                  }
                  if (filtered[0]) {
                    event.preventDefault();
                    onChange(filtered[0]);
                    setOpen(false);
                    setQuery("");
                  }
                }
              }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
            {filtered.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  onChange(folder);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent",
                  folder.id === value && "bg-accent",
                )}
                title={folder.path}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {folder.path || folder.title}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {folder.count}
                </span>
                {folder.id === value && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </button>
            ))}
            {allowCreate && createSegments.length > 0 && (
              <button
                type="button"
                disabled={creating}
                onClick={() => void createFolder()}
                className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2.5 py-2 text-left text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {creating ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  在“{selected?.title || "当前文件夹"}”下创建
                  {" / "}
                  {createSegments.join(" / ")}
                </span>
              </button>
            )}
            {!filtered.length && !createSegments.length && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                没有匹配的文件夹
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
