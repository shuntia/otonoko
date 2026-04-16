import { SlashCommandBuilder, EmbedBuilder, version as djsVersion } from "discord.js";
import { SlashCommand } from "./types.js";
import { musicManager } from "../music/manager.js";
import { formatDuration } from "../utils/format.js";

export const debugCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("debug")
    .setDescription("Show debug information for the current session.")
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }

    const state = musicManager.get(interaction.guildId);
    const mem = process.memoryUsage();
    
    const embed = new EmbedBuilder()
      .setTitle("Otonoko Debug Info")
      .setColor(0xff0000)
      .setTimestamp()
      .addFields(
        { name: "System", value: `Node: ${process.version}\nDiscord.js: ${djsVersion}\nUptime: ${formatDuration(process.uptime() * 1000)}`, inline: true },
        { name: "Memory", value: `RSS: ${(mem.rss / 1024 / 1024).toFixed(2)}MB\nHeap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB`, inline: true },
        { name: "Session", value: `Guild: ${interaction.guildId}\nVoice Channel: ${state.connection?.joinConfig.channelId ?? "None"}\nText Channel: ${state.lastTextChannelId ?? "None"}`, inline: false },
        { name: "Player", value: `Status: ${state.player.state.status}\nVolume: ${Math.round(state.volume * 100)}%`, inline: true },
        { name: "Queue", value: `Length: ${state.queue.length}\nIndex: ${state.queue.index}\nLoop: ${state.loop}`, inline: true },
      );

    if (state.current) {
      const elapsed = state.currentStartedAt ? Date.now() - state.currentStartedAt : 0;
      embed.addFields({ 
        name: "Current Track", 
        value: `Title: ${state.current.title}\nURL: ${state.current.url}\nPosition: ${formatDuration(elapsed)} / ${formatDuration(state.current.durationMs)}`,
        inline: false 
      });
    }

    if (state.connection) {
      embed.addFields({
        name: "Voice Connection",
        value: `State: ${state.connection.state.status}\nPing: ${state.connection.ping.udp ?? "N/A"}ms`,
        inline: true
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
