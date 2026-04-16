import { SlashCommandBuilder } from "discord.js";
import { resume } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const resumeCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume playback.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const ok = resume(interaction.guildId!);
    await interaction.reply({ content: ok ? "Resumed." : "Nothing paused." });
  },
};
