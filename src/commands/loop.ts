import { SlashCommandBuilder } from "discord.js";
import { musicManager, LoopMode } from "../music/manager.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const loopCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "track", value: "track" },
          { name: "queue", value: "queue" },
        ),
    )
    .setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const mode = interaction.options.getString("mode", true);
    const state = musicManager.get(interaction.guildId!);
    state.loop = mode as LoopMode;
    await interaction.reply({ content: `Loop set to ${mode}.` });
  },
};
