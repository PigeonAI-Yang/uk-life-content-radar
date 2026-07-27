import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('artifacts', 'task-receipts', 'TASK-012', 'sharp-dev');
mkdirSync(directory, { recursive: true });
const source = resolve(directory, 'original.png');
await sharp({ create: { width: 320, height: 240, channels: 4, background: '#2b579a' } }).png().toFile(source);
const outputs = [
  ['crop.png', sharp(source).extract({ left: 20, top: 20, width: 200, height: 150 })],
  ['resize.png', sharp(source).resize(160, 120)],
  ['compressed.jpg', sharp(source).jpeg({ quality: 55 })],
  ['platform.png', sharp(source).resize(1080, 1440, { fit: 'contain', background: '#ffffff' })]
];
for (const [name, pipeline] of outputs) await pipeline.toFile(resolve(directory, name));
const text = Buffer.from(`<svg width="1080" height="1440"><text x="80" y="450" font-family="Microsoft YaHei" font-size="72" fill="#ffd700">英国生活</text></svg>`);
await sharp(resolve(directory, 'platform.png')).composite([{ input: text }]).toFile(resolve(directory, 'overlay.png'));
const files = ['original.png', ...outputs.map(([name]) => name), 'overlay.png'].map((name) => resolve(directory, name));
const result = await Promise.all(files.map(async (filePath) => ({
  filePath, byteSize: statSync(filePath).size,
  sha256: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
  metadata: await sharp(filePath).metadata()
})));
if (result[4].sha256 === result[5].sha256) throw new Error('中文字体未渲染');
writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
