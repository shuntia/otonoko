import { SlashCommandBuilder } from "discord.js";
import { shuffleQueue } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const shuffleCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the upcoming queue.").setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    shuffleQueue(interaction.guildId!);
    await interaction.reply({ content: "Shuffled upcoming queue." });
  },
};
