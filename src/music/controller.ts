import { AudioPlayerPlayingState, AudioPlayerStatus, joinVoiceChannel, VoiceConnection, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { GuildMember, VoiceBasedChannel } from "discord.js";
import { log } from "../logger.js";
import { formatDuration } from "../utils/format.js";
import { musicManager, Track } from "./manager.js";
import { saveGuildVolume } from "../db/guildSettingsStore.js";
import { createTrackResource, prefetchTrack, type StreamProviderMode } from "./stream.js";
import { getPlaybackElapsedMs, getPlaybackElapsedSeconds } from "./playbackPosition.js";
import { startStatusLoop, stopSession, updateSession, forceStatusUpdate } from "../status/sessionManager.js";

function formatPlaybackError(err: unknown, maxLen = 400): string {
  const message = err instanceof Error ? err.message : String(err);
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "Unknown error";
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
}

function logPlaybackError(context: string, err: unknown, meta?: Record<string, unknown>): string {
  const payload = meta ? { ...meta, err } : err;
  return log.error(context, payload);
}

function startPlaybackWatchdog(guildId: string, state: ReturnType<typeof musicManager.get>, track: Track) {
  if (state.playbackWatchdog) clearInterval(state.playbackWatchdog);
  state.lastPlaybackDuration = 0;
  state.lastPlaybackTick = Date.now();
  state.playbackWatchdog = setInterval(() => {
    const playerState = state.player.state;
    if (
      playerState.status !== AudioPlayerStatus.Playing &&
      playerState.status !== AudioPlayerStatus.Buffering
    ) {
      return;
    }
    const resource = (playerState as AudioPlayerPlayingState).resource;
    const currentDuration = resource?.playbackDuration ?? 0;
    if (currentDuration > state.lastPlaybackDuration) {
      state.lastPlaybackDuration = currentDuration;
      state.lastPlaybackTick = Date.now();
      return;
    }
    const stallTimeoutMs =
      playerState.status === AudioPlayerStatus.Buffering
        ? 45_000
        : 20_000;
    if (Date.now() - state.lastPlaybackTick > stallTimeoutMs) {
      const err = new Error("Playback stalled (no progress)");
      log.warn("Playback watchdog triggered", { guildId, track: track.title });
      state.player.emit("error", err);
      state.lastPlaybackTick = Date.now();
    }
  }, 5_000);
}

function stopPlaybackWatchdog(state: ReturnType<typeof musicManager.get>) {
  if (state.playbackWatchdog) {
    clearInterval(state.playbackWatchdog);
    state.playbackWatchdog = null;
  }
}

function getElapsedMs(state: ReturnType<typeof musicManager.get>): number {
  return getPlaybackElapsedMs(state);
}

function getElapsedSeconds(state: ReturnType<typeof musicManager.get>): number {
  return getPlaybackElapsedSeconds(state);
}

function getRetrySeekSeconds(track: Track, state: ReturnType<typeof musicManager.get>): number | null {
  const elapsed = getElapsedSeconds(state);
  if (track.durationMs > 0 && elapsed * 1000 >= track.durationMs) {
    return null;
  }
  return elapsed >= 1 ? elapsed : 0;
}

const SHORT_PLAYBACK_MS = 2_000;
const CLI_SHORT_FALLBACK_MIN_TRACK_MS = 15_000;

function isYtDlpNodeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("[ytdlp-nodejs]") || message.includes("ytdlp-nodejs");
}

function shouldFallbackToCliForShortPlayback(track: Track, elapsedMs: number | null): boolean {
  if (elapsedMs === null || elapsedMs >= SHORT_PLAYBACK_MS) return false;
  return track.durationMs === 0 || track.durationMs >= CLI_SHORT_FALLBACK_MIN_TRACK_MS;
}

export async function seek(guildId: string, seconds: number): Promise<boolean> {
  const state = musicManager.get(guildId);
  if (!state.current || !state.connection) return false;
  
  try {
    const resource = await createTrackResource(state.current, state.volume, seconds, state.filters);
    state.player.stop();
    state.playbackBaseOffsetMs = Math.max(0, seconds * 1000);
    state.player.play(resource);
    state.currentStartedAt = Date.now() - (seconds * 1000);
    state.pausedAt = null;
    return true;
  } catch (err) {
    log.error("Seek failed", err);
    return false;
  }
}

