import { Flame } from "lucide-react";
import TrendingPanel from "@/components/TrendingPanel";
import type { Settings } from "@/types";
import { useT } from "@/lib/i18n";

interface Props {
  settings: Settings;
}

export default function Discover({ settings }: Props) {
  const t = useT();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-md shadow-rose-500/20">
          <Flame className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("discover.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {settings.trendingSource === "github"
              ? "GitHub 官方 Trending 页面，按官方当前排名展示。"
              : t("discover.subtitle")}
          </p>
        </div>
      </div>

      <TrendingPanel settings={settings} limit={30} />
    </div>
  );
}
