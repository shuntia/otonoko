import { createAudioResource, demuxProbe, StreamType } from "@discordjs/voice";
import { log } from "../logger.js";
import { Track } from "./manager.js";
import { getCachedAudio, putCachedAudio } from "../db/cacheStore.js";
import { PassThrough, Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { spawn, spawnSync, ChildProcess } from "child_process";
import { YtDlp } from "ytdlp-nodejs";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { extractVideoId, getYoutubeClient } from "./youtube.js";

import { AudioFilters } from "./manager.js";

const CACHE_DIR = "cache";
const PREBUFFER_BYTES = 128 * 1024;
const PREBUFFER_TIMEOUT_MS = 2_000;
const FIRST_BYTE_TIMEOUT_MS = 8000;
const PROVIDER_STABILITY_WINDOW_MS = 2000;
const PREFETCH_WAIT_ON_PLAYBACK_MS = 12_000;
const YTDLP_NODEJS_MIN_STREAM_BYTES = 96 * 1024;
const MIN_CACHE_BYTES_SHORT_TRACK = 16 * 1024;
const MIN_CACHE_DURATION_MS = 15_000;
const activePrefetches = new Map<string, ChildProcess>();
const prefetchTasks = new Map<string, Promise<void>>();
const COOKIES_PATH = path.resolve("cookies.txt");
let loggedMissingCookies = false;
let ytDlpNode: YtDlp | null = null;
let ytDlpNodeUnavailable = false;
let ytDlpBinaryChecked = false;
let ytDlpBinaryAvailable = false;
type StreamResult = { stream: Readable; type: StreamType | undefined; skipProbe?: boolean };
export type StreamProviderMode = "auto" | "cli-only" | "buffered-download";

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR);
}

function getCachePath(url: string): string {
  const hash = crypto.createHash("md5").update(url).digest("hex");
  return path.join(CACHE_DIR, hash);
}

function checkYtDlpBinary(): boolean {
  if (ytDlpBinaryChecked) return ytDlpBinaryAvailable;
  ytDlpBinaryChecked = true;
  const envPath = process.env.YTDLP_PATH;
  if (envPath) {
    ytDlpBinaryAvailable = fs.existsSync(envPath);
    if (ytDlpBinaryAvailable) return true;
  }

  try {
    const result = spawnSync("yt-dlp", ["--version"], { stdio: "ignore" });
    if (result && result.status === 0) {
      ytDlpBinaryAvailable = true;
      return true;
    }
  } catch (e) {
    // ignore and try common locations
  }

  const commonPaths = ["/usr/bin/yt-dlp", "/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/sbin/yt-dlp"];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      // export so other code can pick it up
      process.env.YTDLP_PATH = p;
      ytDlpBinaryAvailable = true;
      return true;
    }
  }

  ytDlpBinaryAvailable = false;
  return false;
}

// Run a binary check at module load so PATH fixes are applied early
checkYtDlpBinary();

function getYtDlpNode(): YtDlp | null {
  if (ytDlpNodeUnavailable) return null;
  if (!checkYtDlpBinary()) {
    ytDlpNodeUnavailable = true;
    return null;
  }
  if (!ytDlpNode) {
    try {
      const binaryPath = process.env.YTDLP_PATH || "yt-dlp";
      ytDlpNode = new YtDlp({ binaryPath });
    } catch (err) {
      ytDlpNodeUnavailable = true;
      log.warn("ytdlp-nodejs unavailable; falling back to other providers", err);
      return null;
    }
  }
  return ytDlpNode;
}

function getTempPath(cachePath: string, suffix: string): string {
  return `${cachePath}.${Date.now()}-${Math.random().toString(36).slice(2)}.${suffix}`;
}

function cleanupTemp(tempPath: string) {
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
}

async function finalizeCache(url: string, tempPath: string, finalPath: string, source: string) {
  try {
    if (!fs.existsSync(finalPath)) {
      fs.renameSync(tempPath, finalPath);
      await putCachedAudio(url, finalPath, StreamType.Arbitrary);
      log.info("Cached track to disk", { url, path: finalPath, source });
    } else {
      cleanupTemp(tempPath);
    }
  } catch (e) {
    log.error("Failed to finalize cache file", e);
    cleanupTemp(tempPath);
  }
}

