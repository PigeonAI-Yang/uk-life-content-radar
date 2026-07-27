import Database from 'better-sqlite3/win32-x64';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations';

export type RootSettings = {
  rootPath: string;
  databasePath: string;
  temporaryPath: string;
  migrationVersion: number;
  fts5: boolean;
};

export const rootBusinessDirectories = [
  'sources',
  'assets/original',
  'assets/derived',
  'packages',
  'business/products',
  'business/strategies',
  'customers',
  'conversations',
  'intelligence',
  '.content-terminal/tmp'
] as const;

export class AppDatabase {
  private connection?: Database.Database;

  initialize(rootPath: string, configPath: string): RootSettings {
    if (fs.existsSync(configPath)) throw new Error('ROOT_ALREADY_INITIALIZED');
    const absoluteRoot = path.resolve(rootPath);
    const metadataPath = path.join(absoluteRoot, '.content-terminal');
    const databasePath = path.join(metadataPath, 'index.sqlite');
    const probePath = path.join(absoluteRoot, `.write-probe-${process.pid}`);

    fs.mkdirSync(absoluteRoot, { recursive: true });
    fs.writeFileSync(probePath, 'ok', { flag: 'wx' });
    fs.rmSync(probePath);
    for (const directory of rootBusinessDirectories) {
      fs.mkdirSync(path.join(absoluteRoot, directory), { recursive: true });
    }

    const connection = this.open(databasePath);
    this.migrate(connection);

    const settings = this.read(databasePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(settings), { flag: 'wx' });
    return settings;
  }

  read(databasePath: string): RootSettings {
    const connection = this.open(databasePath);
    this.migrate(connection);
    const migration = connection.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number };
    const fts5 = connection.prepare("SELECT count(*) AS count FROM fts_probe WHERE fts_probe MATCH 'probe'").get() as { count: number };
    const metadataPath = path.dirname(databasePath);
    return {
      rootPath: path.dirname(metadataPath),
      databasePath,
      temporaryPath: path.join(metadataPath, 'tmp'),
      migrationVersion: migration.version,
      fts5: fts5.count === 1
    };
  }

  close() {
    this.connection?.close();
    this.connection = undefined;
  }

  getConnection(databasePath: string) {
    const connection = this.open(databasePath);
    this.migrate(connection);
    return connection;
  }

  private migrate(connection: Database.Database) {
    connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const migration of migrations) {
      const applied = connection.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
      if (!applied) {
        connection.transaction(() => {
          connection.exec(migration.sql);
          connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))").run(migration.version);
        })();
      }
    }
  }

  private open(databasePath: string) {
    if (!this.connection) this.connection = new Database(databasePath);
    if (this.connection.name !== databasePath) throw new Error('DATABASE_CONNECTION_ALREADY_BOUND');
    return this.connection;
  }
}
