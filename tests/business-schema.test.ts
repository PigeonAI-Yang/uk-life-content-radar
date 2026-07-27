import { afterEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3/win32-x64';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase, rootBusinessDirectories } from '../src/storage/database';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe('内容生意工作台迁移', () => {
  test('已有迁移链升级到版本 14 并建立真实业务目录', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-biz-'));
    temporaryPaths.push(temporary);
    const rootPath = path.join(temporary, 'business-root');
    const configPath = path.join(temporary, 'profile', 'root.json');
    const database = new AppDatabase();
    const settings = database.initialize(rootPath, configPath);
    expect(settings.migrationVersion).toBe(14);
    for (const directory of rootBusinessDirectories) {
      expect(fs.statSync(path.join(rootPath, directory)).isDirectory()).toBe(true);
    }
    const connection = database.getConnection(settings.databasePath);
    const tables = connection.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining([
      'products',
      'product_versions',
      'strategy_proposals',
      'strategy_versions',
      'leads',
      'conversation_records',
      'deals',
      'post_metrics',
      'intelligence_candidates'
    ]));
    database.close();
  });

  test('失败的 SQL 事务不留下部分对象', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-rollback-'));
    temporaryPaths.push(temporary);
    const connection = new Database(path.join(temporary, 'rollback.sqlite'));
    expect(() => connection.transaction(() => {
      connection.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)');
      connection.exec('THIS IS NOT SQL');
    })()).toThrow();
    const row = connection.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='should_rollback'"
    ).get() as { count: number };
    expect(row.count).toBe(0);
    connection.close();
  });
});
