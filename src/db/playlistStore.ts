import { getDb } from "./client.js";

export interface Playlist {
  id: number;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface PlaylistItem {
  id: number;
  playlistId: number;
  title: string;
  url: string;
  durationSec: number;
  addedBy: string;
  position: number;
}

export async function initSchema() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      added_by TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_id ON playlist_items(playlist_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_owner_name ON playlists(owner_id, name);
  `);
}

export async function createPlaylist(name: string, ownerId: string): Promise<Playlist> {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO playlists (name, owner_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    name,
    ownerId,
  );
  return { id: result.lastID!, name, ownerId, createdAt: new Date().toISOString() };
}

export async function getPlaylistByName(name: string, ownerId: string): Promise<Playlist | null> {
  const db = await getDb();
  const row = await db.get<Playlist>(
    `SELECT id, name, owner_id as ownerId, created_at as createdAt FROM playlists WHERE name = ? AND owner_id = ?`,
    name,
    ownerId,
  );
  return row ?? null;
}

export async function listPlaylists(ownerId: string, offset = 0, limit = 10): Promise<Playlist[]> {
  const db = await getDb();
  const rows = await db.all<Playlist[]>(
    `SELECT id, name, owner_id as ownerId, created_at as createdAt FROM playlists WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ownerId,
    limit,
    offset,
  );
  return rows;
}

export async function searchPlaylists(query: string, ownerId: string, limit = 25): Promise<Playlist[]> {
  const db = await getDb();
  const rows = await db.all<Playlist[]>(
    `SELECT id, name, owner_id as ownerId, created_at as createdAt 
     FROM playlists 
     WHERE owner_id = ? AND name LIKE ? 
     ORDER BY name ASC 
     LIMIT ?`,
    ownerId,
    `%${query}%`,
    limit,
  );
  return rows;
}

export async function removePlaylist(name: string, ownerId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(`DELETE FROM playlists WHERE name = ? AND owner_id = ?`, name, ownerId);
  return (result.changes ?? 0) > 0;
}

export async function renamePlaylist(name: string, newName: string, ownerId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(`UPDATE playlists SET name = ? WHERE name = ? AND owner_id = ?`, newName, name, ownerId);
  return (result.changes ?? 0) > 0;
}

export async function clearPlaylist(playlistId: number) {
  const db = await getDb();
  await db.run(`DELETE FROM playlist_items WHERE playlist_id = ?`, playlistId);
}

export async function addItem(
  playlistId: number,
  item: Omit<PlaylistItem, "id" | "playlistId" | "position"> & { position?: number; dedupeUrl?: boolean },
): Promise<PlaylistItem> {
  const db = await getDb();
  if (item.dedupeUrl) {
    const exists = await db.get<{ id: number }>(
      `SELECT id FROM playlist_items WHERE playlist_id = ? AND url = ? LIMIT 1`,
      playlistId,
      item.url,
    );
    if (exists && exists.id) {
      return {
        id: exists.id,
        playlistId,
        title: item.title,
        url: item.url,
        durationSec: item.durationSec,
        addedBy: item.addedBy,
        position: item.position ?? 0,
      };
    }
  }
  
  let nextPosition = item.position;
  if (nextPosition === undefined) {
    const maxPosRow = await db.get<{ maxPos: number | null }>(
      `SELECT MAX(position) as maxPos FROM playlist_items WHERE playlist_id = ?`,
      playlistId,
    );
    nextPosition = (maxPosRow?.maxPos ?? 0) + 1;
  }

  const result = await db.run(
    `INSERT INTO playlist_items (playlist_id, title, url, duration_sec, added_by, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
    playlistId,
    item.title,
    item.url,
    item.durationSec,
    item.addedBy,
    nextPosition,
  );

  return {
    id: result.lastID!,
    playlistId,
    title: item.title,
    url: item.url,
    durationSec: item.durationSec,
    addedBy: item.addedBy,
    position: nextPosition,
  };
}

export async function listItems(playlistId: number): Promise<PlaylistItem[]> {
  const db = await getDb();
  const rows = await db.all<PlaylistItem[]>(
    `SELECT id, playlist_id as playlistId, title, url, duration_sec as durationSec, added_by as addedBy, position
     FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC`,
    playlistId,
  );
  return rows;
}

export async function removeItem(playlistId: number, position: number): Promise<boolean> {
  const db = await getDb();
  const items = await listItems(playlistId);
  const idx = position - 1;
  if (idx < 0 || idx >= items.length) return false;
  
  const itemToRemove = await db.get<{ id: number }>(
    `SELECT id FROM playlist_items WHERE playlist_id = ? AND position = ?`,
    playlistId,
    position
  );
  
  if (!itemToRemove) return false;

  await db.run("BEGIN TRANSACTION");
  try {
    await db.run(`DELETE FROM playlist_items WHERE id = ?`, itemToRemove.id);
    await db.run(
      `UPDATE playlist_items SET position = position - 1 WHERE playlist_id = ? AND position > ?`,
      playlistId,
      position
    );
    await db.run("COMMIT");
    return true;
  } catch (e) {
    await db.run("ROLLBACK");
    throw e;
  }
}

export async function moveItem(playlistId: number, from: number, to: number): Promise<boolean> {
  const db = await getDb();
  const items = await listItems(playlistId);
  if (from < 1 || from > items.length || to < 1 || to > items.length) return false;
  
  const [item] = items.splice(from - 1, 1);
  items.splice(to - 1, 0, item);
  
  await db.run("BEGIN TRANSACTION");
  try {
    for (let i = 0; i < items.length; i++) {
      await db.run(`UPDATE playlist_items SET position = ? WHERE id = ?`, i + 1, items[i].id);
    }
    await db.run("COMMIT");
    return true;
  } catch (e) {
    await db.run("ROLLBACK");
    throw e;
  }
}

export async function moveItemToPlaylist(sourceId: number, targetId: number, position: number): Promise<boolean> {
  const items = await listItems(sourceId);
  const idx = position - 1;
  if (idx < 0 || idx >= items.length) return false;
  const item = items[idx];
  
  await addItem(targetId, {
    title: item.title,
    url: item.url,
    durationSec: item.durationSec,
    addedBy: item.addedBy,
    dedupeUrl: true,
  });
  
  await removeItem(sourceId, position);
  return true;
}

export async function fusePlaylists(sourceId: number, targetId: number, dedupe = true): Promise<number> {
  const items = await listItems(sourceId);
  let added = 0;
  for (const item of items) {
    const inserted = await addItem(targetId, {
      title: item.title,
      url: item.url,
      durationSec: item.durationSec,
      addedBy: item.addedBy,
      dedupeUrl: dedupe,
    });
    if (inserted) added += 1;
  }
  return added;
}

export async function clonePlaylist(sourceId: number, newName: string, newOwnerId: string): Promise<Playlist> {
  const sourceItems = await listItems(sourceId);
  const newPlaylist = await createPlaylist(newName, newOwnerId);
  for (const item of sourceItems) {
    await addItem(newPlaylist.id, {
      title: item.title,
      url: item.url,
      durationSec: item.durationSec,
      addedBy: newOwnerId,
      dedupeUrl: false,
    });
  }
  return newPlaylist;
}
