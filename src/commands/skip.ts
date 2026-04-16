import { SlashCommandBuilder } from "discord.js";
import { skip } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const skipCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const ok = skip(interaction.guildId!);
    await interaction.reply({ content: ok ? "Skipped." : "Nothing to skip." });
  },
};
