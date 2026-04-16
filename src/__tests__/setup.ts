import { vi } from 'vitest';

// Mock environment variables
process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';

// Mock yt-dlp binary to not be available by default in tests
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 1, error: new Error('yt-dlp not found') })),
    spawn: vi.fn(() => {
      const { EventEmitter } = require('events');
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { on: vi.fn() };
      proc.kill = vi.fn();
      return proc;
    }),
  };
});
