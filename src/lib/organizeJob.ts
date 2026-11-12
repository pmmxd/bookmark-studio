const KEY = "smart-bookmark::organize-job";
const hasStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export interface OrganizeJob {
  id: string;
  bookmarkIds: string[];
  folderId?: string;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  running: boolean;
  processed?: number;
  failed?: number;
  lastError?: string;
}

export async function startOrganizeJob(
  bookmarkIds: string[],
  folderId?: string,
): Promise<OrganizeJob> {
  const now = Date.now();
  const job: OrganizeJob = {
    id: crypto.randomUUID(),
    bookmarkIds,
    folderId,
    createdAt: now,
    updatedAt: now,
    active: true,
    running: true,
    processed: 0,
    failed: 0,
  };
  await writeJob(job);
  return job;
}

export async function getActiveOrganizeJob(): Promise<OrganizeJob | null> {
  const job = await readJob();
  return job?.active ? job : null;
}

export async function markOrganizeJobStopped(
  id: string,
  error: string,
): Promise<void> {
  const job = await readJob();
  if (!job || job.id !== id) return;
  await writeJob({
    ...job,
    running: false,
    lastError: error,
    updatedAt: Date.now(),
  });
}

export async function markOrganizeJobProgress(
  id: string,
  processed: number,
  failed: number,
): Promise<void> {
  const job = await readJob();
  if (!job || job.id !== id) return;
  await writeJob({
    ...job,
    running: true,
    processed,
    failed,
    updatedAt: Date.now(),
  });
}

export async function finishOrganizeJob(id: string): Promise<void> {
  const job = await readJob();
  if (!job || job.id !== id) return;
  await writeJob({
    ...job,
    active: false,
    running: false,
    updatedAt: Date.now(),
  });
}

async function readJob(): Promise<OrganizeJob | null> {
  if (hasStorage) {
    const saved = await chrome.storage.local.get(KEY);
    return (saved[KEY] as OrganizeJob | undefined) ?? null;
  }
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OrganizeJob) : null;
  } catch {
    return null;
  }
}

async function writeJob(job: OrganizeJob): Promise<void> {
  if (hasStorage) {
    await chrome.storage.local.set({ [KEY]: job });
  } else {
    localStorage.setItem(KEY, JSON.stringify(job));
  }
}
