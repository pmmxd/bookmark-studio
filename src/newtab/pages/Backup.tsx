import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, HardDriveDownload, FileJson } from "lucide-react";
import {
  buildBackup,
  collectExistingUrls,
  countBackupUrls,
  downloadHtmlBackup,
  downloadJsonBackup,
  importIntoFolder,
  importBookmarkMetadata,
  applyBackupSettings,
  parseNetscapeHtml,
  verifyBackupIntegrity,
  type BackupFile,
  type BackupNode,
} from "@/lib/backup";
import { allFolders, getTree } from "@/lib/bookmarks";
import type { FolderStat } from "@/types";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/toast";

export default function BackupPage() {
  const t = useT();
  const [folders, setFolders] = useState<FolderStat[]>([]);
  const [parentId, setParentId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTree().then((tr) => {
      const fs = allFolders(tr);
      setFolders(fs);
      setParentId(fs[0]?.id ?? "");
    });
  }, []);

  const doExport = async (kind: "json" | "html") => {
    setBusy(true);
    try {
      const backup = await buildBackup();
      if (kind === "json") downloadJsonBackup(backup);
      else downloadHtmlBackup(backup);
      toast(t("backup.exported", String(countBackupUrls(backup.tree))), "success");
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    if (!parentId) {
      toast("Pick a folder first", "error");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      let nodes: BackupNode[] = [];
      let backupFile: BackupFile | null = null;
      if (file.name.endsWith(".json")) {
        const j = JSON.parse(text) as BackupFile | BackupNode[];
        if (Array.isArray(j)) {
          nodes = j;
        } else {
          if (j.app !== "smart-bookmark" || !Array.isArray(j.tree)) {
          throw new Error("不是有效的 Bookmark Studio 备份文件");
          }
          if (!(await verifyBackupIntegrity(j))) {
            throw new Error("备份文件完整性校验失败，已停止导入");
          }
          backupFile = j;
          nodes = j.tree;
        }
      } else {
        nodes = parseNetscapeHtml(text);
      }
      const existing = await collectExistingUrls();
      const { added, skipped, idMap } = await importIntoFolder(
        parentId,
        nodes,
        existing,
      );
      const metadataCount = backupFile
        ? await importBookmarkMetadata(backupFile, idMap)
        : 0;
      const settingsApplied = backupFile
        ? await applyBackupSettings(backupFile, idMap)
        : false;
      const extras = [
        metadataCount ? `AI 分析 ${metadataCount} 条` : "",
        settingsApplied ? "设置已迁移" : "",
      ].filter(Boolean);
      toast(
        `${t("backup.imported", String(added), String(skipped))}${
          extras.length ? `，${extras.join("，")}` : ""
        }`,
        "success",
      );
    } catch (err: any) {
      toast(err?.message ?? "Import failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-4 w-4 text-primary" />
            {t("backup.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => doExport("json")}
              disabled={busy}
            >
              <FileJson className="h-4 w-4" />
              {t("backup.exportJson")}
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => doExport("html")}
              disabled={busy}
            >
              <Download className="h-4 w-4" />
              {t("backup.exportHtml")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.import")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              {t("backup.importTo")}
            </span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path} ({f.count})
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm hover:bg-accent">
              <Upload className="h-4 w-4" />
              {t("backup.importJson")}
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(f);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm hover:bg-accent">
              <Upload className="h-4 w-4" />
              {t("backup.importHtml")}
              <input
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {t("backup.importNotice")}
            <div className="mt-1">
              JSON v2 包含书签、AI 标签、简介和非敏感设置；API Key 与
              GitHub Token 不会导出。HTML 仅包含书签。
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
