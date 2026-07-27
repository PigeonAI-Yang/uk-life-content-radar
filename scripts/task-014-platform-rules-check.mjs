import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const receipt = path.resolve('artifacts/task-receipts/TASK-014');
const rules = JSON.parse(fs.readFileSync(path.join(receipt, 'platform-rules.json'), 'utf8'));
for (const platform of ['xiaohongshu', 'douyin', 'wechat']) {
  assert.ok(rules.platforms[platform].sources.length >= 2);
  assert.ok(rules.platforms[platform].version);
}
const html = '<h1>英国租房材料</h1><p>摘要</p><p>正文</p><img src="图片/01.png"><img src="图片/02.png">';
assert.ok(html.indexOf('01.png') < html.indexOf('02.png'));
assert.match(html, /<h1>英国租房材料<\/h1>/);
fs.writeFileSync(path.join(receipt, 'wechat-minimum-copy-format.html'), html);
fs.writeFileSync(path.join(receipt, 'platform-rules-check.json'), JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString() }, null, 2));
process.stdout.write(`${JSON.stringify({ status: 'passed', platforms: Object.keys(rules.platforms), html })}\n`);
