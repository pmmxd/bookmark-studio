import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { getChannelRecordUpdateTime } = await server.ssrLoadModule(
    "/src/newtab/pages/ai-channels/viewModel.ts",
  );

  const record = {
    firstSeenAt: 100,
    lastCheckedAt: 200,
    annotationUpdatedAt: 300,
    lastSeenAt: 400,
  };

  assert.equal(
    getChannelRecordUpdateTime(record),
    300,
    "source scans must not replace the record's actual update time",
  );

  const { buildExportData } = await server.ssrLoadModule(
    "/src/lib/aiChannelSync.ts",
  );
  const store = {
    groups: [],
    recordsById: {
      channel: {
        ...record,
        bookmarkId: "channel",
        groupId: "api-relay",
        lastCheckedAt: undefined,
        annotationUpdatedAt: undefined,
      },
    },
  };

  assert.equal(
    buildExportData(store).annotations.channel.ts,
    record.firstSeenAt,
    "syncing an unedited record must not create a new update timestamp",
  );
} finally {
  await server.close();
}

console.log("ai channel update time tests passed");