export async function ensureConnection(member: GuildMember, channel?: VoiceBasedChannel): Promise<VoiceConnection> {
  const state = musicManager.get(member.guild.id);
  const target = channel ?? member.voice.channel;
  if (!target) throw new Error("Join a voice channel first.");
  if (state.connection && state.connection.joinConfig.channelId === target.id) {
    return state.connection;
  }
  if (state.connection) {
    try {
      state.connection.destroy();
    } catch {}
    state.connection = null;
  }
  const connection = joinVoiceChannel({
    channelId: target.id,
    guildId: target.guild.id,
    adapterCreator: target.guild.voiceAdapterCreator,
    selfDeaf: false,
  });
  state.connection = connection;
  connection.subscribe(state.player);
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      log.warn("Voice connection disconnected", { guildId: target.guild.id });
      try {
        connection.destroy();
      } catch {}
      
      if (state.current) {
         log.info("Attempting to auto-reconnect...", { guildId: target.guild.id });
          try {
            await new Promise(r => setTimeout(r, 1000));
            await ensureConnection(member, target);
            if (state.current && (state.player.state.status === AudioPlayerStatus.Paused || state.player.state.status === AudioPlayerStatus.AutoPaused)) {
              resume(target.guild.id);
            }
            return;
          } catch (reconnectErr) {
           log.error("Auto-reconnect failed", reconnectErr);
         }
      }
      
      musicManager.scheduleIdleDisconnect(target.guild.id, 1000);
    }
  });
  return connection;
}

export async function enqueueAndPlay(guildId: string, track: Track) {
  const state = musicManager.get(guildId);
  if (!track.url) {
    throw new Error("Track URL is missing; cannot enqueue.");
  }
  state.queue.enqueue(track);
  log.info("Queued track", { guildId, title: track.title, url: track.url, by: track.requestedBy });
  void musicManager.saveState(guildId);
  
  musicManager.cancelIdleDisconnect(guildId);

  if (!state.current && state.player.state.status !== AudioPlayerStatus.Playing) {
    await playNext(guildId);
  }
}

