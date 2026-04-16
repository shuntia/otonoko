import { SlashCommandBuilder } from "discord.js";
import { musicManager } from "../music/manager.js";
import { formatDuration } from "../utils/format.js";
import { SlashCommand } from "./types.js";

export const nowPlayingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the current track.")
    .setDMPermission(false),
  async execute(interaction) {
    const state = musicManager.get(interaction.guildId!);
    if (!state.current) {
      await interaction.reply({ content: "Nothing playing." });
      return;
    }
    await interaction.reply({
      content: `Now playing: **${state.current.title}** (${formatDuration(state.current.durationMs)})`,
    });
  },
};
