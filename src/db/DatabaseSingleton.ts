import Database from 'better-sqlite3';
import { assertPathWithinAllowedRoots } from '../lib/pathSafety.js';
import { logger } from '../lib/logger.js';

export interface DatabaseSingletonConfig {
  dbPath: string;
  allowedToolRoots: string[];
  baseDir?: string;
}

export class DatabaseSingleton {
  private static instance: DatabaseSingleton | null = null;

  private readonly db: Database.Database;
  private closed = false;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  private bootstrapSchema(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, provider TEXT, metadata_json TEXT, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);',
    );
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);',
    );
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_conversations_actor_id ON conversations(actor_id);',
    );
  }

  static init(config: DatabaseSingletonConfig): DatabaseSingleton {
    if (DatabaseSingleton.instance) {
      return DatabaseSingleton.instance;
    }

    const safePath = assertPathWithinAllowedRoots(
      config.dbPath,
      config.allowedToolRoots,
      config.baseDir,
    );

    const db = new Database(safePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    DatabaseSingleton.instance = new DatabaseSingleton(db);
    DatabaseSingleton.instance.bootstrapSchema();
    logger.info({ dbPath: safePath }, 'Database connection initialized with schema bootstrap');
    return DatabaseSingleton.instance;
  }

  static get(): DatabaseSingleton {
    if (!DatabaseSingleton.instance) {
      throw new Error('DatabaseSingleton not initialized.');
    }
    return DatabaseSingleton.instance;
  }

  getHandle(): Database.Database {
    if (this.closed) {
      throw new Error('Database connection already closed.');
    }
    return this.db;
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
    logger.info({}, 'Database connection closed');
  }
}