function getCookiesPath(): string | null {
  if (fs.existsSync(COOKIES_PATH)) return COOKIES_PATH;
  if (!loggedMissingCookies) {
    loggedMissingCookies = true;
    log.warn("cookies.txt not found; yt-dlp may be blocked", { path: COOKIES_PATH });
  }
  return null;
}

function buildYtDlpArgs(url: string, seekSec?: number): string[] {
  const args = ["-f", "bestaudio", "-o", "-", "--no-playlist", "--force-ipv4", "--no-warnings"];
  const cookiesPath = getCookiesPath();
  if (cookiesPath) args.push("--cookies", cookiesPath);
  if (seekSec) {
    args.push("--download-sections", `*${seekSec}-inf`);
  }
  args.push(url);
  return args;
}

function buildYtDlpOptions(seekSec?: number) {
  const options: Record<string, string | boolean> = {
    format: "bestaudio",
    noPlaylist: true,
    forceIpv4: true,
    noWarnings: true,
  };
  const cookiesPath = getCookiesPath();
  if (cookiesPath) options.cookies = cookiesPath;
  if (seekSec) options.downloadSections = `*${seekSec}-inf`;
  return options;
}

async function assertNotLive(url: string) {
  const videoId = extractVideoId(url);
  if (!videoId) return;
  const yt = await getYoutubeClient();
  const info = await yt.getInfo(videoId);
  const basic = info.basic_info;
  const hasHls = Boolean((info as { streaming_data?: { hls_manifest_url?: string } }).streaming_data?.hls_manifest_url);
  if (basic?.is_live || basic?.is_live_content || basic?.is_low_latency_live_stream || basic?.is_upcoming || hasHls) {
    throw new Error("Live or upcoming streams are not supported.");
  }
}

function isLiveUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("Live or upcoming streams are not supported.");
}

