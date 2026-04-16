import { Client, VoiceState } from "discord.js";
import { musicManager } from "../music/manager.js";
import { log } from "../logger.js";
import { stopSession } from "../status/sessionManager.js";

function hasNonBotMembers(state: VoiceState, channelId?: string): boolean {
  const channel = channelId ? state.guild.channels.cache.get(channelId) : state.channel;
  if (!channel || !channel.isVoiceBased()) return false;
  return channel.members.some((m) => !m.user.bot);
}

export function setupVoiceWatchers(client: Client) {
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      const guildId = newState.guild.id;
      const state = musicManager.get(guildId);

      // Auto-disconnect when the bot's channel empties (no non-bot members).
      const botChannelId = state.connection?.joinConfig.channelId;
      if (botChannelId && oldState.channelId === botChannelId && !hasNonBotMembers(oldState, botChannelId)) {
        log.info("Disconnecting due to empty channel", { guildId, channelId: botChannelId });
        musicManager.disconnect(guildId);
        stopSession(guildId);
        return;
      }

    } catch (err) {
      log.warn("voiceStateUpdate handler failed", err);
    }
  });
}
