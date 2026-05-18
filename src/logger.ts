import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { format } from "util";

type Level = "debug" | "info" | "warn" | "error";

const levelOrder: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLevel: Level = (process.env.LOG_LEVEL as Level) ?? "info";
let bugLogStream: fs.WriteStream | null = null;
let bugModeWriteFailed = false;

export function enableBugMode() {
  if (bugLogStream) return;
  const logPath = path.join(process.cwd(), "bug.log");
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  stream.on("error", (err) => {
    handleBugStreamFailure("Bug log stream error", err);
  });
  bugLogStream = stream;
  bugModeWriteFailed = false;
  currentLevel = "debug";
  const ts = new Date().toISOString();
  const msg = `[${ts}] [INFO] Bug reporting enabled. Logging to ${logPath}\n`;
  safeWriteBugLog(msg);
  console.log(msg.trim());
}

export const log = {
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => {
    const errorId = randomUUID();
    emit("error", [`[ErrorID: ${errorId}]`, ...args]);
    return errorId;
  },
};

function emit(level: Level, args: unknown[]) {
  if (levelOrder[level] < levelOrder[currentLevel]) return;
  const ts = new Date().toISOString();
  
  // Console output
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);

  // File output
  if (bugLogStream) {
    const formatted = format(...args);
    safeWriteBugLog(`[${ts}] [${level.toUpperCase()}] ${formatted}\n`);
  }
}

function safeWriteBugLog(message: string) {
  if (!bugLogStream) return;
  try {
    bugLogStream.write(message);
  } catch (err) {
    handleBugStreamFailure("Bug log write failed", err);
  }
}

function handleBugStreamFailure(context: string, err: unknown) {
  if (bugModeWriteFailed) return;
  bugModeWriteFailed = true;
  const stream = bugLogStream;
  bugLogStream = null;
  if (stream) {
    stream.removeAllListeners("error");
    stream.destroy();
  }
  const message = err instanceof Error ? err.message : String(err);
  const ts = new Date().toISOString();
  console.error(`[${ts}] [WARN] ${context}. Disabling bug.log writes. ${message}`);
}
