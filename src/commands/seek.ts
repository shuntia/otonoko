import { SlashCommandBuilder } from "discord.js";
import { seek } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";

export const seekCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a specific timestamp in the current track.")
    .addStringOption((option) =>
      option
        .setName("timestamp")
        .setDescription("Timestamp (e.g. 1:30, 90s)")
        .setRequired(true),
    )
    .setDMPermission(false),
  async execute(interaction) {
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    
    const timestamp = interaction.options.getString("timestamp", true);
    const seconds = parseTime(timestamp);
    
    if (seconds === null) {
      await interaction.reply({ content: "Invalid timestamp format. Use MM:SS or seconds." });
      return;
    }

    await interaction.deferReply();
    const success = await seek(interaction.guildId!, seconds);
    
    if (success) {
      await interaction.editReply({ content: `Seeked to **${timestamp}**.` });
    } else {
      await interaction.editReply({ content: "Failed to seek (no track playing or seek not supported)." });
    }
  },
};

function parseTime(input: string): number | null {
  if (/^\d+$/.test(input)) return parseInt(input, 10);
  const parts = input.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
