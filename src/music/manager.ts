import { AudioPlayer, AudioPlayerStatus, createAudioPlayer, VoiceConnection, joinVoiceChannel } from "@discordjs/voice";
import PQueue from "p-queue";
import { Queue } from "./queue.js";
import { saveQueueState, clearQueueState, listAllQueueStates } from "../db/queueStore.js";
import { listAllGuildVolumes, saveGuildVolume } from "../db/guildSettingsStore.js";
import { Client } from "discord.js";
import { log } from "../logger.js";
import crypto from "crypto";

export type LoopMode = "off" | "track" | "queue";

export interface AudioFilters {
  bassBoost?: boolean;
  nightcore?: boolean;
  vaporwave?: boolean;
  _8d?: boolean;
  lofi?: boolean;
  lowpass?: boolean;
}

export interface Track {
  id?: string;
  title: string;
  url: string;
  durationMs: number;
  requestedBy?: string;
  thumbnail?: string;
}

export interface GuildMusicState {
  connection: VoiceConnection | null;
  player: AudioPlayer;
  queue: Queue;
  current: Track | null;
  currentStartedAt: number | null;
  pausedAt: number | null;
  playbackBaseOffsetMs: number;
  history: Track[];
  loop: LoopMode;
  filters: AudioFilters;
  volume: number;
  taskQueue: PQueue;
  idleTimeout: NodeJS.Timeout | null;
  lastTextChannelId: string | null;
  sessionToken: string;
  retryCount: number;
  statsForNerds: boolean;
  playbackWatchdog: NodeJS.Timeout | null;
  lastPlaybackDuration: number;
  lastPlaybackTick: number;
}

export class MusicManager {
  private states = new Map<string, GuildMusicState>();
  private volumeByGuild = new Map<string, number>();

  get(guildId: string): GuildMusicState {
    const existing = this.states.get(guildId);
    if (existing) return existing;
    const state: GuildMusicState = {
      connection: null,
      player: createAudioPlayer(),
      queue: new Queue(),
      current: null,
      currentStartedAt: null,
      pausedAt: null,
      playbackBaseOffsetMs: 0,
      history: [],
      loop: "off",
      filters: {},
      volume: this.volumeByGuild.get(guildId) ?? 1,
      taskQueue: new PQueue({ concurrency: 1 }),
      idleTimeout: null,
      lastTextChannelId: null,
      sessionToken: crypto.randomUUID(),
      retryCount: 0,
      statsForNerds: false,
      playbackWatchdog: null,
      lastPlaybackDuration: 0,
      lastPlaybackTick: Date.now(),
    };
    this.states.set(guildId, state);
    return state;
  }

  async saveState(guildId: string) {
    const state = this.states.get(guildId);
    if (!state) return;
    this.volumeByGuild.set(guildId, state.volume);
    await saveGuildVolume(guildId, state.volume);
    
    // Don't save if empty and idle
    if (!state.current && state.queue.length === 0) {
      await clearQueueState(guildId);
      return;
    }

    await saveQueueState({
      guildId,
      current: state.current,
      queue: state.queue.all,
      history: state.history,
      loop: state.loop,
      volume: state.volume,
      playerStatus: state.player.state.status,
      paused: state.player.state.status === AudioPlayerStatus.Paused,
      lastTextChannelId: state.lastTextChannelId,
      voiceChannelId: state.connection?.joinConfig.channelId ?? null,
    });
  }

  async restoreGuildVolumes() {
    const rows = await listAllGuildVolumes();
    for (const row of rows) {
      this.volumeByGuild.set(row.guildId, row.volume);
    }
  }

  async restore(client: Client) {
    const states = await listAllQueueStates();
    log.info(`Restoring ${states.length} sessions...`);
    
    for (const data of states) {
      try {
        const guild = await client.guilds.fetch(data.guildId).catch(() => null);
        if (!guild) {
          await clearQueueState(data.guildId);
          continue;
        }

        const state = this.get(data.guildId);
        state.queue.enqueueMany(data.queue);
        state.history = data.history;
        state.loop = data.loop;
        state.volume = data.volume;
        this.volumeByGuild.set(data.guildId, data.volume);
        await saveGuildVolume(data.guildId, data.volume);
        state.lastTextChannelId = data.lastTextChannelId;

        const savedStatus = data.playerStatus ?? AudioPlayerStatus.Idle;
        const shouldResumeCurrent =
          !!data.current &&
          (savedStatus === AudioPlayerStatus.Playing || savedStatus === AudioPlayerStatus.Buffering);

        if (shouldResumeCurrent && data.current) {
          const currentTrack = data.current;
          const currentIdx = state.queue.all.findIndex(
            (track) =>
              (currentTrack.id && track.id === currentTrack.id) ||
              track.url === currentTrack.url,
          );
          if (currentIdx === -1) {
            state.queue.unshift(currentTrack);
          } else {
            state.queue.index = currentIdx - 1;
          }
          state.current = currentTrack;
        } else {
          state.current = null;
        }

        if (data.voiceChannelId) {
          const channel = await guild.channels.fetch(data.voiceChannelId).catch(() => null);
          if (channel && channel.isVoiceBased()) {
             state.connection = joinVoiceChannel({
              channelId: channel.id,
              guildId: guild.id,
              adapterCreator: guild.voiceAdapterCreator,
              selfDeaf: false,
            });
            state.connection.subscribe(state.player);
            
            if (shouldResumeCurrent && state.current) {
              const { playNext } = await import("./controller.js");
              await playNext(guild.id);
             }
          }
        }
      } catch (err) {
        log.error("Failed to restore session", { guildId: data.guildId, err });
      }
    }
  }

  cancelIdleDisconnect(guildId: string) {
    const state = this.get(guildId);
    if (state.idleTimeout) {
      clearTimeout(state.idleTimeout);
      state.idleTimeout = null;
      log.debug("Cancelled idle disconnect", { guildId });
    }
  }

  scheduleIdleDisconnect(guildId: string, delayMs = 30 * 60 * 1000) {
    const state = this.get(guildId);
    if (state.idleTimeout) clearTimeout(state.idleTimeout);
    const safeDelay = Math.max(0, delayMs);
    state.idleTimeout = setTimeout(() => this.disconnect(guildId), safeDelay);
  }

  disconnect(guildId: string) {
    const state = this.get(guildId);
    const channelId = state.connection?.joinConfig.channelId ?? null;
    log.info("Disconnect requested", { guildId, channelId });
    state.queue.clear();
    state.current = null;
    if (state.playbackWatchdog) {
      clearInterval(state.playbackWatchdog);
      state.playbackWatchdog = null;
    }
    try {
      // Force immediate stop of the player and any attached streams
      state.player.stop(true);
    } catch (e) {
      log.warn("Failed to stop player during disconnect", e);
    }
    if (state.connection) {
      try {
        state.connection.destroy();
        log.info("Voice connection destroyed", { guildId, channelId });
      } catch (e) {
        log.warn("Failed to destroy voice connection", e);
      } finally {
        state.connection = null;
      }
    }
    this.volumeByGuild.set(guildId, state.volume);
    void saveGuildVolume(guildId, state.volume);
    this.clearState(guildId);
    void clearQueueState(guildId);
    // Detach from channel (stop session)
    import("../status/sessionManager.js").then(({ stopSession }) => {
      stopSession(guildId);
    });
  }

  clearState(guildId: string) {
    this.states.delete(guildId);
  }
}

export const musicManager = new MusicManager();
