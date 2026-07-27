import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = (filePath: string) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

export async function runSharpProbe(directory: string) {
  if (process.resourcesPath) process.env.PATH = `${process.resourcesPath}${path.delimiter}${process.env.PATH ?? ''}`;
  const { default: sharp } = await import('sharp');
  fs.mkdirSync(directory, { recursive: true });
  const original = path.join(directory, 'original.png');
  await sharp({
    create: { width: 320, height: 240, channels: 4, background: '#2b579a' }
  }).png().toFile(original);
  const crop = path.join(directory, 'crop.png');
  const resize = path.join(directory, 'resize.png');
  const compressed = path.join(directory, 'compressed.jpg');
  const platform = path.join(directory, 'platform.png');
  const overlay = path.join(directory, 'overlay.png');
  await sharp(original).extract({ left: 20, top: 20, width: 200, height: 150 }).toFile(crop);
  await sharp(original).resize(160, 120).toFile(resize);
  await sharp(original).jpeg({ quality: 55 }).toFile(compressed);
  await sharp(original).resize(1080, 1440, { fit: 'contain', background: '#ffffff' }).toFile(platform);
  const text = Buffer.from(`<svg width="1080" height="1440"><text x="80" y="450" font-family="Microsoft YaHei" font-size="72" fill="#ffd700">英国生活</text></svg>`);
  await sharp(platform).composite([{ input: text }]).toFile(overlay);
  const files = [original, crop, resize, compressed, platform, overlay];
  const metadata = await Promise.all(files.map(async (filePath) => ({
    filePath, byteSize: fs.statSync(filePath).size, sha256: digest(filePath), metadata: await sharp(filePath).metadata()
  })));
  if (metadata[4].sha256 === metadata[5].sha256) throw new Error('CHINESE_TEXT_NOT_RENDERED');
  return metadata;
}
