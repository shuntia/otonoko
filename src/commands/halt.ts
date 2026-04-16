import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { SlashCommand } from "./types.js";
import { log } from "../logger.js";

export const haltCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("halt")
    .setDescription("Shuts down the bot (Admin only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    try {
      await interaction.reply({ content: "Shutting down...", ephemeral: false });
      log.info(`Halt command initiated by ${interaction.user.tag} (${interaction.user.id})`);
      
      // Give it a moment to send the reply
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    } catch (err) {
      log.error("Halt command failed", err);
    }
  },
};
