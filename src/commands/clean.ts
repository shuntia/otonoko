import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import { SlashCommand } from "./types.js";

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const cleanCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Delete the bot's messages in the channel.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Number of messages to check (max 100)").setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount") ?? 100;
    const channel = interaction.channel;

    if (!channel || channel.type === ChannelType.DM) {
      return interaction.reply({ content: "Cannot clean DMs.", ephemeral: true });
    }

    if (!("bulkDelete" in channel) || !("messages" in channel)) {
      return interaction.reply({ content: "Cannot delete messages in this channel type.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const messages = await channel.messages.fetch({ limit: amount });
      const botMessages = messages.filter((m) => m.author.id === interaction.client.user.id);
      
      if (botMessages.size === 0) {
          await interaction.editReply({ content: "No bot messages found to delete." });
          return;
      }
      
      const deleted = await channel.bulkDelete(botMessages, true);
      await interaction.editReply({ content: `Deleted ${deleted.size} bot messages.` });
    } catch (err) {
      await interaction.editReply({ content: `Failed to delete messages: ${formatError(err)}` });
    }
  },
};
