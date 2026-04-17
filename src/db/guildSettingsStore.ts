import { getDb } from "./client.js";

export interface GuildVolumeSetting {
  guildId: string;
  volume: number;
}

export async function initGuildSettingsSchema() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      volume REAL NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function saveGuildVolume(guildId: string, volume: number) {
  const db = await getDb();
  await db.run(
    `INSERT INTO guild_settings (guild_id, volume, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id) DO UPDATE SET volume = excluded.volume, updated_at = CURRENT_TIMESTAMP`,
    guildId,
    volume,
  );
}

export async function listAllGuildVolumes(): Promise<GuildVolumeSetting[]> {
  const db = await getDb();
  const rows = await db.all<Array<{ guild_id: string; volume: number }>>(
    `SELECT guild_id, volume FROM guild_settings`,
  );
  return rows.map((row) => ({ guildId: row.guild_id, volume: row.volume }));
}
