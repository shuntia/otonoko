import { SlashCommandBuilder } from "discord.js";
import { skip } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const nextCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("next").setDescription("Skip to next track.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const ok = skip(interaction.guildId!);
    await interaction.reply({ content: ok ? "Skipped to next." : "Nothing to skip." });
  },
};
