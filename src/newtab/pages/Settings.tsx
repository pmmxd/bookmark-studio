import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getSettings, setSettings } from "@/lib/storage";
import type {
  AccentPreset,
  BookmarkNode,
  FolderStat,
  NewtabTabId,
  Settings,
  ThemePreset,
} from "@/types";
import { useT } from "@/lib/i18n";
import { detectOllama, testAi } from "@/lib/ai";
import { BUILTIN_ENGINES } from "@/lib/engines";
import {
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
  Flame,
  ExternalLink,
  Tags,
  FolderLock,
  FolderPlus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  LockKeyhole,
  PanelsTopLeft,
  Link2,
} from "lucide-react";
import { COMMON_LANGUAGES, clearTrendingCache } from "@/lib/github";
import type { TrendingMode, TrendingRange, TrendingSort } from "@/types";
import { toast } from "@/components/ui/toast";
import { THEME_PRESETS } from "@/lib/themePresets";
import { HOME_WIDGETS } from "@/lib/homeWidgets";
import { cn } from "@/lib/utils";
import { allFolders, createFolder, getTree } from "@/lib/bookmarks";
import CachedFavicon from "@/components/CachedFavicon";
import FolderPicker from "@/components/FolderPicker";
import {
  NEWTAB_TAB_DEFS,
  isNewtabTabVisible,
  newtabTabLabel,
} from "@/lib/newtabTabs";
import {
  ensureFriendLinksFolder,
  findFriendLinksFolder,
} from "@/lib/friendLinksBookmarks";
import { AI_NAV_FRIEND_LINKS } from "@/lib/friendLinks";

const ENGINE_LIST = BUILTIN_ENGINES.slice(0, 12);
const PRIMARY_ENGINE_IDS = [
  "google",
  "baidu",
  "bing",
  "yandex",
  "doubao",
  "kimi",
  "deepseek",
  "qwen",
];
const PRIMARY_ENGINES = PRIMARY_ENGINE_IDS.map((id) =>
  BUILTIN_ENGINES.find((engine) => engine.id === id),
).filter((engine): engine is (typeof BUILTIN_ENGINES)[number] => !!engine);

