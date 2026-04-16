import fs from "fs";
import path from "path";
import { getDb } from "./client.js";
import { log } from "../logger.js";

const CACHE_DIR = "cache";
const MAX_CACHE_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function pruneCache() {
  log.info("Starting cache prune...");
  const db = await getDb();
  
  // 1. Remove old entries based on last_access
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const oldRows = await db.all<{ url: string; filePath: string }[]>(
    `SELECT url, file_path as filePath FROM audio_cache WHERE last_access < ?`,
    cutoff
  );

  for (const row of oldRows) {
    try {
      if (fs.existsSync(row.filePath)) {
        fs.unlinkSync(row.filePath);
      }
      await db.run(`DELETE FROM audio_cache WHERE url = ?`, row.url);
      log.debug("Pruned old cache entry", { url: row.url });
    } catch (err) {
      log.warn("Failed to prune file", { path: row.filePath, err });
    }
  }

  // 2. Check total size and prune LRU if needed
  let totalSize = 0;
  const allFiles = fs.readdirSync(CACHE_DIR).map(f => path.join(CACHE_DIR, f));
  for (const file of allFiles) {
    try {
      const stats = fs.statSync(file);
      totalSize += stats.size;
    } catch {
      // ignore missing
    }
  }

  if (totalSize > MAX_CACHE_SIZE_BYTES) {
    log.info(`Cache size ${totalSize} exceeds limit ${MAX_CACHE_SIZE_BYTES}. Pruning LRU...`);
    const lruRows = await db.all<{ url: string; filePath: string }[]>(
      `SELECT url, file_path as filePath FROM audio_cache ORDER BY last_access ASC`
    );
    
    for (const row of lruRows) {
      if (totalSize <= MAX_CACHE_SIZE_BYTES) break;
      try {
        if (fs.existsSync(row.filePath)) {
          const stats = fs.statSync(row.filePath);
          fs.unlinkSync(row.filePath);
          totalSize -= stats.size;
        }
        await db.run(`DELETE FROM audio_cache WHERE url = ?`, row.url);
        log.debug("Pruned LRU cache entry", { url: row.url });
      } catch (err) {
        log.warn("Failed to prune LRU file", { path: row.filePath, err });
      }
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