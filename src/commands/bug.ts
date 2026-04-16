import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types.js";
import { enableBugMode, log } from "../logger.js";
import { musicManager } from "../music/manager.js";
import { statsTracker } from "../utils/statsTracker.js";
import fs from "fs/promises";
import os from "os";

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("bug")
    .setDescription("Report a bug with context")
    .addStringOption(option => 
      option.setName("message")
        .setDescription("Description of the bug")
        .setRequired(true)
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    const message = interaction.options.getString("message", true);
    const guildId = interaction.guildId;
    
    // Enable debug logging if not already
    enableBugMode();

    let musicState = null;
    if (guildId) {
      const state = musicManager.get(guildId);
      musicState = {
        current: state.current,
        queueLength: state.queue.length,
        queue: state.queue.all.slice(0, 5), // First 5 tracks
        loop: state.loop,
        filters: state.filters,
        volume: state.volume,
        sessionToken: state.sessionToken,
        retryCount: state.retryCount,
        statsForNerds: state.statsForNerds,
        lastTextChannelId: state.lastTextChannelId,
        voiceChannelId: state.connection?.joinConfig.channelId,
        playerStatus: state.player.state.status,
      };
    }

    const report = {
      timestamp: new Date().toISOString(),
      message,
      user: {
        id: interaction.user.id,
        username: interaction.user.username,
      },
      guildId,
      musicState,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        loadAvg: os.loadavg(),
        platform: os.platform(),
        release: os.release(),
        stats: statsTracker.getStats(),
      }
    };

    const logEntry = `\n--- BUG REPORT ---\n${JSON.stringify(report, null, 2)}\n------------------\n`;
    
    try {
      await fs.appendFile("bug.log", logEntry, "utf8");
      log.error("User reported bug", { report }); // Also log to main logger
      
      await interaction.reply({ 
        content: "Bug report submitted. Debug mode enabled. Logs written to `bug.log`.", 
        ephemeral: true 
      });
    } catch (error) {
      log.error("Failed to write bug report", { error });
      await interaction.reply({ 
        content: "Failed to submit bug report, but debug mode is enabled.", 
        ephemeral: true 
      });
    }
  },
};
