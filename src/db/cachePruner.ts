import fs from "fs";
import { getDb } from "./client.js";
import { log } from "../logger.js";

const MAX_CACHE_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

interface CacheRow {
  url: string;
  filePath: string;
  createdAt: string;
  lastAccess: string;
  lastPlayed: string | null;
  playCount: number;
}

interface CacheCandidate extends CacheRow {
  sizeBytes: number;
  lastPlayedMs: number;
  lastAccessMs: number;
  priority: number;
}

function toMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculatePriority(candidate: Omit<CacheCandidate, "priority">, nowMs: number): number {
  const playCount = Math.max(0, candidate.playCount);
  const frequencyWeight = Math.pow(playCount + 1, 3);

  const sizeIn64MbChunks = Math.max(1, candidate.sizeBytes / (64 * 1024 * 1024));
  const sizeWeight = 1 / sizeIn64MbChunks;

  const ageMs = Math.max(0, nowMs - candidate.lastPlayedMs);
  const ageInDays = ageMs / (24 * 60 * 60 * 1000);
  const recencyWeight = 1 / (1 + ageInDays);

  return frequencyWeight * sizeWeight * recencyWeight;
}

export async function pruneCache() {
  log.info("Starting cache prune...");
  const db = await getDb();
  const nowMs = Date.now();

  const rows = await db.all<CacheRow[]>(
    `SELECT
       url,
       file_path as filePath,
       created_at as createdAt,
       last_access as lastAccess,
       last_played as lastPlayed,
       COALESCE(play_count, 0) as playCount
     FROM audio_cache`
  );

  const candidates: CacheCandidate[] = [];
  let totalSize = 0;

  for (const row of rows) {
    try {
      if (!fs.existsSync(row.filePath)) {
        await db.run(`DELETE FROM audio_cache WHERE url = ?`, row.url);
        continue;
      }

      const stats = fs.statSync(row.filePath);
      if (!stats.isFile()) {
        await db.run(`DELETE FROM audio_cache WHERE url = ?`, row.url);
        continue;
      }

      const sizeBytes = stats.size;
      totalSize += sizeBytes;
      candidates.push({
        ...row,
        sizeBytes,
        lastPlayedMs: toMs(row.lastPlayed ?? row.lastAccess),
        lastAccessMs: toMs(row.lastAccess),
        priority: 0,
      });
    } catch (err) {
      log.warn("Failed to evaluate cache entry", { url: row.url, path: row.filePath, err });
    }
  }

  for (const candidate of candidates) {
    candidate.priority = calculatePriority(candidate, nowMs);
  }

  if (totalSize <= MAX_CACHE_SIZE_BYTES) {
    log.info("Cache prune complete.");
    return;
  }

  log.info(`Cache size ${totalSize} exceeds limit ${MAX_CACHE_SIZE_BYTES}. Pruning by priority score...`);
  candidates.sort((a, b) => {
    // Lower priority is evicted first.
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Deterministic tie-breakers.
    if (a.playCount !== b.playCount) return a.playCount - b.playCount;
    if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
    if (a.lastPlayedMs !== b.lastPlayedMs) return a.lastPlayedMs - b.lastPlayedMs;
    return a.lastAccessMs - b.lastAccessMs;
  });

  for (const row of candidates) {
    if (totalSize <= MAX_CACHE_SIZE_BYTES) break;
    try {
      if (fs.existsSync(row.filePath)) {
        fs.unlinkSync(row.filePath);
      }
      await db.run(`DELETE FROM audio_cache WHERE url = ?`, row.url);
      totalSize -= row.sizeBytes;
      log.debug("Pruned cache entry", {
        url: row.url,
        priority: row.priority,
        playCount: row.playCount,
        sizeBytes: row.sizeBytes,
        lastPlayed: row.lastPlayed,
      });
    } catch (err) {
      log.warn("Failed to prune cache file", { path: row.filePath, err });
    }
  }
  
  log.info("Cache prune complete.");
}

export function startCachePruner(intervalMs = 60 * 60 * 1000) {
  setInterval(() => {
    void pruneCache();
  }, intervalMs);
  // Run once on startup
  void pruneCache();
}
