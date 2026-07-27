import { createHash } from 'node:crypto';

export const semanticModel = {
  id: 'local-char-ngram-v1',
  algorithm: 'normalized signed character 1-3 gram hashing',
  dimensions: 128,
  license: 'MIT project-owned implementation',
  byteSize: 0,
  packageIncrementBytes: 0
} as const;

export function embed(text: string) {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const scores = new Int32Array(128);
  for (let size = 1; size <= 3; size += 1) {
    for (let index = 0; index + size <= normalized.length; index += 1) {
      const hash = createHash('sha256').update(normalized.slice(index, index + size)).digest();
      scores[hash[0] & 127] += (hash[1] & 1) ? 1 : -1;
    }
  }
  const norm = Math.sqrt(scores.reduce((sum, score) => sum + score * score, 0)) || 1;
  const vector = new Int8Array(128);
  scores.forEach((score, index) => { vector[index] = Math.round(score / norm * 127); });
  return Buffer.from(vector.buffer);
}

export function similarity(left: Buffer, right: Buffer) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < 128; index += 1) {
    const leftValue = left.readInt8(index);
    const rightValue = right.readInt8(index);
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm) || 1);
}