export async function playNext(guildId: string) {
  const state = musicManager.get(guildId);
  await state.taskQueue.add(async () => {
    try {
      if (state.loop === "queue" && state.queue.index >= state.queue.length - 1) {
        state.queue.index = -1;
      }

      state.retryCount = 0;

      const next = state.queue.next();
      if (!next) {
        state.current = null;
        state.currentStartedAt = null;
        state.pausedAt = null;
        state.playbackBaseOffsetMs = 0;
        musicManager.scheduleIdleDisconnect(guildId);
        void musicManager.saveState(guildId);
        return;
      }
      
      musicManager.cancelIdleDisconnect(guildId);
      
      state.current = next;
      state.currentStartedAt = null;
      state.pausedAt = null;
      state.playbackBaseOffsetMs = 0;
      if (!state.connection) {
        log.warn("No voice connection when attempting to play", guildId);
        return;
      }
      const voiceChannelId = state.connection.joinConfig.channelId;
      if (voiceChannelId) {
        state.lastTextChannelId = voiceChannelId;
      }
      
      updateSession(guildId, voiceChannelId ?? null, state.lastTextChannelId, state.sessionToken);
      startStatusLoop(guildId, state);
      
      const playTrack = async (
        track: Track,
        seekSec?: number,
        options?: {
          providerMode?: StreamProviderMode;
          cliFallbackAttempted?: boolean;
          bufferedFallbackAttempted?: boolean;
        },
      ) => {
        const providerMode = options?.providerMode ?? "auto";
        const cliFallbackAttempted = options?.cliFallbackAttempted ?? providerMode === "cli-only";
        const bufferedFallbackAttempted = options?.bufferedFallbackAttempted ?? providerMode === "buffered-download";
        if (state.pausedAt) state.pausedAt = null;
        const baseOffsetMs = Math.max(0, (seekSec ?? 0) * 1000);
        const resource = await createTrackResource(track, state.volume, seekSec, state.filters, providerMode);
        
        state.player.removeAllListeners(AudioPlayerStatus.Idle);
        state.player.removeAllListeners(AudioPlayerStatus.Playing);
        state.player.removeAllListeners(AudioPlayerStatus.Buffering);
        state.player.removeAllListeners("stateChange");
        state.player.removeAllListeners("error");
        
        state.playbackBaseOffsetMs = baseOffsetMs;
        state.player.play(resource);
        
        state.player.on(AudioPlayerStatus.Playing, () => {
          if (state.pausedAt && state.currentStartedAt) {
            state.currentStartedAt += Date.now() - state.pausedAt;
            state.pausedAt = null;
          } else if (!state.currentStartedAt) {
            state.currentStartedAt = Date.now() - (seekSec ? seekSec * 1000 : 0);
            state.pausedAt = null;
          }

          log.debug("Player entered Playing state", { guildId, track: track.title });
          startPlaybackWatchdog(guildId, state, track);

          const nextIndex = state.queue.index + 1;
          const nextTrack = state.queue.all[nextIndex] || (state.loop === "queue" ? state.queue.all[0] : null);
          if (nextTrack) {
            void prefetchTrack(nextTrack);
          }
        });

        state.player.on(AudioPlayerStatus.Buffering, () => {
          log.debug("Player entered Buffering state", { guildId, track: track.title });
        });

        state.player.on("stateChange" as any, (_old: any, newState: any) => {
          if (newState.status === "autopaused") {
            log.debug("Player AutoPaused", { guildId, track: track.title });
          }
        });

        state.player.once(AudioPlayerStatus.Idle, async () => {
          stopPlaybackWatchdog(state);
          state.retryCount = 0;
          const trackWasReplaced = !!state.current?.id && state.current.id !== track.id;
          if (trackWasReplaced) {
            log.debug("Current track changed before idle handling; advancing to replacement", {
              guildId,
              previousTrack: track.title,
              replacementTrack: state.current?.title,
            });
            await playNext(guildId);
            return;
          }
          const elapsed = state.current ? getElapsedMs(state) : null;
          log.debug("Player entered Idle state", { guildId, track: track.title, elapsedMs: elapsed });
          const shortPlay = elapsed !== null && elapsed < SHORT_PLAYBACK_MS;

          if (!cliFallbackAttempted && shouldFallbackToCliForShortPlayback(track, elapsed)) {
            log.warn("Playback ended too quickly; retrying with yt-dlp CLI fallback", {
              guildId,
              track: track.title,
              elapsedMs: elapsed,
            });
            try {
              state.currentStartedAt = null;
              state.pausedAt = null;
              state.playbackBaseOffsetMs = 0;
              await playTrack(track, undefined, {
                providerMode: "cli-only",
                cliFallbackAttempted: true,
                bufferedFallbackAttempted: false,
              });
              return;
            } catch (fallbackErr) {
              log.error("CLI fallback after short playback failed", fallbackErr);
            }
          }

          if (cliFallbackAttempted && !bufferedFallbackAttempted && shouldFallbackToCliForShortPlayback(track, elapsed)) {
            log.warn("CLI fallback was still too short; retrying with buffered download fallback", {
              guildId,
              track: track.title,
              elapsedMs: elapsed,
            });
            try {
              state.currentStartedAt = null;
              state.pausedAt = null;
              state.playbackBaseOffsetMs = 0;
              await playTrack(track, undefined, {
                providerMode: "buffered-download",
                cliFallbackAttempted: true,
                bufferedFallbackAttempted: true,
              });
              return;
            } catch (bufferedErr) {
              log.error("Buffered download fallback failed", bufferedErr);
            }
          }
          
          if (!shortPlay && state.loop === "track") {
             state.queue.index = state.queue.index - 1;
          }
          
          await playNext(guildId);
        });

        state.player.on("error", async (err) => {
          stopPlaybackWatchdog(state);
          const errorId = logPlaybackError("Audio player error", err, { guildId, track: track.title });
          state.player.removeAllListeners(AudioPlayerStatus.Idle);

          if (!cliFallbackAttempted && isYtDlpNodeError(err)) {
            log.warn("ytdlp-nodejs failed during playback; retrying with yt-dlp CLI fallback", {
              guildId,
              track: track.title,
            });
            try {
              const seekSeconds = getRetrySeekSeconds(track, state);
              if (seekSeconds === null) {
                log.warn("Retry seek exceeded track duration; moving to next track", { guildId, track: track.title });
                state.retryCount = 0;
                state.currentStartedAt = null;
                state.pausedAt = null;
                state.playbackBaseOffsetMs = 0;
                await playNext(guildId);
                return;
              }
              await new Promise(r => setTimeout(r, 500));
              state.currentStartedAt = null;
              state.pausedAt = null;
              state.playbackBaseOffsetMs = 0;
              await playTrack(track, seekSeconds > 0 ? seekSeconds : undefined, {
                providerMode: "cli-only",
                cliFallbackAttempted: true,
                bufferedFallbackAttempted: false,
              });
              return;
            } catch (fallbackErr) {
              log.error("CLI fallback after ytdlp-nodejs error failed", fallbackErr);
            }
          }

          if (providerMode === "cli-only" && !bufferedFallbackAttempted) {
            log.warn("yt-dlp CLI playback failed; retrying with buffered download fallback", {
              guildId,
              track: track.title,
            });
            try {
              state.currentStartedAt = null;
              state.pausedAt = null;
              state.playbackBaseOffsetMs = 0;
              await playTrack(track, undefined, {
                providerMode: "buffered-download",
                cliFallbackAttempted: true,
                bufferedFallbackAttempted: true,
              });
              return;
            } catch (bufferedErr) {
              log.error("Buffered download fallback after CLI error failed", bufferedErr);
            }
          }

          if (state.retryCount < 3) {
            state.retryCount++;
            log.info(`Retrying playback (${state.retryCount}/3)`, { guildId });
            const seekSeconds = getRetrySeekSeconds(track, state);
            if (seekSeconds === null) {
              log.warn("Retry seek exceeded track duration; moving to next track", { guildId, track: track.title });
              state.retryCount = 0;
              state.currentStartedAt = null;
              state.pausedAt = null;
              state.playbackBaseOffsetMs = 0;
              await playNext(guildId);
              return;
            }
            try {
              await new Promise(r => setTimeout(r, 1000));
              state.currentStartedAt = null;
              state.pausedAt = null;
              state.playbackBaseOffsetMs = 0;
              await playTrack(track, seekSeconds > 0 ? seekSeconds : undefined, {
                providerMode,
                cliFallbackAttempted,
                bufferedFallbackAttempted,
              });
            } catch (retryErr) {
              log.error("Retry failed", retryErr);
              void playNext(guildId);
            }
          } else {
            state.retryCount = 0;
            if (state.lastTextChannelId) {
              import("../status/sessionManager.js").then(({ sendTemporaryMessage }) => {
                void sendTemporaryMessage(
                  guildId,
                  `Playback error: ${formatPlaybackError(err)} (Error ID: ${errorId})`,
                );
              });
            }
            void playNext(guildId);
          }
        });
      };

      await playTrack(next);
      
      state.connection.subscribe(state.player);
      log.info("Started track", { guildId, title: next.title, requestedBy: next.requestedBy });
      void musicManager.saveState(guildId);
      if (state.lastTextChannelId) {
        updateSession(guildId, state.connection.joinConfig.channelId ?? null, state.lastTextChannelId);
        startStatusLoop(guildId, state);
      }
    } catch (err) {
      const errorId = logPlaybackError("playNext failed", err, { guildId });
      if (state.lastTextChannelId) {
        import("../status/sessionManager.js").then(({ sendTemporaryMessage }) => {
          void sendTemporaryMessage(
            guildId,
            `Failed to play track: ${formatPlaybackError(err)} (Error ID: ${errorId})`,
          );
        });
      }
      await new Promise(r => setTimeout(r, 1000));
      void playNext(guildId);
    }
  });
}

