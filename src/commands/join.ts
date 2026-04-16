import { SlashCommandBuilder } from "discord.js";
import { ensureConnection } from "../music/controller.js";
import { SlashCommand } from "./types.js";
import { requireGuildMember, requireSameVoiceChannel, requireVoiceChannel, requireVoicePermissions } from "./helpers.js";

export const joinCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel.").setDMPermission(false),
  async execute(interaction) {
    const member = requireGuildMember(interaction);
    const channel = requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    await requireVoicePermissions(interaction, channel);
    await ensureConnection(member, channel);
    await interaction.reply({ content: "Joined your voice channel." });
  },
};
