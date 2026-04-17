import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

vi.mock("fs");
vi.mock("../db/client.js", () => ({
  getDb: vi.fn(),
}));
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getDb } from "../db/client.js";
import { pruneCache } from "../db/cachePruner.js";

const GB = 1024 * 1024 * 1024;

type CacheRow = {
  url: string;
  filePath: string;
  createdAt: string;
  lastAccess: string;
  lastPlayed: string | null;
  playCount: number;
};

function mockFs(rows: CacheRow[], sizeByUrl: Record<string, number>) {
  const sizeByPath = Object.fromEntries(rows.map((row) => [row.filePath, sizeByUrl[row.url] ?? 0]));

  vi.mocked(fs.existsSync).mockImplementation((target: any) => {
    const path = String(target);
    return Object.prototype.hasOwnProperty.call(sizeByPath, path);
  });
  vi.mocked(fs.statSync).mockImplementation((target: any) => {
    const path = String(target);
    return {
      size: sizeByPath[path] ?? 0,
      isFile: () => true,
    } as any;
  });
  vi.mocked(fs.unlinkSync).mockImplementation(() => undefined as unknown as void);
}

describe("cachePruner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prunes lowest multiplicative priority first", async () => {
    const rows: CacheRow[] = [
      {
        url: "a",
        filePath: "/cache/a",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-04-01T00:00:00.000Z",
        lastPlayed: "2026-04-10T00:00:00.000Z",
        playCount: 0,
      },
      {
        url: "b",
        filePath: "/cache/b",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-03-01T00:00:00.000Z",
        lastPlayed: "2026-03-01T00:00:00.000Z",
        playCount: 0,
      },
      {
        url: "c",
        filePath: "/cache/c",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-02-01T00:00:00.000Z",
        lastPlayed: "2026-02-01T00:00:00.000Z",
        playCount: 2,
      },
      {
        url: "d",
        filePath: "/cache/d",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-02-01T00:00:00.000Z",
        lastPlayed: "2026-02-01T00:00:00.000Z",
        playCount: 3,
      },
    ];

    mockFs(rows, {
      a: 4 * GB,
      b: 3 * GB,
      c: 8 * GB,
      d: 1 * GB,
    });

    const db = {
      all: vi.fn().mockResolvedValue(rows),
      run: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await pruneCache();

    const deletedUrls = db.run.mock.calls
      .filter(([query]) => String(query).includes("DELETE FROM audio_cache"))
      .map(([, url]) => url);

    expect(deletedUrls).toEqual(["b", "a"]);
  });

  it("uses recency in the multiplicative priority score", async () => {
    const rows: CacheRow[] = [
      {
        url: "older",
        filePath: "/cache/older",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-02-01T00:00:00.000Z",
        lastPlayed: "2026-02-01T00:00:00.000Z",
        playCount: 0,
      },
      {
        url: "newer",
        filePath: "/cache/newer",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-04-01T00:00:00.000Z",
        lastPlayed: "2026-04-01T00:00:00.000Z",
        playCount: 0,
      },
      {
        url: "popular",
        filePath: "/cache/popular",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccess: "2026-01-01T00:00:00.000Z",
        lastPlayed: "2026-01-01T00:00:00.000Z",
        playCount: 5,
      },
    ];

    mockFs(rows, {
      older: 6 * GB,
      newer: 6 * GB,
      popular: 1 * GB,
    });

    const db = {
      all: vi.fn().mockResolvedValue(rows),
      run: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await pruneCache();

    const deletedUrls = db.run.mock.calls
      .filter(([query]) => String(query).includes("DELETE FROM audio_cache"))
      .map(([, url]) => url);

    expect(deletedUrls).toEqual(["older"]);
  });
});
