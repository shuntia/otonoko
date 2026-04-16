import { SlashCommandBuilder } from "discord.js";
import { stop } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const stopCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop and clear the queue.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    stop(interaction.guildId!);
    await interaction.reply({ content: "Stopped and cleared queue." });
  },
};
