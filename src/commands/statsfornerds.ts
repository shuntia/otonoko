import { SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types.js";
import { musicManager } from "../music/manager.js";
import { forceStatusUpdate } from "../status/sessionManager.js";

export const statsForNerdsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("statsfornerds")
    .setDescription("Toggle detailed statistics display")
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guildId) return;
    
    const musicState = musicManager.get(interaction.guildId);
    musicState.statsForNerds = !musicState.statsForNerds;
    
    await interaction.reply({
      content: `Stats for nerds is now **${musicState.statsForNerds ? "ON" : "OFF"}**.`,
      ephemeral: true
    });
    
    // Force update status to show/hide stats immediately
    await forceStatusUpdate(interaction.guildId);
  },
};
