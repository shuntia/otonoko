import { getDb } from "./client.js";
import { Track, LoopMode } from "../music/manager.js";

export interface QueueState {
  guildId: string;
  current: Track | null;
  queue: Track[];
  history: Track[];
  loop: LoopMode;
  volume: number;
  paused: boolean;
  lastTextChannelId: string | null;
  voiceChannelId: string | null;
}

export async function initQueueSchema() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS queue_state (
      guild_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function saveQueueState(state: QueueState) {
  const db = await getDb();
  await db.run(
    `INSERT INTO queue_state (guild_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
    state.guildId,
    JSON.stringify(state),
  );
}

export async function loadQueueState(guildId: string): Promise<QueueState | null> {
  const db = await getDb();
  const row = await db.get<{ data: string }>(
    `SELECT data FROM queue_state WHERE guild_id = ?`,
    guildId,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.data) as QueueState;
  } catch {
    return null;
  }
}

export async function listAllQueueStates(): Promise<QueueState[]> {
  const db = await getDb();
  const rows = await db.all<{ data: string }[]>(`SELECT data FROM queue_state`);
  return rows.map((r) => {
    try {
      return JSON.parse(r.data) as QueueState;
    } catch {
      return null;
    }
  }).filter((s): s is QueueState => s !== null);
}

export async function clearQueueState(guildId: string) {
  const db = await getDb();
  await db.run(`DELETE FROM queue_state WHERE guild_id = ?`, guildId);
}
