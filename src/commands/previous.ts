import { SlashCommandBuilder } from "discord.js";
import { previousTrack } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const previousCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("previous").setDescription("Play previous track.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const ok = previousTrack(interaction.guildId!);
    await interaction.reply({ content: ok ? "Playing previous track." : "No previous track." });
  },
};
