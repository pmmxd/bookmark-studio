import { createWriteStream } from "node:fs";
import path from "node:path";
import url from "node:url";
import archiver from "archiver";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const out = path.join(root, "dist.zip");

const output = createWriteStream(out);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => console.log(`[zip] ${archive.pointer()} bytes -> ${out}`));
archive.on("error", (err) => { throw err; });

archive.pipe(output);
archive.directory(dist, false);
archive.finalize();
