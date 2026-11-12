import { ExternalLink, Link2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import CachedFavicon from "@/components/CachedFavicon";
import type { FriendLink } from "@/lib/friendLinks";

export default function FriendLinksCard({
  links,
  title = "友情链接",
  compact = false,
  sourceLabel,
}: {
  links: FriendLink[];
  title?: string;
  compact?: boolean;
  sourceLabel?: string;
}) {
  return (
    <Card className={compact ? "p-3" : "p-4"}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Link2 className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-[11px] text-muted-foreground">
          {links.length} 个入口
          {sourceLabel ? ` · ${sourceLabel}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            title={`${link.title} · ${link.url}`}
            className="group inline-flex h-10 w-[168px] shrink-0 items-center gap-2 rounded-lg border bg-background/60 px-2.5 transition hover:border-primary/30 hover:bg-accent/40"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border">
              <CachedFavicon
                url={link.url}
                className="h-5 w-5 rounded-full"
                fallbackLabel={link.title.slice(0, 1).toUpperCase()}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {link.title}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-70" />
          </a>
        ))}
      </div>
    </Card>
  );
}
