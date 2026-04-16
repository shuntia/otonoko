import { SlashCommandBuilder } from "discord.js";
import { pause } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const pauseCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause playback.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const ok = pause(interaction.guildId!);
    await interaction.reply({ content: ok ? "Paused." : "Nothing playing." });
  },
};
