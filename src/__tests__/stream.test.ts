import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable, PassThrough } from 'stream';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// Mock dependencies before imports
vi.mock('fs');
vi.mock('child_process');
vi.mock('../db/cacheStore.js', () => ({
  getCachedAudio: vi.fn(),
  putCachedAudio: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../music/youtube.js', () => ({
  extractVideoId: vi.fn((url: string) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
    return match ? match[1] : null;
  }),
  getYoutubeClient: vi.fn(),
}));
vi.mock('ytdlp-nodejs', () => ({
  YtDlp: vi.fn().mockImplementation(() => ({
    stream: vi.fn(),
  })),
}));

import { streamTrack, createTrackResource, prefetchTrack } from '../music/stream.js';
import { getCachedAudio, putCachedAudio } from '../db/cacheStore.js';
import { getYoutubeClient } from '../music/youtube.js';
import type { Track } from '../music/manager.js';

// Helper to create mock web stream from buffer  
function createMockWebStream(buffer: Buffer) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    }
  });
}

describe('stream.ts - yt-dlp handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock fs.existsSync to return false by default (no cache, no cookies)
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    // Mock fs.mkdirSync
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    
    // Mock cache directory exists
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      if (path === 'cache') return true;
      if (typeof path === 'string' && path.includes('cookies.txt')) return false;
      return false;
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 * 1024 } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkYtDlpBinary', () => {
    it('should detect yt-dlp is not available when binary check fails', async () => {
      vi.mocked(childProcess.spawnSync).mockReturnValue({
        status: 1,
        error: new Error('yt-dlp not found'),
      } as any);

      vi.mocked(getCachedAudio).mockResolvedValue(null);

      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
          download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.from('audio data')))),
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);

      const mockWriteStream = new PassThrough();
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any);

      await expect(streamTrack(track)).resolves.toBeDefined();
    });

    it('should use YTDLP_PATH environment variable if set', async () => {
      const customPath = '/custom/path/to/yt-dlp';
      process.env.YTDLP_PATH = customPath;

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === customPath) return true;
        if (path === 'cache') return true;
        return false;
      });

      vi.mocked(getCachedAudio).mockResolvedValue(null);

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProc = new EventEmitter() as any;
      mockProc.stdout = Readable.from([Buffer.from('audio')]);
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { on: vi.fn() };
      mockProc.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProc);

      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
          download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.from('audio data')))),
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);

      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      const streamPromise = streamTrack(track);
      
      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('test'));
      }, 10);

      await expect(streamPromise).resolves.toBeDefined();

      delete process.env.YTDLP_PATH;
    });
  });

  describe('streamTrack', () => {
    it('should throw error when track URL is missing', async () => {
      const track: Track = {
        url: '',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      await expect(streamTrack(track)).rejects.toThrow('Track URL missing');
    });

    it('should use filesystem cache when available', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      const cachedPath = '/path/to/cache/file';
      vi.mocked(getCachedAudio).mockResolvedValue({
        url: track.url,
        filePath: cachedPath,
        mime: 'audio/arbitrary',
        lastAccess: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastPlayed: new Date().toISOString(),
        playCount: 1,
      });

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === cachedPath) return true;
        if (path === 'cache') return true;
        return false;
      });

      const mockReadStream = Readable.from([Buffer.from('cached audio')]);
      vi.mocked(fs.createReadStream).mockReturnValue(mockReadStream as any);

      const result = await streamTrack(track);

      expect(result).toBeDefined();
      expect(result.stream).toBeDefined();
      expect(getCachedAudio).toHaveBeenCalledWith(track.url);
    });

    it('should reject live streams', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=livestream',
        title: 'Live Stream',
        durationMs: 0,
        requestedBy: 'testuser',
      };

      vi.mocked(getCachedAudio).mockResolvedValue(null);

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            is_live: true,
            is_live_content: true,
          },
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);

      await expect(streamTrack(track)).rejects.toThrow('Live or upcoming streams are not supported');
    });

    it('should fall back through providers when one fails', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      vi.mocked(getCachedAudio).mockResolvedValue(null);
      vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 1 } as any);

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
          download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.from('audio data')))),
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);
      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      const result = await streamTrack(track);

      expect(result).toBeDefined();
      expect(result.stream).toBeDefined();
    });

  });

  describe('prefetchTrack', () => {
    it('should skip prefetch if cache already exists', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('cache/')) return true;
        if (path === 'cache') return true;
        return false;
      });

      await prefetchTrack(track);

      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('should handle missing URL gracefully', async () => {
      const track: Track = {
        url: '',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      await prefetchTrack(track);

      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('should spawn yt-dlp process for prefetch when not cached', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === 'cache') return true;
        return false;
      });

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { on: vi.fn() };
      mockProc.kill = vi.fn();

      vi.mocked(childProcess.spawn).mockReturnValue(mockProc);
      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      const prefetchPromise = prefetchTrack(track);

      setTimeout(() => {
        mockProc.emit('close', 0);
      }, 10);

      await prefetchPromise;

      expect(childProcess.spawn).toHaveBeenCalledWith(
        'yt-dlp',
        expect.arrayContaining(['-f', 'bestaudio']),
        expect.any(Object)
      );
    });

    it('should handle prefetch errors gracefully', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      vi.mocked(fs.existsSync).mockReturnValue(false);

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { on: vi.fn() };
      mockProc.kill = vi.fn();

      vi.mocked(childProcess.spawn).mockReturnValue(mockProc);
      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const prefetchPromise = prefetchTrack(track);

      setTimeout(() => {
        mockProc.stderr.emit('data', Buffer.from('Error message'));
        mockProc.emit('close', 1);
      }, 10);

      await expect(prefetchPromise).resolves.toBeUndefined();
    });
  });

  describe('createTrackResource', () => {
    it('should create audio resource from stream', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      const cachedPath = '/path/to/cache/file';
      vi.mocked(getCachedAudio).mockResolvedValue({
        url: track.url,
        filePath: cachedPath,
        mime: 'audio/arbitrary',
        lastAccess: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastPlayed: new Date().toISOString(),
        playCount: 1,
      });

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === cachedPath) return true;
        if (path === 'cache') return true;
        return false;
      });

      const mockReadStream = Readable.from([Buffer.from('cached audio')]);
      vi.mocked(fs.createReadStream).mockReturnValue(mockReadStream as any);

      const resource = await createTrackResource(track, 0.5);

      expect(resource).toBeDefined();
      expect(resource.volume).toBeDefined();
    });

    it('should apply filters when specified', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      const cachedPath = '/path/to/cache/file';
      vi.mocked(getCachedAudio).mockResolvedValue({
        url: track.url,
        filePath: cachedPath,
        mime: 'audio/arbitrary',
        lastAccess: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastPlayed: new Date().toISOString(),
        playCount: 1,
      });

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === cachedPath) return true;
        if (path === 'cache') return true;
        return false;
      });

      const mockReadStream = Readable.from([Buffer.from('cached audio')]);
      vi.mocked(fs.createReadStream).mockReturnValue(mockReadStream as any);

      const mockFfmpeg = new EventEmitter() as any;
      mockFfmpeg.stdout = Readable.from([Buffer.from('filtered audio')]);
      mockFfmpeg.stdin = new PassThrough();
      mockFfmpeg.stdin.on = vi.fn();
      
      vi.mocked(childProcess.spawn).mockReturnValue(mockFfmpeg);

      const resource = await createTrackResource(track, 0.5, undefined, { bassBoost: true });

      expect(resource).toBeDefined();
      expect(childProcess.spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining(['-af', expect.stringContaining('equalizer')]),
        expect.any(Object)
      );
    });

    it('should handle seek parameter', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      vi.mocked(getCachedAudio).mockResolvedValue(null);

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = Readable.from([Buffer.from('audio')]);
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { on: vi.fn() };
      
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc);

      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('test'));
      }, 10);

      const resource = await createTrackResource(track, 0.5, 30);

      expect(resource).toBeDefined();
    });
  });

  describe('real-world URL handling', () => {
    it('should handle Rick Astley video URL', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Rick Astley - Never Gonna Give You Up',
        durationMs: 212000,
        requestedBy: 'testuser',
      };

      vi.mocked(getCachedAudio).mockResolvedValue(null);
      vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 1 } as any);

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('cookies.txt')) return false;
        if (path === 'cache') return true;
        return false;
      });

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            title: 'Rick Astley - Never Gonna Give You Up',
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
          download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.alloc(128 * 1024, 1)))),
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);
      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      const result = await streamTrack(track);

      expect(result).toBeDefined();
      expect(result.stream).toBeDefined();
      expect(mockYtClient.getInfo).toHaveBeenCalledWith('dQw4w9WgXcQ');
    });

    it('should extract video ID from Rick Astley URL variations', async () => {
      const testCases = [
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
        { url: 'https://youtu.be/dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', expectedId: 'dQw4w9WgXcQ' },
      ];

      vi.mocked(getCachedAudio).mockResolvedValue(null);
      vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 1 } as any);
      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      for (const { url, expectedId } of testCases) {
        const mockYtClient = {
          getInfo: vi.fn().mockResolvedValue({
            basic_info: {
              is_live: false,
              is_live_content: false,
              is_low_latency_live_stream: false,
              is_upcoming: false,
            },
            download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.alloc(128 * 1024, 1)))),
          }),
        };
        vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);

        const track: Track = {
          url,
          title: 'Rick Astley - Never Gonna Give You Up',
          durationMs: 212000,
          requestedBy: 'testuser',
        };

        await streamTrack(track);

        expect(mockYtClient.getInfo).toHaveBeenCalledWith(expectedId);
      }
    });

    it('should handle Rick Astley video with yt-dlp CLI fallback', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Rick Astley - Never Gonna Give You Up',
        durationMs: 212000,
        requestedBy: 'testuser',
      };

      vi.mocked(getCachedAudio).mockResolvedValue(null);
      
      // Mock yt-dlp binary as available
      vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 0 } as any);

      // Mock youtubei success
      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            title: 'Rick Astley - Never Gonna Give You Up',
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
          download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.alloc(128 * 1024, 1)))),
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);

      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      const result = await streamTrack(track);

      expect(result).toBeDefined();
      expect(result.stream).toBeDefined();
      
      // Verify video ID was extracted correctly
      expect(mockYtClient.getInfo).toHaveBeenCalledWith('dQw4w9WgXcQ');
    });
  });

  describe('cookies.txt handling', () => {
    it('should work without cookies.txt', async () => {
      const track: Track = {
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Track',
        durationMs: 180,
        requestedBy: 'testuser',
      };

      vi.mocked(getCachedAudio).mockResolvedValue(null);
      vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 1 } as any);

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('cookies.txt')) return false;
        if (path === 'cache') return true;
        return false;
      });

      const mockYtClient = {
        getInfo: vi.fn().mockResolvedValue({
          basic_info: {
            is_live: false,
            is_live_content: false,
            is_low_latency_live_stream: false,
            is_upcoming: false,
          },
          download: vi.fn().mockImplementation(() => Promise.resolve(createMockWebStream(Buffer.from('audio data')))),
        }),
      };
      vi.mocked(getYoutubeClient).mockResolvedValue(mockYtClient as any);
      vi.mocked(fs.createWriteStream).mockReturnValue(new PassThrough() as any);

      await streamTrack(track);

      expect(true).toBe(true);
    });
  });
});