async function waitForFirstByte(stream: Readable, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const readable = stream as Readable;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Stream timed out after ${timeoutMs}ms (no data)`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      cleanup();
      if (typeof readable.pause === "function" && typeof readable.unshift === "function") {
        readable.pause();
        readable.unshift(chunk);
      }
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Stream ended before data was received"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };

    stream.once("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
  });
}

function replayCapturedChunks(stream: Readable, captured: Buffer[]) {
  if (captured.length === 0) return;
  const readable = stream as Readable;
  if (typeof readable.pause === "function" && typeof readable.unshift === "function") {
    readable.pause();
    for (let i = captured.length - 1; i >= 0; i--) {
      readable.unshift(captured[i]);
    }
  }
}

async function waitForProviderReadiness(
  stream: Readable,
  firstByteTimeoutMs: number,
  minExpectedBytes: number,
  stabilityWindowMs = PROVIDER_STABILITY_WINDOW_MS,
) {
  if (minExpectedBytes <= 1) {
    await waitForFirstByte(stream, firstByteTimeoutMs);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const captured: Buffer[] = [];
    let totalBytes = 0;
    let readinessTimer: NodeJS.Timeout | null = null;
    const firstByteTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`Provider stream timed out after ${firstByteTimeoutMs}ms (no data)`));
    }, firstByteTimeoutMs);

    const cleanup = () => {
      clearTimeout(firstByteTimer);
      if (readinessTimer) clearTimeout(readinessTimer);
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };

    const succeed = () => {
      cleanup();
      replayCapturedChunks(stream, captured);
      resolve();
    };

    const onData = (chunk: Buffer) => {
      const buf = Buffer.from(chunk);
      captured.push(buf);
      totalBytes += buf.length;

      if (totalBytes === buf.length) {
        clearTimeout(firstByteTimer);
        readinessTimer = setTimeout(() => {
          succeed();
        }, Math.max(0, stabilityWindowMs));
      }

      if (totalBytes >= minExpectedBytes) {
        succeed();
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onEnd = () => {
      cleanup();
      if (totalBytes < minExpectedBytes) {
        reject(new Error(`Provider stream ended too early (${totalBytes} bytes, expected >= ${minExpectedBytes})`));
        return;
      }
      replayCapturedChunks(stream, captured);
      resolve();
    };

    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
  });
}

function getMinimumExpectedBytes(track: Track): number {
  if (track.durationMs === 0 || track.durationMs >= MIN_CACHE_DURATION_MS) {
    return YTDLP_NODEJS_MIN_STREAM_BYTES;
  }
  if (track.durationMs >= 5_000) {
    return MIN_CACHE_BYTES_SHORT_TRACK;
  }
  return 1;
}

function getFileSizeSafe(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function waitForWritableStreamFinish(stream: fs.WriteStream): Promise<void> {
  if (stream.writableFinished) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.once("finish", () => resolve());
    stream.once("error", (err) => reject(err));
  });
}

export async function prefetchTrack(track: Track): Promise<void> {
  if (!track.url) return;
  const existingPrefetch = prefetchTasks.get(track.url);
  if (existingPrefetch) {
    await existingPrefetch;
    return;
  }

  const cachePath = getCachePath(track.url);
  const minExpectedBytes = getMinimumExpectedBytes(track);
  if (fs.existsSync(cachePath)) {
    const cachedBytes = getFileSizeSafe(cachePath);
    if (cachedBytes >= minExpectedBytes) return;
    log.warn("Ignoring suspiciously short cache before prefetch", {
      url: track.url,
      path: cachePath,
      bytes: cachedBytes,
      minExpectedBytes,
    });
    cleanupTemp(cachePath);
  }

  const tempPath = getTempPath(cachePath, "prefetch");
  const task = (async () => {
    log.debug("Prefetching track", { url: track.url });
    try {
      await new Promise<void>((resolve, reject) => {
        const args = buildYtDlpArgs(track.url);

        const ytdlpCmd = process.env.YTDLP_PATH || "yt-dlp";
        const proc = spawn(ytdlpCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        activePrefetches.set(track.url, proc);
        proc.once("error", (e) => reject(e));

        const fileStream = fs.createWriteStream(tempPath);
        proc.stdout?.pipe(fileStream);

        let stderr = "";
        proc.stderr?.on("data", (d) => (stderr += d.toString()));

        proc.once("close", async (code) => {
          activePrefetches.delete(track.url);
          if (code !== 0) {
            cleanupTemp(tempPath);
            reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
          } else {
            try {
              await waitForWritableStreamFinish(fileStream);
              const prefetchBytes = getFileSizeSafe(tempPath);
              if (prefetchBytes < minExpectedBytes) {
                cleanupTemp(tempPath);
                reject(new Error(`Prefetch produced too little data (${prefetchBytes} bytes)`));
                return;
              }
              await finalizeCache(track.url, tempPath, cachePath, "prefetch");
              resolve();
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        });
      });
      log.debug("Prefetch complete", { url: track.url });
    } catch (err) {
      log.warn("Prefetch failed", { url: track.url, err });
      cleanupTemp(tempPath);
    } finally {
      prefetchTasks.delete(track.url);
      activePrefetches.delete(track.url);
    }
  })();

  prefetchTasks.set(track.url, task);
  await task;
}

export async function streamTrack(
  track: Track,
  seekSec?: number,
  providerMode: StreamProviderMode = "auto",
): Promise<StreamResult> {
  if (!track.url) {
    throw new Error("Track URL missing");
  }
  const startedAt = Date.now();
  const minExpectedBytes = getMinimumExpectedBytes(track);
  log.debug("streamTrack start", { url: track.url, seekSec, providerMode });

  if (!seekSec && providerMode !== "buffered-download") {
    const activePrefetchTask = prefetchTasks.get(track.url);
    if (activePrefetchTask) {
      log.debug("Waiting for active prefetch to complete before playback", { url: track.url });
      await Promise.race([
        activePrefetchTask,
        new Promise<void>((resolve) => setTimeout(resolve, PREFETCH_WAIT_ON_PLAYBACK_MS)),
      ]);
    }

    const dbCached = await getCachedAudio(track.url);
    if (dbCached && fs.existsSync(dbCached.filePath)) {
      const cachedBytes = getFileSizeSafe(dbCached.filePath);
      if (cachedBytes < minExpectedBytes) {
        log.warn("Ignoring suspiciously short cache file", {
          url: track.url,
          path: dbCached.filePath,
          bytes: cachedBytes,
          minExpectedBytes,
        });
        cleanupTemp(dbCached.filePath);
      } else {
        log.debug("Filesystem cache hit", { url: track.url, path: dbCached.filePath, bytes: cachedBytes });
        const fileStream = fs.createReadStream(dbCached.filePath);
        const cachedType = Object.values(StreamType).includes(dbCached.mime as StreamType)
          ? (dbCached.mime as StreamType)
          : StreamType.Arbitrary;
        return {
          stream: prebufferReadable(fileStream, PREBUFFER_BYTES, PREBUFFER_TIMEOUT_MS),
          type: cachedType,
          skipProbe: false,
        };
      }
    }
  }

  try {
    if (seekSec && providerMode !== "buffered-download") {
      if (providerMode === "auto") {
        try {
          await assertNotLive(track.url);
        } catch (err) {
          if (isLiveUnsupportedError(err) && checkYtDlpBinary()) {
            log.warn("Live/upcoming stream detected; forcing yt-dlp CLI fallback", { url: track.url });
            return streamTrack(track, undefined, "cli-only");
          }
          throw err;
        }
      }
      const cli = await ytDlpStream(track.url, seekSec);
      await waitForFirstByte(cli.stream, FIRST_BYTE_TIMEOUT_MS);
      return {
        ...cli,
        stream: prebufferReadable(cli.stream, PREBUFFER_BYTES, PREBUFFER_TIMEOUT_MS),
      };
    }

    if (providerMode === "auto") {
      try {
        await assertNotLive(track.url);
      } catch (err) {
        if (isLiveUnsupportedError(err) && checkYtDlpBinary()) {
          log.warn("Live/upcoming stream detected; forcing yt-dlp CLI fallback", { url: track.url });
          return streamTrack(track, undefined, "cli-only");
        }
        throw err;
      }
    }

    const cachePath = getCachePath(track.url);

    if (providerMode === "buffered-download") {
      if (fs.existsSync(cachePath)) {
        const cachedSize = getFileSizeSafe(cachePath);
        if (cachedSize >= minExpectedBytes) {
          log.debug("Buffered fallback using existing cache", { url: track.url, path: cachePath, bytes: cachedSize });
          const fileStream = fs.createReadStream(cachePath);
          return {
            stream: prebufferReadable(fileStream, PREBUFFER_BYTES, PREBUFFER_TIMEOUT_MS),
            type: StreamType.Arbitrary,
            skipProbe: false,
          };
        }
        log.warn("Ignoring suspiciously short cache for buffered fallback", {
          url: track.url,
          path: cachePath,
          bytes: cachedSize,
          minExpectedBytes,
        });
      }

      if (!checkYtDlpBinary()) {
        throw new Error("yt-dlp CLI is unavailable for buffered fallback.");
      }

      const tempPath = getTempPath(cachePath, "buffered.tmp");
      await ytDlpBufferedDownloadAndCache(track.url, tempPath, cachePath, minExpectedBytes);
      const fileStream = fs.createReadStream(cachePath);
      return {
        stream: prebufferReadable(fileStream, PREBUFFER_BYTES, PREBUFFER_TIMEOUT_MS),
        type: StreamType.Arbitrary,
        skipProbe: false,
      };
    }

    const providers =
      providerMode === "cli-only"
        ? [
            ...(checkYtDlpBinary()
              ? [{
                  name: "yt-dlp",
                  create: async () => {
                    const tempPath = getTempPath(cachePath, "cli.tmp");
                    return ytDlpStreamAndCache(track.url, tempPath, cachePath, minExpectedBytes);
                  },
                }]
              : []),
          ]
        : [
            ...(getYtDlpNode()
              ? [{
                  name: "ytdlp-nodejs",
                  create: async () => {
                    const tempPath = getTempPath(cachePath, "node.tmp");
                    return ytDlpNodeStreamAndCache(track.url, tempPath, cachePath, minExpectedBytes);
                  },
                }]
              : []),
            ...(checkYtDlpBinary()
              ? [{
                  name: "yt-dlp",
                  create: async () => {
                    const tempPath = getTempPath(cachePath, "cli.tmp");
                    return ytDlpStreamAndCache(track.url, tempPath, cachePath, minExpectedBytes);
                  },
                }]
              : []),
            {
              name: "youtubei",
              create: async () => {
                const tempPath = getTempPath(cachePath, "yt.tmp");
                return youtubeiStreamAndCache(track.url, tempPath, cachePath, minExpectedBytes);
              },
            },
          ];

    if (providers.length === 0) {
      throw new Error(
        providerMode === "cli-only"
          ? "yt-dlp CLI is unavailable for forced fallback."
          : "No stream providers are available.",
      );
    }

    let lastErr: unknown = null;
    for (const provider of providers) {
      try {
        const streamResult = await provider.create();
        await waitForProviderReadiness(streamResult.stream, FIRST_BYTE_TIMEOUT_MS, minExpectedBytes);
        log.debug("Stream provider selected", { provider: provider.name, url: track.url });
        return {
          ...streamResult,
          stream: prebufferReadable(streamResult.stream, PREBUFFER_BYTES, PREBUFFER_TIMEOUT_MS),
        };
      } catch (err) {
        lastErr = err;
        if (provider.name === "ytdlp-nodejs") {
          ytDlpNodeUnavailable = true;
        }
        log.warn("Stream provider failed", { provider: provider.name, url: track.url, err });
        try {
          log.debug("Stream provider failure details", { provider: provider.name, message: (err as any)?.message, stack: (err as any)?.stack });
        } catch (e) {}
      }
    }
    throw lastErr ?? new Error("All stream providers failed");
  } catch (err) {
    log.error("Stream generation failed", err);
    throw err;
  } finally {
    log.debug("streamTrack done", { url: track.url, ms: Date.now() - startedAt });
  }
}

export async function createTrackResource(
  track: Track,
  volume: number,
  seekSec?: number,
  filters?: AudioFilters,
  providerMode: StreamProviderMode = "auto",
) {
  const { stream, type, skipProbe } = await streamTrack(track, seekSec, providerMode);
  let inputStream: Readable = stream;
  
  if (filters && (filters.bassBoost || filters.nightcore || filters.vaporwave || filters._8d || filters.lofi || filters.lowpass)) {
    inputStream = applyFilters(inputStream, filters);
  }

  let resource;
  try {
    if (skipProbe) {
       resource = createAudioResource(inputStream, { inputType: type ?? StreamType.Arbitrary, inlineVolume: true });
    } else {
       const probe = await demuxProbe(inputStream);
       resource = createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true });
    }
  } catch (e) {
    log.warn("Probe failed, falling back to arbitrary", e);
    resource = createAudioResource(inputStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
  }

  if (resource.volume) {
    resource.volume.setVolume(Math.max(0, volume));
  }

  // Monitor the audio pipeline for unexpected termination
  const ps = (resource as any).playStream as Readable | undefined;
  if (ps) {
    ps.once("end",   () => log.debug("AudioResource playStream ended",  { title: track.title }));
    ps.once("close", () => log.debug("AudioResource playStream closed", { title: track.title }));
    ps.once("error", (err: Error) => log.warn("AudioResource playStream error", { title: track.title, err }));
  }

  return resource;
}

function applyFilters(input: Readable, filters: AudioFilters): Readable {
  const args = [
    "-i", "pipe:0",
    "-f", "opus",
    "-ac", "2",
    "-ar", "48000",
  ];

  const filterChain: string[] = [];
  if (filters.bassBoost) filterChain.push("equalizer=f=40:width_type=h:width=50:g=10");
  if (filters.nightcore) filterChain.push("asetrate=48000*1.25,aresample=48000");
  if (filters.vaporwave) filterChain.push("asetrate=48000*0.8,aresample=48000");
  if (filters._8d) filterChain.push("apulsator=hz=0.125");
  if (filters.lofi) filterChain.push("aresample=22050,lowpass=f=3000,highpass=f=200");
  if (filters.lowpass) filterChain.push("lowpass=f=1000");

  if (filterChain.length > 0) {
    args.push("-af", filterChain.join(","));
  }
  
  args.push("pipe:1");

  const ffmpeg = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "ignore"] });
  
  ffmpeg.stdin.on("error", (err) => {
    const code = (err as { code?: string }).code;
    if (code !== "EPIPE") {
      log.error("FFmpeg stdin error", err);
    }
  });

  input.pipe(ffmpeg.stdin);
  
  ffmpeg.on("error", (err) => {
    log.error("FFmpeg filter error", err);
  });

  return ffmpeg.stdout;
}

function prebufferReadable(
  source: Readable,
  thresholdBytes: number,
  timeoutMs: number,
): Readable {
  const playback = new PassThrough();
  playback.on("error", () => {});
  let released = false;
  let total = 0;
  const buffered: Buffer[] = [];

  const firstByteTimeout = setTimeout(() => {
    if (total === 0) {
      const err = new Error("Stream timed out (no data received) after 45s");
      log.warn("Stream timeout", { thresholdBytes, timeoutMs });
      playback.destroy(err);
      const sourceControls = source as { destroy?: (err?: Error) => void; kill?: () => void };
      if (sourceControls.destroy) sourceControls.destroy(err);
      else if (sourceControls.kill) sourceControls.kill();
    }
  }, 45000);

  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    log.debug("Prebuffer released", { bufferedBytes: total, byThreshold: total >= thresholdBytes });
    // Flush already-buffered bytes, then keep forwarding via onData (no pipe/mode-switch).
    for (const buf of buffered) playback.write(buf);
    buffered.length = 0;
    playback.once("end",   () => log.debug("Prebuffer output ended"));
    playback.once("close", () => log.debug("Prebuffer output closed"));
  };

  const timer = setTimeout(release, Math.max(0, timeoutMs));

  const onData = (chunk: Buffer) => {
    clearTimeout(firstByteTimeout);
    const buf = Buffer.from(chunk);
    if (!released) {
      buffered.push(buf);
      total += buf.length;
      if (total >= thresholdBytes) {
        release();
      }
    } else {
      // After release, forward directly — no mode transition, no dropped data.
      if (!playback.write(buf)) {
        source.pause();
      }
    }
  };

  playback.on("drain", () => source.resume());

  source.on("data", onData);
  source.on("end", () => {
    clearTimeout(firstByteTimeout);
    if (!released) release();
    log.debug("Prebuffer source ended", { bufferedBytes: total });
    playback.end();
  });
  source.on("error", (err) => {
    clearTimeout(firstByteTimeout);
    log.warn("Prebuffer source error", { err });
    playback.destroy(err);
  });

  source.resume();

  return playback;
}

async function ytDlpStream(
  url: string,
  seekSec?: number,
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const args = buildYtDlpArgs(url, seekSec);

    const ytdlpCmd = process.env.YTDLP_PATH || "yt-dlp";
    const proc = spawn(ytdlpCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    
    proc.once("error", (e) => {
      proc.stdout?.emit("error", e);
    });
    
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    
    proc.once("close", (code) => {
      if (code !== 0) {
        log.error("yt-dlp exited with code", code, stderr);
        proc.stdout?.emit('error', new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }
    });

    if (!proc.stdout) {
      reject(new Error("yt-dlp did not provide a stdout stream"));
      return;
    }
    resolve({ stream: proc.stdout as Readable, type: StreamType.Arbitrary, skipProbe: true });
  });
}

async function ytDlpStreamAndCache(
  url: string,
  tempPath: string,
  finalPath: string,
  minExpectedBytes: number,
): Promise<StreamResult> {
  return new Promise((resolve, _reject) => {
    const args = buildYtDlpArgs(url);

    const playback = new PassThrough();
    playback.on("error", () => {});
    const fileStream = fs.createWriteStream(tempPath);
    
    const ytdlpCmd = process.env.YTDLP_PATH || "yt-dlp";
    const proc = spawn(ytdlpCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = proc.stdout;
    if (!stdout) {
      playback.destroy(new Error("yt-dlp did not provide a stdout stream"));
      resolve({ stream: playback, type: StreamType.Arbitrary, skipProbe: true });
      return;
    }
    proc.once("error", (e) => {
      playback.emit("error", e);
    });

    let stderr = "";
    let totalBytes = 0;
    let sourceEnded = false;
    let sourceShort = false;
    let procClosed = false;
    let procCode: number | null = null;
    let finalized = false;

    const maybeFinalize = async () => {
      if (finalized || !sourceEnded || !procClosed || procCode !== 0 || sourceShort) return;
      finalized = true;
      await waitForWritableStreamFinish(fileStream);
      await finalizeCache(url, tempPath, finalPath, "yt-dlp");
    };
    const runFinalize = () => {
      void maybeFinalize().catch((err) => {
        cleanupTemp(tempPath);
        playback.destroy(err instanceof Error ? err : new Error(String(err)));
      });
    };

    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
    });
    stdout.once("end", () => {
      sourceEnded = true;
      if (totalBytes < minExpectedBytes) {
        sourceShort = true;
        cleanupTemp(tempPath);
        playback.destroy(new Error(`[yt-dlp] stream ended too early (${totalBytes} bytes)`));
        return;
      }
      playback.end();
      runFinalize();
    });
    
    stdout.pipe(fileStream);
    stdout.pipe(playback, { end: false });

    proc.once("close", (code) => {
      procClosed = true;
      procCode = code;
      if (code !== 0) {
        log.error("yt-dlp exited with code", code, stderr);
        cleanupTemp(tempPath);
        playback.emit('error', new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }
      runFinalize();
    });

    resolve({ stream: playback, type: StreamType.Arbitrary, skipProbe: true });
  });
}

async function ytDlpNodeStreamAndCache(
  url: string,
  tempPath: string,
  finalPath: string,
  minExpectedBytes: number,
): Promise<StreamResult> {
  const client = getYtDlpNode();
  if (!client) {
    throw new Error("ytdlp-nodejs is not available");
  }
  const options = buildYtDlpOptions();
  const streamBuilder = client.stream(url, options);
  const playback = new PassThrough();
  playback.on("error", () => {});

  // Get the single underlying stream (one yt-dlp process, one passThrough).
  // We tee it manually: audio goes to playback, a copy goes to the cache file.
  // Avoid calling streamBuilder.pipe(fileStream) because that calls
  // passThrough.pipe(fileStream) on the same stream we already piped to
  // playback, creating a dual-pipe that backpressures audio when disk is slow.
  const underlying = streamBuilder.getStream();
  const fileStream = fs.createWriteStream(tempPath);
  let fileStreamOpen = true;

  let underlyingBytes = 0;
  underlying.on("data", (chunk: Buffer) => {
    underlyingBytes += chunk.length;
    if (fileStreamOpen) {
      fileStream.write(chunk);
    }
    if (!playback.write(chunk)) {
      underlying.pause();
    }
  });
  playback.on("drain", () => underlying.resume());
  underlying.on("end", async () => {
    log.debug("ytdlp-nodejs underlying stream ended", { url, totalBytes: underlyingBytes });
    if (underlyingBytes < minExpectedBytes) {
      ytDlpNodeUnavailable = true;
      const shortErr = new Error(
        `[ytdlp-nodejs] stream ended unexpectedly early (${underlyingBytes} bytes)`,
      );
      log.warn("ytdlp-nodejs stream too short; marking unavailable", { url, totalBytes: underlyingBytes });
      if (fileStreamOpen) {
        fileStreamOpen = false;
        fileStream.destroy();
      }
      cleanupTemp(tempPath);
      playback.destroy(shortErr);
      return;
    }

    playback.end();
    if (fileStreamOpen) {
      try {
        fileStreamOpen = false;
        fileStream.end();
        await waitForWritableStreamFinish(fileStream);
        await finalizeCache(url, tempPath, finalPath, "ytdlp-nodejs");
      } catch (err) {
        cleanupTemp(tempPath);
        playback.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
  underlying.on("error", (err: Error) => {
    ytDlpNodeUnavailable = true;
    const wrappedErr = new Error(`[ytdlp-nodejs] ${err.message}`);
    log.warn("ytdlp-nodejs stream error", { url, err });
    if (fileStreamOpen) {
      fileStreamOpen = false;
      fileStream.destroy();
      cleanupTemp(tempPath);
    }
    playback.destroy(wrappedErr);
  });

  return { stream: playback, type: StreamType.Arbitrary, skipProbe: true };
}

async function ytDlpBufferedDownloadAndCache(
  url: string,
  tempPath: string,
  finalPath: string,
  minExpectedBytes: number,
): Promise<void> {
  const args = buildYtDlpArgs(url);
  const ytdlpCmd = process.env.YTDLP_PATH || "yt-dlp";
  const proc = spawn(ytdlpCmd, args, { stdio: ["ignore", "pipe", "pipe"] });

  if (!proc.stdout) {
    throw new Error("yt-dlp did not provide a stdout stream for buffered fallback");
  }

  const fileStream = fs.createWriteStream(tempPath);
  let stderr = "";
  let totalBytes = 0;

  proc.stderr?.on("data", (d) => (stderr += d.toString()));
  proc.stdout.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let procClosed = false;
    let procCode: number | null = null;
    let fileFinished = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupTemp(tempPath);
      reject(err);
    };

    const maybeComplete = async () => {
      if (settled || !procClosed || !fileFinished) return;
      if (procCode !== 0) {
        fail(new Error(`yt-dlp buffered fallback exited with code ${procCode}: ${stderr}`));
        return;
      }
      if (totalBytes < minExpectedBytes) {
        fail(new Error(`yt-dlp buffered fallback produced too little data (${totalBytes} bytes)`));
        return;
      }
      try {
        await finalizeCache(url, tempPath, finalPath, "yt-dlp-buffered");
        if (!settled) {
          settled = true;
          resolve();
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };

    proc.once("error", (err) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    });

    fileStream.once("error", (err) => {
      proc.kill();
      fail(err instanceof Error ? err : new Error(String(err)));
    });

    fileStream.once("finish", () => {
      fileFinished = true;
      void maybeComplete();
    });

    proc.once("close", (code) => {
      procClosed = true;
      procCode = code;
      void maybeComplete();
    });

    proc.stdout?.pipe(fileStream);
  });
}

async function youtubeiStreamAndCache(
  url: string,
  tempPath: string,
  finalPath: string,
  minExpectedBytes: number,
): Promise<StreamResult> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Could not extract video id for youtubei streaming");
  }
  const yt = await getYoutubeClient();
  const info = await yt.getInfo(videoId);
  const basic = info.basic_info;
  const hasHls = Boolean((info as { streaming_data?: { hls_manifest_url?: string } }).streaming_data?.hls_manifest_url);
  if (basic?.is_live || basic?.is_live_content || basic?.is_low_latency_live_stream || basic?.is_upcoming || hasHls) {
    throw new Error("Live or upcoming streams are not supported.");
  }

  let webStream;
  try {
    webStream = await info.download({ type: "audio", quality: "best" });
  } catch (err) {
    log.warn("youtubei download failed", { url, videoId, err });
    throw err;
  }
  const nodeStream = Readable.fromWeb(webStream as unknown as NodeReadableStream);

  const fileStream = fs.createWriteStream(tempPath);
  const playback = new PassThrough();
  playback.on("error", () => {});
  let totalBytes = 0;

  nodeStream.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
  });
  nodeStream.on("error", (err) => {
    cleanupTemp(tempPath);
    playback.emit("error", err);
  });

  nodeStream.on("end", async () => {
    if (totalBytes < minExpectedBytes) {
      cleanupTemp(tempPath);
      playback.destroy(new Error(`[youtubei] stream ended too early (${totalBytes} bytes)`));
      return;
    }
    try {
      playback.end();
      await waitForWritableStreamFinish(fileStream);
      await finalizeCache(url, tempPath, finalPath, "youtubei");
    } catch (err) {
      cleanupTemp(tempPath);
      playback.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  nodeStream.pipe(fileStream);
  nodeStream.pipe(playback, { end: false });

  return { stream: playback, type: StreamType.Arbitrary, skipProbe: true };
}