export function skip(guildId: string): boolean {
  const state = musicManager.get(guildId);
  if (!state.current) return false;
  state.pausedAt = null;
  state.playbackBaseOffsetMs = 0;
  state.player.stop(true);
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
  return true;
}

export function previousTrack(guildId: string): boolean {
  const state = musicManager.get(guildId);
  const prev = state.queue.previous();
  if (!prev) return false;
  
  state.queue.index = state.queue.index - 1;
  state.pausedAt = null;
  state.playbackBaseOffsetMs = 0;
  state.player.stop(true);
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
  return true;
}

export function pause(guildId: string): boolean {
  const state = musicManager.get(guildId);
  const success = state.player.pause();
  if (success && state.currentStartedAt && !state.pausedAt) {
    state.pausedAt = Date.now();
  }
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
  return success;
}

export function resume(guildId: string): boolean {
  const state = musicManager.get(guildId);
  if (state.current && state.current.durationMs > 0 && getElapsedMs(state) >= state.current.durationMs) {
    state.pausedAt = null;
    state.currentStartedAt = null;
    state.playbackBaseOffsetMs = 0;
    state.player.stop(true);
    return true;
  }
  const success = state.player.unpause();
  if (success && state.currentStartedAt && state.pausedAt) {
    state.currentStartedAt += Date.now() - state.pausedAt;
    state.pausedAt = null;
  }
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
  return success;
}

