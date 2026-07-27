import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const vendor = path.resolve('node_modules', 'electron-winstaller', 'vendor');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
for (const extension of ['exe', 'dll']) {
  fs.copyFileSync(path.join(vendor, `7z-${arch}.${extension}`), path.join(vendor, `7z.${extension}`));
}
