import { SlashCommandBuilder } from "discord.js";
import { removeFromQueue } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const removeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue.")
    .addIntegerOption((o) => o.setName("index").setDescription("Position in queue").setRequired(true).setMinValue(1))
    .setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const index = interaction.options.getInteger("index", true);
    const ok = removeFromQueue(interaction.guildId!, index);
    await interaction.reply({ content: ok ? "Removed track." : "Invalid index." });
  },
};
