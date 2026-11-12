import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'public', 'icons');
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const out = resolve(iconsDir, `icon-${size}.png`);
  await sharp(resolve(iconsDir, 'icon.svg'))
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`[icons] generated ${out}`);
}
