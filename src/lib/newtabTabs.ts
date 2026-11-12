import {
  Bookmark,
  Columns,
  Compass,
  Flame,
  HardDriveDownload,
  Newspaper,
  Settings2,
  Sparkles,
  Tags,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { NewtabTabId, Settings } from "@/types";

export interface NewtabTabDef {
  id: NewtabTabId;
  labelKey?: string;
  label?: string;
  Icon: LucideIcon;
  locked?: boolean;
}

export const NEWTAB_TAB_DEFS: NewtabTabDef[] = [
  { id: "dashboard", labelKey: "tabs.dashboard", Icon: Bookmark, locked: true },
  { id: "aiNav", label: "AI 导航", Icon: Compass },
  { id: "aiHot", label: "AI 快讯", Icon: Newspaper },
  { id: "discover", labelKey: "tabs.discover", Icon: Flame },
  { id: "cleaner", labelKey: "tabs.cleaner", Icon: Wand2 },
  { id: "compare", labelKey: "tabs.compare", Icon: Columns },
  { id: "ai", labelKey: "tabs.ai", Icon: Sparkles },
  { id: "channels", labelKey: "tabs.channels", Icon: Tags },
  { id: "backup", labelKey: "tabs.backup", Icon: HardDriveDownload },
  { id: "settings", labelKey: "tabs.settings", Icon: Settings2, locked: true },
];

export function isNewtabTabId(value: string | null): value is NewtabTabId {
  return NEWTAB_TAB_DEFS.some((tab) => tab.id === value);
}

export function isNewtabTabVisible(
  settings: Settings,
  id: NewtabTabId,
): boolean {
  const def = NEWTAB_TAB_DEFS.find((tab) => tab.id === id);
  if (def?.locked) return true;
  return !(settings.hiddenTabs ?? ["channels"]).includes(id);
}

export function newtabTabLabel(
  def: NewtabTabDef,
  t: (key: string) => string,
): string {
  return def.labelKey ? t(def.labelKey) : (def.label ?? def.id);
}
