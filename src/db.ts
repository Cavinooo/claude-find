import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname } from "path";
import { platform } from "process";
import { EMBEDDING_DIMS } from "./embeddings";

// Must be called before any Database is opened, and only once
let sqliteConfigured = false;

function configureSQLite() {
  if (sqliteConfigured) return;
  sqliteConfigured = true;

  if (platform === "darwin") {
    // macOS system SQLite doesn't support extension loading
    // Use Homebrew's SQLite instead
    const homebrewPaths = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel
    ];
    const sqlitePath = homebrewPaths.find((p) => existsSync(p));
    if (sqlitePath) {
      Database.setCustomSQLite(sqlitePath);
    } else {
      throw new Error(
        "sqlite3 with extension support not found. Install with: brew install sqlite3"
      );
    }
  }
}

export interface SessionInput {
  id: string;
  projectPath: string;
  branch: string | null;
  title: string | null;
  messageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  fileSize: number;
}

export interface ClaudeFindDB {
  db: Database;
  insertSession(session: SessionInput): void;
  getSession(id: string): any;
  sessionExists(id: string): boolean;
  markArchived(id: string): void;
  getAllSessionIds(): string[];
  insertSessionFile(sessionId: string, filePath: string, operation: string): void;
  getSessionFiles(sessionId: string): any[];
  findSessionsByFile(filePath: string): any[];
  insertChunk(sessionId: string, msgStart: number, msgEnd: number, text: string, isCompactSummary: boolean): number;
  getChunksForSession(sessionId: string): any[];
  getChunkById(id: number): any;
  insertVector(chunkId: number, embedding: Float32Array): void;
  searchVectors(query: Float32Array, limit: number): any[];
  searchFTS(query: string, limit?: number): any[];
  close(): void;
}

export function createDatabase(dbPath: string): ClaudeFindDB {
  configureSQLite();

  // Ensure directory exists
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  let db = new Database(dbPath);

  // Check for dimension mismatch — if the DB was built with a different
  // embedding model, delete it and start fresh. DB is a rebuildable cache.
  sqliteVec.load(db);
  const vecTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
  ).get() as any;
  if (vecTable) {
    const row = db.prepare(
      "SELECT vec_length(embedding) as dims FROM chunks_vec LIMIT 1"
    ).get() as any;
    if (row && row.dims !== EMBEDDING_DIMS) {
      console.error(`[claude-find] Embedding dimensions changed (${row.dims} → ${EMBEDDING_DIMS}), rebuilding index...`);
      db.close();
      unlinkSync(dbPath);
      db = new Database(dbPath);
      sqliteVec.load(db);
    }
  }

  // Enable WAL mode for concurrent access
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      branch TEXT,
      title TEXT,
      message_count INTEGER,
      created_at TEXT,
      updated_at TEXT,
      file_size INTEGER,
      indexed_at TEXT,
      is_archived INTEGER DEFAULT 0,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      operation TEXT,
      UNIQUE(session_id, file_path, operation)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      msg_start INTEGER,
      msg_end INTEGER,
      text TEXT NOT NULL,
      is_compact_summary INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(is_archived);
  `);

  // Create vector table (sqlite-vec)
  sqliteVec.load(db);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${EMBEDDING_DIMS}]
    );
  `);

  // Create FTS5 table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='id'
    );
  `);

  // Prepared statements
  const insertSessionStmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, project_path, branch, title, message_count, created_at, updated_at, file_size, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const getSessionStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const sessionExistsStmt = db.prepare("SELECT 1 FROM sessions WHERE id = ?");
  const markArchivedStmt = db.prepare("UPDATE sessions SET is_archived = 1, archived_at = datetime('now') WHERE id = ?");
  const getAllSessionIdsStmt = db.prepare("SELECT id FROM sessions");

  const insertSessionFileStmt = db.prepare(
    "INSERT OR IGNORE INTO session_files (session_id, file_path, operation) VALUES (?, ?, ?)"
  );
  const getSessionFilesStmt = db.prepare("SELECT * FROM session_files WHERE session_id = ?");
  const findByFileStmt = db.prepare(
    "SELECT DISTINCT s.* FROM sessions s JOIN session_files sf ON s.id = sf.session_id WHERE sf.file_path = ?"
  );

  const insertChunkStmt = db.prepare(
    "INSERT INTO chunks (session_id, msg_start, msg_end, text, is_compact_summary) VALUES (?, ?, ?, ?, ?)"
  );
  const lastInsertRowIdStmt = db.prepare("SELECT last_insert_rowid() as id");
  const getChunkByIdStmt = db.prepare("SELECT * FROM chunks WHERE id = ?");
  const getChunksStmt = db.prepare("SELECT * FROM chunks WHERE session_id = ?");

  // Triggers to keep FTS5 and vector tables in sync with chunks
  // DROP + CREATE to ensure trigger body is always up to date
  db.exec(`
    DROP TRIGGER IF EXISTS chunks_ai;
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;

    DROP TRIGGER IF EXISTS chunks_ad;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      DELETE FROM chunks_vec WHERE chunk_id = old.id;
    END;
  `);

  const insertVectorStmt = db.prepare(
    "INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, vec_f32(?))"
  );
  const searchVectorsStmt = db.prepare(`
    SELECT chunk_id, distance
    FROM chunks_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `);

  const searchFTSStmt = db.prepare(`
    SELECT rowid as chunk_id, rank
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  return {
    db,

    insertSession(session: SessionInput) {
      insertSessionStmt.run(
        session.id, session.projectPath, session.branch, session.title,
        session.messageCount, session.createdAt, session.updatedAt, session.fileSize
      );
    },

    getSession(id: string) {
      return getSessionStmt.get(id);
    },

    sessionExists(id: string): boolean {
      return sessionExistsStmt.get(id) !== null;
    },

    markArchived(id: string) {
      markArchivedStmt.run(id);
    },

    getAllSessionIds(): string[] {
      return (getAllSessionIdsStmt.all() as any[]).map((r) => r.id);
    },

    insertSessionFile(sessionId: string, filePath: string, operation: string) {
      insertSessionFileStmt.run(sessionId, filePath, operation);
    },

    getSessionFiles(sessionId: string) {
      return getSessionFilesStmt.all(sessionId) as any[];
    },

    findSessionsByFile(filePath: string) {
      return findByFileStmt.all(filePath) as any[];
    },

    getChunkById(id: number) {
      return getChunkByIdStmt.get(id);
    },

    insertChunk(sessionId: string, msgStart: number, msgEnd: number, text: string, isCompactSummary: boolean): number {
      insertChunkStmt.run(sessionId, msgStart, msgEnd, text, isCompactSummary ? 1 : 0);
      return (lastInsertRowIdStmt.get() as any).id as number;
    },

    getChunksForSession(sessionId: string) {
      return getChunksStmt.all(sessionId) as any[];
    },

    insertVector(chunkId: number, embedding: Float32Array) {
      insertVectorStmt.run(chunkId, embedding);
    },

    searchVectors(query: Float32Array, limit: number) {
      return searchVectorsStmt.all(query, limit) as any[];
    },

    searchFTS(query: string, limit: number = 10) {
      return searchFTSStmt.all(query, limit) as any[];
    },

    close() {
      db.close();
    },
  };
}
