import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { GuildMusicState } from "../music/manager.js";
import { musicManager } from "../music/manager.js";
import { getPlaybackElapsedMs } from "../music/playbackPosition.js";
import { formatDuration } from "../utils/format.js";
import { updateStatus, clearStatus, setStatusClient, getClient } from "./statusManager.js";
import { log } from "../logger.js";
import { statsTracker } from "../utils/statsTracker.js";
import { getCacheStats } from "../db/cacheStore.js";

interface Session {
  guildId: string;
  voiceChannelId: string | null;
  textChannelId: string | null;
  statusMessageId: string | null;
  interval: NodeJS.Timeout | null;
  token: string;
}

const sessions = new Map<string, Session>();
let clientSet = false;
let lastPresencePlaying: boolean | null = null;

function updatePlaybackPresence() {
  const client = getClient();
  if (!client?.user) return;
  const isPlaying = [...sessions.keys()].some((guildId) => {
    const state = musicManager.get(guildId);
    return state.player.state.status === AudioPlayerStatus.Playing;
  });
  if (lastPresencePlaying === isPlaying) return;
  lastPresencePlaying = isPlaying;
  client.user.setPresence({
    activities: [{ name: isPlaying ? "playing music" : "not playing" }],
  });
}

export function attachStatusClient(client: Client) {
  if (!clientSet) {
    setStatusClient(client);
    clientSet = true;
    updatePlaybackPresence();
  }
}

export async function sendTemporaryMessage(guildId: string, content: string, timeout = 10000) {
  const session = sessions.get(guildId);
  if (!session || !session.textChannelId) return;
  
  const client = getClient();
  if (!client) return;

  try {
    const channel = await client.channels.fetch(session.textChannelId);
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
      const msg = await channel.send({ content: `⚠️ ${content}` });
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, timeout);
    }
  } catch (err) {
    log.warn("Failed to send temp message", err);
  }
}

export function updateSession(
  guildId: string,
  voiceChannelId: string | null,
  textChannelId: string | null,
  token?: string,
) {
  const existing = sessions.get(guildId);
  if (existing) {
    existing.voiceChannelId = voiceChannelId;
    existing.textChannelId = textChannelId;
    if (token) existing.token = token;
    log.debug("Session updated", {
      guildId,
      voiceChannelId,
      textChannelId,
      token: existing.token,
      statusMessageId: existing.statusMessageId,
    });
    return existing;
  }
  const session: Session = {
    guildId,
    voiceChannelId,
    textChannelId,
    statusMessageId: null,
    interval: null,
    token: token ?? crypto.randomUUID(),
  };
  sessions.set(guildId, session);
  log.debug("Session created", {
    guildId,
    voiceChannelId,
    textChannelId,
    token: session.token,
  });
  return session;
}

export function stopSession(guildId: string) {
  const session = sessions.get(guildId);
  if (!session) return;
  if (session.interval) clearInterval(session.interval);
  if (session.textChannelId) void clearStatus(session.textChannelId);
  sessions.delete(guildId);
  updatePlaybackPresence();
  log.debug("Session stopped", {
    guildId,
    voiceChannelId: session.voiceChannelId,
    textChannelId: session.textChannelId,
    statusMessageId: session.statusMessageId,
    token: session.token,
  });
}

export function startStatusLoop(guildId: string, state: GuildMusicState) {
  const session = sessions.get(guildId);
  if (!session || !session.textChannelId) return;
  if (session.interval) clearInterval(session.interval);
  const tick = async () => {
    const payload = await buildStatusPayload(state);
    await updateStatus(session.textChannelId!, payload);
    updatePlaybackPresence();
  };
  session.interval = setInterval(tick, 1000);
  void tick();
}

export async function forceStatusUpdate(guildId: string) {
  const session = sessions.get(guildId);
  if (!session || !session.textChannelId) return;
  const state = musicManager.get(guildId);
  const payload = await buildStatusPayload(state);
  await updateStatus(session.textChannelId, payload);
  updatePlaybackPresence();
}

function createProgressBar(current: number, total: number, size = 15): string {
  if (total === 0) return "🔘" + "▬".repeat(size - 1);
  const progress = Math.min(1, Math.max(0, current / total));
  const bar = Math.floor(progress * size);
  const str = "▬".repeat(bar) + "🔘" + "▬".repeat(Math.max(0, size - bar - 1));
  return str;
}

async function buildStatusPayload(state: GuildMusicState) {
  const current = state.current;
  const elapsed = current ? getPlaybackElapsedMs(state) : 0;
  const dur = current?.durationMs ?? 0;
  const progressStr = current ? `${formatDuration(elapsed)} / ${formatDuration(dur)}` : "N/A";
  const progressBar = current ? createProgressBar(elapsed, dur) : "";
  const queueLen = state.queue.length;
  
  const status = state.player.state.status;
  let statusText = "Idle";
  if (status === AudioPlayerStatus.Playing) statusText = "Playing ▶️";
  if (status === AudioPlayerStatus.Paused) statusText = "Paused ⏸️";
  if (status === AudioPlayerStatus.Buffering) statusText = "Buffering ⏳";

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(current ? current.title : "No track playing")
    .setURL(current?.url || null)
    .setDescription(current ? `${progressBar}\n\`${progressStr}\`` : null)
    .addFields(
      { name: "Status", value: statusText, inline: true },
      { name: "Queue", value: `${queueLen} tracks`, inline: true },
      { name: "Loop", value: state.loop, inline: true },
      { name: "Volume", value: `${Math.round(state.volume * 100)}%`, inline: true }
    );

  if (current?.thumbnail) {
    embed.setThumbnail(current.thumbnail);
  }

  if (state.statsForNerds) {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const stats = statsTracker.getStats();
    const cacheCount = await getCacheStats();
    
    const filters = Object.entries(state.filters)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ") || "None";

    embed.addFields(
      { name: "Detailed Stats", value: "---", inline: false },
      { name: "Memory (RSS)", value: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`, inline: true },
      { name: "Heap Used", value: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true },
      { name: "Uptime", value: `${formatDuration(uptime * 1000)}`, inline: true },
      { name: "Ping (Cur/Peak)", value: `${stats.currentPing}ms / ${stats.peakPing}ms`, inline: true },
      { name: "Load (1m/Peak)", value: `${stats.currentLoad[0].toFixed(2)} / ${stats.peakLoad.toFixed(2)}`, inline: true },
      { name: "Retry Count", value: `${state.retryCount}`, inline: true },
      { name: "Cached Files", value: `${cacheCount}`, inline: true },
      { name: "Filters", value: filters, inline: true },
      { name: "Session Token", value: `\`${state.sessionToken.slice(0, 8)}...\``, inline: true }
    );
  }

  const isPaused = state.player.state.status === AudioPlayerStatus.Paused;
  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('player_pause')
        .setLabel(isPaused ? 'Resume' : 'Pause')
        .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('player_skip')
        .setLabel('Skip')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('player_stop')
        .setLabel('Stop')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('player_loop')
        .setLabel('Loop')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('player_shuffle')
        .setLabel('Shuffle')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [row], content: "" };
}
