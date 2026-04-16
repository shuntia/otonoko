import { SlashCommandBuilder } from "discord.js";
import { setVolume } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const volumeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Adjust playback volume.")
    .addIntegerOption((option) =>
      option.setName("percent").setDescription("Volume percent (0-200)").setRequired(true).setMinValue(0).setMaxValue(200),
    )
    .setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const value = interaction.options.getInteger("percent", true);
    setVolume(interaction.guildId!, value);
    await interaction.reply({ content: `Set volume to ${value}%` });
  },
};
