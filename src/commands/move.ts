import { SlashCommandBuilder } from "discord.js";
import { moveInQueue } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const moveCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track in the queue.")
    .addIntegerOption((o) => o.setName("from").setDescription("Current position").setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName("to").setDescription("New position").setRequired(true).setMinValue(1))
    .setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    const ok = moveInQueue(interaction.guildId!, from, to);
    await interaction.reply({ content: ok ? "Moved track." : "Invalid positions." });
  },
};
