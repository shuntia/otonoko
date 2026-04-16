import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { log } from "../logger.js";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await open({
    filename: "otonoko.db",
    driver: sqlite3.Database,
  });
  await db.exec("PRAGMA journal_mode = WAL");
  await db.exec("PRAGMA foreign_keys = ON");
  log.info("Opened SQLite database (Async)");
  return db;
}