export function stop(guildId: string) {
  const state = musicManager.get(guildId);
  stopPlaybackWatchdog(state);
  state.queue.clear();
  state.current = null;
  state.pausedAt = null;
  state.playbackBaseOffsetMs = 0;
  state.player.stop(true);
  musicManager.scheduleIdleDisconnect(guildId, 5000);
  stopSession(guildId);
  void musicManager.clearState(guildId);
  void import("../db/queueStore.js").then(m => m.clearQueueState(guildId));
}

export function setVolume(guildId: string, volumePercent: number) {
  const state = musicManager.get(guildId);
  state.volume = Math.max(0, Math.min(volumePercent / 100, 2));
  const currentState = state.player.state;
  if (currentState.status === AudioPlayerStatus.Playing || currentState.status === AudioPlayerStatus.Paused) {
    const resource = (currentState as AudioPlayerPlayingState).resource;
    if (resource?.volume) resource.volume.setVolume(state.volume);
  }
  void saveGuildVolume(guildId, state.volume);
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
}

export function shuffleQueue(guildId: string) {
  const state = musicManager.get(guildId);
  state.queue.shuffle();
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
}

export function moveInQueue(guildId: string, from: number, to: number): boolean {
  const state = musicManager.get(guildId);
  const success = state.queue.move(from - 1, to - 1);
  if (success) void musicManager.saveState(guildId);
  return success;
}

export function removeFromQueue(guildId: string, index: number): boolean {
  const state = musicManager.get(guildId);
  const removed = state.queue.remove(index - 1);
  if (removed) void musicManager.saveState(guildId);
  return !!removed;
}

export async function replaceTrack(guildId: string, oldId: string, newTrack: Track): Promise<boolean> {
  const state = musicManager.get(guildId);
  
  if (state.current && state.current.id === oldId) {
    log.info("Replacing current track", { guildId, old: state.current.title, new: newTrack.title });
    
    const replaced = state.queue.replace(oldId, newTrack);
    if (replaced) {
      // Start prefetch now so replacement playback can reuse cache if available.
      void prefetchTrack(newTrack);
      // Mark the replacement so the current idle handler skips fallback logic for the old track.
      state.current = newTrack;
      // We want to replay the current index (which now holds the new track).
      // playNext() calls queue.next() which increments the index,
      // so decrement first to keep playback on the replaced slot.
      state.currentStartedAt = null;
      state.pausedAt = null;
      state.playbackBaseOffsetMs = 0;
      
      state.queue.index = state.queue.index - 1;
      
      state.player.stop();
      void musicManager.saveState(guildId);
      return true;
    }
    return false;
  }

  const replaced = state.queue.replace(oldId, newTrack);
  if (replaced) {
    log.info("Replaced track in queue", { guildId, oldId, new: newTrack.title });
    void musicManager.saveState(guildId);
    return true;
  }
  
  return false;
}

export async function setFilters(guildId: string, filters: Partial<import("./manager.js").AudioFilters>) {
  const state = musicManager.get(guildId);
  state.filters = { ...state.filters, ...filters };
  
  if (state.current && state.player.state.status === AudioPlayerStatus.Playing) {
    const elapsed = getElapsedSeconds(state);
    await seek(guildId, elapsed);
  }
  
  void musicManager.saveState(guildId);
  void forceStatusUpdate(guildId);
}

export function describeQueuePage(guildId: string, page = 1, pageSize = 5) {
  const state = musicManager.get(guildId);
  const items = state.queue.all;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  if (items.length === 0) return { content: "Queue is empty.", page: 1, totalPages: 1 };
  const start = (safePage - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  const lines = slice.map((t, idx) => `${start + idx + 1}. ${t.title} (${formatDuration(t.durationMs)})`);
  return { content: lines.join("\n"), page: safePage, totalPages };
}