export default function SettingsPage() {
  const t = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [aiChannelInput, setAiChannelInput] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [ollamaMessage, setOllamaMessage] = useState("");
  const [bookmarkTree, setBookmarkTree] = useState<BookmarkNode[]>([]);
  const [folders, setFolders] = useState<FolderStat[]>([]);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [friendLinksBusy, setFriendLinksBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getSettings(), getTree()]).then(async ([initial, tree]) => {
      if (!alive) return;
      setS(initial);
      setBookmarkTree(tree);
      setFolders(allFolders(tree));
      if (initial.aiProvider !== "none" && initial.aiProvider !== "ollama") {
        return;
      }
      const found = await detectOllama();
      if (!alive) return;
      setOllamaModels(found.models);
      setOllamaMessage(found.message);
      if (found.ok && found.models.length) {
        const model = found.models.includes(initial.aiModel)
          ? initial.aiModel
          : found.models[0];
        const next = await setSettings({
          aiProvider: "ollama",
          aiBaseUrl: found.baseUrl,
          aiModel: model,
        });
        if (alive) setS(next);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void Promise.all([getTree(), getSettings()]).then(
        async ([tree, current]) => {
          setBookmarkTree(tree);
          const nextFolders = allFolders(tree);
          setFolders(nextFolders);
          const selected = current.friendLinksFolderId
            ? nextFolders.find(
                (folder) => folder.id === current.friendLinksFolderId,
              )
            : undefined;
          const resolved =
            selected ??
            findFriendLinksFolder(
              tree,
              current.friendLinksFolderName ?? "Link",
            );
          if (
            resolved &&
            (current.friendLinksFolderId !== resolved.id ||
              current.friendLinksFolderName !== resolved.title)
          ) {
            setS(
              await setSettings({
                friendLinksFolderId: resolved.id,
                friendLinksFolderName: resolved.title,
              }),
            );
          }
        },
      );
    };
    refresh();
    chrome.bookmarks?.onChanged?.addListener(refresh);
    chrome.bookmarks?.onMoved?.addListener(refresh);
    chrome.bookmarks?.onRemoved?.addListener(refresh);
    chrome.bookmarks?.onCreated?.addListener(refresh);
    return () => {
      chrome.bookmarks?.onChanged?.removeListener(refresh);
      chrome.bookmarks?.onMoved?.removeListener(refresh);
      chrome.bookmarks?.onRemoved?.removeListener(refresh);
      chrome.bookmarks?.onCreated?.removeListener(refresh);
    };
  }, []);

  if (!s) return null;

  const update = async (patch: Partial<Settings>) => {
    const next = await setSettings(patch);
    setS(next);
  };

  const toggleCompareEngine = async (id: string) => {
    const cur = new Set(s.compareEngines);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    if (cur.size === 0) cur.add("google");
    await update({ compareEngines: Array.from(cur) });
  };

  const toggleTabVisibility = async (id: NewtabTabId) => {
    if (id === "dashboard" || id === "settings") return;
    const hidden = new Set<NewtabTabId>(s.hiddenTabs ?? ["channels"]);
    hidden.has(id) ? hidden.delete(id) : hidden.add(id);
    await update({ hiddenTabs: Array.from(hidden) });
  };

  const onTestAi = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await testAi(s);
    setTestResult(r);
    setTesting(false);
  };

  const refreshBookmarkFolders = async () => {
    const tree = await getTree();
    setBookmarkTree(tree);
    setFolders(allFolders(tree));
  };

  const detectAndConfigure = async () => {
    setOllamaChecking(true);
    const found = await detectOllama();
    setOllamaModels(found.models);
    setOllamaMessage(found.message);
    if (found.ok && found.models.length) {
      const model = found.models.includes(s.aiModel)
        ? s.aiModel
        : found.models[0];
      await update({
        aiProvider: "ollama",
        aiBaseUrl: found.baseUrl,
        aiModel: model,
      });
      toast(`已连接 Ollama · ${model}`, "success");
    } else {
      toast(
        found.message || "未检测到本地 Ollama，请确认服务已启动",
        "error",
      );
    }
    setOllamaChecking(false);
  };

  const createPrivateFolder = async () => {
    const parent = bookmarkTree[0]?.children?.find((node) => !node.url);
    if (!parent) {
      toast("未找到可用的书签栏", "error");
      return;
    }
    setPrivateBusy(true);
    try {
      const existing = folders.find((folder) => folder.title === "隐私收藏");
      const folder = existing
        ? { id: existing.id }
        : await createFolder(parent.id, "隐私收藏");
      if (!folder) throw new Error("创建隐私收藏夹失败");
      await update({
        privateFolderId: folder.id,
        rootFolderId:
          s.rootFolderId === folder.id ? undefined : s.rootFolderId,
      });
      await refreshBookmarkFolders();
      toast("隐私收藏夹已锁定，看板与 AI 将自动忽略", "success");
    } catch (err: any) {
      toast(err?.message ?? "创建隐私收藏夹失败", "error");
    } finally {
      setPrivateBusy(false);
    }
  };

  const initializeFriendLinks = async () => {
    setFriendLinksBusy(true);
    try {
      const result = await ensureFriendLinksFolder(
        s.friendLinksFolderName ?? "Link",
        AI_NAV_FRIEND_LINKS,
        s.friendLinksFolderId,
      );
      await update({
        friendLinksInitialized: true,
        friendLinksFolderId: result.folderId,
      });
      await refreshBookmarkFolders();
      toast(
        result.added
          ? `友情链接文件夹已补全，新增 ${result.added} 个`
          : "友情链接文件夹已是最新",
        "success",
      );
    } catch (err: any) {
      toast(err?.message ?? "初始化友情链接失败", "error");
    } finally {
      setFriendLinksBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.theme")}>
            <div className="flex gap-2">
              {(
                [
                  ["system", t("settings.themeAuto")],
                  ["light", t("settings.themeLight")],
                  ["dark", t("settings.themeDark")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.theme === v ? "default" : "outline"}
                  onClick={() => update({ theme: v as Settings["theme"] })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.themePreset")}>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {THEME_PRESETS.map((p) => {
                  const active = (s.themePreset ?? "default") === p.key;
                  const isDark =
                    typeof document !== "undefined" &&
                    document.documentElement.classList.contains("dark");
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() =>
                        update({ themePreset: p.key as ThemePreset })
                      }
                      className={cn(
                        "group relative flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm",
                        active && "border-primary ring-2 ring-primary/20",
                      )}
                    >
                      <span
                        aria-hidden
                        className="mt-0.5 h-8 w-8 shrink-0 rounded-lg ring-1 ring-black/10 dark:ring-white/10"
                        style={{
                          backgroundColor: isDark
                            ? p.swatchDark
                            : p.swatchLight,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {p.shortLabel}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {p.label}
                          </span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                          {p.description}
                        </div>
                      </div>
                      {active && (
                        <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.themePresetHint")}
              </p>
            </div>
          </Row>
          <Row label={t("settings.accent")}>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["linear", t("settings.accentLinear")],
                  ["indigo", t("settings.accentIndigo")],
                  ["blue", t("settings.accentBlue")],
                  ["emerald", t("settings.accentEmerald")],
                  ["rose", t("settings.accentRose")],
                  ["amber", t("settings.accentAmber")],
                  ["violet", t("settings.accentViolet")],
                  ["cyan", t("settings.accentCyan")],
                  ["orange", t("settings.accentOrange")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={
                    (s.accentPreset ?? "linear") === v ? "default" : "outline"
                  }
                  onClick={() =>
                    update({ accentPreset: v as AccentPreset })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
            {(s.themePreset ?? "default") !== "default" && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("settings.accentDisabledByPreset")}
              </p>
            )}
          </Row>
          <Row label={t("settings.density")}>
            <div className="flex gap-2">
              {(
                [
                  ["comfy", t("settings.densityComfy")],
                  ["compact", t("settings.densityCompact")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.cardDensity === v ? "default" : "outline"}
                  onClick={() =>
                    update({ cardDensity: v as Settings["cardDensity"] })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.wallpaper")}>
            <Input
              placeholder={t("settings.wallpaperPh")}
              value={s.wallpaper ?? ""}
              onChange={(e) =>
                update({ wallpaper: e.target.value || undefined })
              }
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            友情链接文件夹
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="文件夹">
            <FolderPicker
              folders={folders}
              value={s.friendLinksFolderId}
              onChange={(folder) =>
                update({
                  friendLinksFolderId: folder?.id,
                  friendLinksFolderName:
                    folder?.title ?? s.friendLinksFolderName ?? "Link",
                  friendLinksInitialized: false,
                })
              }
              placeholder="搜索并选择友情链接文件夹"
            />
          </Row>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={initializeFriendLinks}
              disabled={friendLinksBusy}
            >
              {friendLinksBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              初始化 / 补全
            </Button>
            <span className="text-[11px] text-muted-foreground">
              按文件夹 ID 跟踪，移动或改名后会自动适配；文件夹内新增书签会自动生成友情链接。
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PanelsTopLeft className="h-4 w-4 text-primary" />
            导航 Tab
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {NEWTAB_TAB_DEFS.map((def) => {
            const label =
              def.id === "channels"
                ? s.collectionBoardName?.trim() || t("tabs.channels")
                : newtabTabLabel(def, t);
            const Icon = def.Icon;
            return (
              <div
                key={def.id}
                className="flex items-center gap-3 rounded-lg border bg-background/60 px-3 py-2.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {label}
                    {def.locked && (
                      <LockKeyhole className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {def.id === "channels"
                      ? "旧版 AI 渠道收藏看板，默认隐藏"
                      : def.locked
                        ? "固定显示，不可隐藏"
                        : "控制是否显示在新标签页导航"}
                  </div>
                </div>
                <Switch
                  checked={isNewtabTabVisible(s, def.id)}
                  disabled={def.locked}
                  onCheckedChange={() => void toggleTabVisibility(def.id)}
                  aria-label={`${label} 显示开关`}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderLock className="h-4 w-4 text-primary" />
            隐私收藏夹
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label="当前锁定">
            {s.privateFolderId ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {folders.find((folder) => folder.id === s.privateFolderId)
                    ?.path ?? "隐私收藏夹"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => update({ privateFolderId: undefined })}
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  取消锁定
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                尚未设置，当前所有书签都会被 AI 与看板读取。
              </span>
            )}
          </Row>
          <Row label="禁止 AI 读取">
            <div className="space-y-1.5">
              <Input
                value={(s.aiExcludedFolderNames ?? ["Tool", "VPN"]).join(", ")}
                onChange={(event) =>
                  update({
                    aiExcludedFolderNames: event.target.value
                      .split(/[,，\n]/)
                      .map((name) => name.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Tool, VPN"
              />
              <p className="text-xs text-muted-foreground">
                这些名称的文件夹及全部子目录不会发送给 AI；看板中仍可正常浏览。
              </p>
            </div>
          </Row>
          <Row label="指定文件夹">
            <div className="flex flex-col gap-2 sm:flex-row">
              <FolderPicker
                folders={folders}
                value={s.privateFolderId}
                onChange={(folder) => {
                  const id = folder?.id;
                  void update({
                    privateFolderId: id,
                    rootFolderId:
                      id && s.rootFolderId === id
                        ? undefined
                        : s.rootFolderId,
                  });
                }}
                placeholder="搜索并选择隐私文件夹"
              />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={createPrivateFolder}
                disabled={privateBusy}
              >
                {privateBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderPlus className="h-3.5 w-3.5" />
                )}
                创建并锁定
              </Button>
            </div>
          </Row>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            锁定后，该文件夹及子项不会出现在看板、搜索、AI
            对话和整理任务中，也不会发送给任何 AI 服务。原书签数据仍保留在浏览器中。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.search")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.defaultEngine")}>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_ENGINES.map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  variant={s.searchEngine === e.id ? "default" : "outline"}
                  onClick={() => update({ searchEngine: e.id })}
                  className="gap-1.5"
                >
                  <CachedFavicon
                    url={`https://${e.host}`}
                    className="h-3.5 w-3.5 rounded"
                  />
                  {e.name}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.compareEngines")}>
            <div className="flex flex-wrap gap-2">
              {ENGINE_LIST.map((e) => {
                const on = s.compareEngines.includes(e.id);
                return (
                  <Button
                    key={e.id}
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() => toggleCompareEngine(e.id)}
                    className="gap-1.5"
                  >
                    <CachedFavicon
                      url={`https://${e.host}`}
                      className="h-3.5 w-3.5 rounded"
                    />
                    {e.name}
                  </Button>
                );
              })}
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.extras")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.language")}>
            <div className="flex gap-2">
              {(
                [
                  ["auto", "Auto"],
                  ["zh", "中文"],
                  ["en", "English"],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.language === v ? "default" : "outline"}
                  onClick={() =>
                    update({ language: v as Settings["language"] })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.floatingBall")}>
            <div className="flex items-center gap-3">
              <Switch
                checked={s.floatingBall}
                onCheckedChange={(v) => update({ floatingBall: v })}
              />
              <span className="text-xs text-muted-foreground">
                {t("settings.floatingBallHint")}
              </span>
            </div>
          </Row>
          <Row label={t("settings.floatingDisabledDomains")}>
            <div className="flex flex-wrap gap-2">
              {(s.floatingDisabledDomains ?? []).length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("settings.floatingDisabledDomainsEmpty")}
                </span>
              ) : (
                (s.floatingDisabledDomains ?? []).map((d) => (
                  <span
                    key={d}
                    className="group inline-flex items-center gap-1 rounded-full border bg-muted/60 px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium">{d}</span>
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
                      title={t("settings.floatingDisabledDomainsRemove")}
                      onClick={() =>
                        update({
                          floatingDisabledDomains: (
                            s.floatingDisabledDomains ?? []
                          ).filter((x) => x !== d),
                        })
                      }
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.ai")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.provider")}>
            <div className="flex gap-2">
              {(
                [
                  ["none", t("settings.providerNone")],
                  ["openai", "OpenAI"],
                  ["anthropic", "Anthropic"],
                  ["ollama", "Ollama（本地）"],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.aiProvider === v ? "default" : "outline"}
                  onClick={async () => {
                    await update({ aiProvider: v as Settings["aiProvider"] });
                    if (v === "ollama") void detectAndConfigure();
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.model")}>
            <Input
              value={s.aiModel}
              list={s.aiProvider === "ollama" ? "ollama-models" : undefined}
              placeholder={
                s.aiProvider === "ollama"
                  ? "自动检测模型，例如 qwen3.5:4b"
                  : "gpt-4o-mini / claude-3-5-sonnet-latest / deepseek-chat"
              }
              onChange={(e) => update({ aiModel: e.target.value })}
            />
            {s.aiProvider === "ollama" && (
              <datalist id="ollama-models">
                {ollamaModels.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            )}
          </Row>
          <Row label="Base URL">
            <Input
              value={s.aiBaseUrl}
              placeholder={
                s.aiProvider === "anthropic"
                  ? "https://api.anthropic.com（留空用默认）"
                  : s.aiProvider === "ollama"
                    ? "http://127.0.0.1:11434（留空自动使用）"
                  : "https://api.openai.com/v1（留空用默认，可填 DeepSeek/Kimi/自建代理等 OpenAI 兼容地址）"
              }
              onChange={(e) => update({ aiBaseUrl: e.target.value })}
            />
          </Row>
          {s.aiProvider !== "ollama" && (
            <Row label={t("settings.apiKey")}>
              <Input
                type="password"
                value={s.aiApiKey}
                placeholder={t("settings.apiKeyPh")}
                onChange={(e) => update({ aiApiKey: e.target.value })}
              />
            </Row>
          )}
          <Row label="连通性">
            <div className="flex flex-wrap items-center gap-2">
              {s.aiProvider === "ollama" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={detectAndConfigure}
                  disabled={ollamaChecking}
                  className="gap-2"
                >
                  {ollamaChecking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  检测本地 Ollama
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onTestAi}
                disabled={
                  testing ||
                  s.aiProvider === "none" ||
                  (s.aiProvider !== "ollama" && !s.aiApiKey)
                }
                className="gap-2"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                测试连接
              </Button>
              {s.aiProvider === "ollama" && (
                <span className="text-xs text-muted-foreground">
                  {ollamaMessage || "将自动使用第一个可用的对话模型"}
                </span>
              )}
              {testResult && (
                <span
                  className={
                    "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs " +
                    (testResult.ok
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-destructive/10 text-destructive")
                  }
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {testResult.ok ? "成功" : "失败"} · {testResult.latencyMs}ms
                  <span className="max-w-[240px] truncate opacity-80">
                    · {testResult.message}
                  </span>
                </span>
              )}
            </div>
          </Row>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {t("settings.apiKeyNotice")} Ollama 使用本机 11434 端口，无需 API
            Key；打开设置页时会自动检测并配置可用模型。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            本地收藏工作台
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label="工作台名称">
            <Input
              value={s.collectionBoardName ?? ""}
              placeholder="收藏工作台 / AI 渠道 / 学习资料"
              onChange={(e) => update({ collectionBoardName: e.target.value })}
            />
          </Row>
          <Row label="来源文件夹">
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={aiChannelInput}
                  placeholder="输入文件夹 ID、标题或完整路径，回车添加"
                  onChange={(e) => setAiChannelInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const nextRef = aiChannelInput.trim();
                    if (!nextRef) return;
                    const next = Array.from(
                      new Set([...(s.aiChannelSources ?? []), nextRef]),
                    );
                    setAiChannelInput("");
                    await update({ aiChannelSources: next });
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const nextRef = aiChannelInput.trim();
                    if (!nextRef) return;
                    const next = Array.from(
                      new Set([...(s.aiChannelSources ?? []), nextRef]),
                    );
                    setAiChannelInput("");
                    await update({ aiChannelSources: next });
                  }}
                >
                  添加
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update({
                      aiChannelSources: ["AI", "AI工具购买地址"],
                    })
                  }
                >
                  恢复默认
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(s.aiChannelSources ?? []).length ? (
                  (s.aiChannelSources ?? []).map((ref) => (
                    <span
                      key={ref}
                      className="group inline-flex items-center gap-1 rounded-full border bg-muted/60 px-2.5 py-1 text-xs"
                    >
                      <span className="max-w-[220px] truncate font-medium">
                        {ref}
                      </span>
                      <button
                        type="button"
                        className="ml-1 rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
                        title="移除"
                        onClick={() =>
                          update({
                            aiChannelSources: (s.aiChannelSources ?? []).filter(
                              (x) => x !== ref,
                            ),
                          })
                        }
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    还没有配置源文件夹
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                这个工作台可以管理任意主题的书签集合，来源文件夹只读取，不会移动或改名原始书签。
              </div>
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-rose-500" />
            {t("settings.discover")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.homeWidgets")}>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("settings.homeWidgetsHint")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {HOME_WIDGETS.map((w) => {
                  const checked = s[w.key] ?? true;
                  const Icon = w.Icon;
                  return (
                    <label
                      key={w.key}
                      className={cn(
                        "group flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition",
                        checked
                          ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                          : "border-border bg-card/40 hover:bg-accent",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
                          w.iconAccent,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-tight">
                          {t(w.titleKey)}
                        </div>
                        <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                          {t(w.hintKey)}
                        </div>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={(v) =>
                          update({ [w.key]: v } as Partial<Settings>)
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </Row>
          <Row label={t("settings.githubToken")}>
            <div className="space-y-2">
              <Input
                type="password"
                value={s.githubToken ?? ""}
                placeholder="ghp_••••••••••••••••••••••••••••••••••••"
                onChange={(e) => update({ githubToken: e.target.value })}
              />
              <div className="flex items-center gap-2">
                <a
                  href="https://github.com/settings/tokens/new?description=Bookmark%20Studio&scopes=public_repo"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("settings.githubTokenCreate")}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await clearTrendingCache();
                    toast("已清空 GitHub Trending 缓存", "success");
                  }}
                >
                  清空缓存
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("settings.githubTokenHint")}
              </div>
            </div>
          </Row>
          <Row label={t("settings.discoverDefaults")}>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["created", t("discover.mode.created")],
                  ["hottest", t("discover.mode.hottest")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={
                    (s.discoverDefaultMode ?? "created") === v
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    update({ discoverDefaultMode: v as TrendingMode })
                  }
                >
                  {label}
                </Button>
              ))}
              <div className="mx-2 h-5 w-px bg-border" />
              {(
                [
                  ["daily", t("discover.range.daily")],
                  ["weekly", t("discover.range.weekly")],
                  ["monthly", t("discover.range.monthly")],
                  ["yearly", t("discover.range.yearly")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={
                    (s.discoverDefaultRange ?? "weekly") === v
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    update({ discoverDefaultRange: v as TrendingRange })
                  }
                >
                  {label}
                </Button>
              ))}
              <div className="mx-2 h-5 w-px bg-border" />
              <select
                value={s.discoverDefaultLanguage ?? ""}
                onChange={(e) =>
                  update({ discoverDefaultLanguage: e.target.value })
                }
                className="rounded-md border bg-background px-2 py-1 text-sm"
              >
                <option value="">{t("discover.language.all")}</option>
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </Row>
          <Row label={t("settings.discoverSort")}>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["auto", t("discover.sort.auto")],
                    [
                      "velocity-since-creation",
                      t("discover.sort.velocity-since-creation"),
                    ],
                    ["recent-growth", t("discover.sort.recent-growth")],
                    ["total-stars", t("discover.sort.total-stars")],
                  ] as const
                ).map(([v, label]) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={
                      (s.discoverDefaultSort ?? "auto") === v
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      update({ discoverDefaultSort: v as TrendingSort })
                    }
                    title={t(`discover.sort.${v}.hint`)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.discoverSortHint")}
              </p>
            </div>
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-4">
      <div className="pt-2 text-sm font-medium text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
