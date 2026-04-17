import { getDb } from "./client.js";

export interface CachedAudio {
  url: string;
  filePath: string;
  mime: string | null;
  lastAccess: string;
  createdAt: string;
  lastPlayed: string | null;
  playCount: number;
}

export async function initCacheSchema() {
  const db = await getDb();
  // Check if table exists and has file_path column
  const tableInfo = await db.all<{ name: string }[]>(`PRAGMA table_info(audio_cache)`);
  const hasFilePath = tableInfo.some(c => c.name === "file_path");
  
  if (tableInfo.length > 0 && !hasFilePath) {
    // Migration: Drop old table and recreate
    await db.exec(`DROP TABLE audio_cache`);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS audio_cache (
      url TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      mime TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_access TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_played TEXT,
      play_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_audio_cache_last_access ON audio_cache(last_access);
    CREATE INDEX IF NOT EXISTS idx_audio_cache_play_count ON audio_cache(play_count);
  `);

  const migratedTableInfo = await db.all<{ name: string }[]>(`PRAGMA table_info(audio_cache)`);
  const hasPlayCount = migratedTableInfo.some((c) => c.name === "play_count");
  const hasLastPlayed = migratedTableInfo.some((c) => c.name === "last_played");
  if (!hasPlayCount) {
    await db.exec(`ALTER TABLE audio_cache ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasLastPlayed) {
    await db.exec(`ALTER TABLE audio_cache ADD COLUMN last_played TEXT`);
  }
}

export async function getCachedAudio(url: string): Promise<CachedAudio | null> {
  const db = await getDb();
  const row = await db.get<CachedAudio>(
    `SELECT
       url,
       file_path as filePath,
       mime,
       created_at as createdAt,
       last_access as lastAccess,
       last_played as lastPlayed,
       play_count as playCount
     FROM audio_cache
     WHERE url = ?`,
    url,
  );
  if (!row) return null;
  await db.run(
    `UPDATE audio_cache
     SET
       last_access = CURRENT_TIMESTAMP,
       last_played = CURRENT_TIMESTAMP,
       play_count = COALESCE(play_count, 0) + 1
     WHERE url = ?`,
    url,
  );
  return row;
}

export async function putCachedAudio(url: string, filePath: string, mime: string | null) {
  const db = await getDb();
  await db.run(
    `INSERT INTO audio_cache (url, file_path, mime, created_at, last_access) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(url) DO UPDATE SET file_path = excluded.file_path, mime = excluded.mime, last_access = CURRENT_TIMESTAMP`,
    url,
    filePath,
    mime,
  );
}

export async function getCacheStats() {
  const db = await getDb();
  const result = await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM audio_cache`);
  return result?.count ?? 0;
}
