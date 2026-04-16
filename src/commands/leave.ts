import { SlashCommandBuilder } from "discord.js";
import { musicManager } from "../music/manager.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const leaveCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    musicManager.disconnect(interaction.guildId!);
    await interaction.reply({ content: "Disconnected." });
  },
};
