import { useEffect, useState } from "react";
import { Github, Globe2 } from "lucide-react";
import { getCachedSiteIcon } from "@/lib/iconCache";
import { cn } from "@/lib/utils";

export default function CachedFavicon({
  url,
  className,
  title,
  fallbackLabel,
}: {
  url: string;
  className?: string;
  title?: string;
  fallbackLabel?: string;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    setSrc("");
    getCachedSiteIcon(url).then((next) => {
      if (alive) setSrc(next);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  if (isGitHubUrl(url)) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center text-foreground",
          className,
        )}
        title={title}
        aria-hidden="true"
      >
        <Github className="h-[72%] w-[72%]" strokeWidth={1.8} />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center justify-center", className)}
      title={title}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" />
      ) : fallbackLabel ? (
        <span className="text-[0.8em] font-semibold">{fallbackLabel}</span>
      ) : (
        <Globe2 className="h-3.5 w-3.5 text-muted-foreground/70" />
      )}
    </span>
  );
}

function isGitHubUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "github.com" || hostname === "www.github.com";
  } catch {
    return false;
  }
}
