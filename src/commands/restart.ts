import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { SlashCommand } from "./types.js";
import { log } from "../logger.js";

export const restartCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Restarts the bot (Admin only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    try {
      await interaction.reply({ content: "Restarting...", ephemeral: false });
      log.info(`Restart command initiated by ${interaction.user.tag} (${interaction.user.id})`);
      
      // Give it a moment to send the reply
      setTimeout(() => {
        process.exit(1); // Using 1 to indicate a restart might be needed if the runner distinguishes
      }, 1000);
    } catch (err) {
      log.error("Restart command failed", err);
    }
  },
};
