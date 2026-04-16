import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { musicManager } from "../music/manager.js";
import { formatDuration } from "../utils/format.js";
import { SlashCommand } from "./types.js";

export const queueCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the upcoming tracks.")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number").setMinValue(1).setRequired(false),
    )
    .setDMPermission(false),
  async execute(interaction) {
    const page = interaction.options.getInteger("page") ?? 1;
    const guildId = interaction.guildId!;
    const state = musicManager.get(guildId);
    
    const buildEmbed = (p: number) => {
      const queue = state.queue;
      const allTracks = queue.all;
      const currentIndex = queue.index;
      const pageSize = 10;
      const totalPages = Math.ceil(allTracks.length / pageSize) || 1;
      
      // If p is -1 (initial load), find the page with the current track
      let currentPage = p;
      if (p === -1) {
        currentPage = currentIndex >= 0 ? Math.floor(currentIndex / pageSize) + 1 : 1;
      }
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      
      const embed = new EmbedBuilder()
        .setTitle(`Music Queue (${allTracks.length} tracks)`)
        .setColor(0x0099ff);

      const pageStart = (currentPage - 1) * pageSize;
      const pageTracks = allTracks.slice(pageStart, pageStart + pageSize);
      const isPlaying = state.player.state.status !== AudioPlayerStatus.Idle;
      
      if (pageTracks.length > 0) {
        const list = pageTracks.map((t, i) => {
          const absoluteIndex = pageStart + i;
          const isCurrent = isPlaying && absoluteIndex === currentIndex;
          const prefix = isCurrent ? "-> " : `${absoluteIndex + 1}. `;
          const style = isCurrent ? "**" : "";
          const duration = formatDuration(t.durationMs);
          const requester = t.requestedBy ? ` (<@${t.requestedBy}>)` : "";
          
          return `${prefix}${style}[${t.title}](${t.url}) | \`${duration}\`${requester}${style}`;
        }).join("\n");
        
        embed.setDescription(list);
      } else {
        embed.setDescription("Queue is empty.");
      }
      
      const totalDuration = allTracks.reduce((acc, t) => acc + t.durationMs, 0);
      embed.setFooter({ text: `Page ${currentPage}/${totalPages} | Total duration: ${formatDuration(totalDuration)}` });

      return { embed, totalPages, currentPage };
    };

    // Pass -1 to auto-select current page
    const initial = buildEmbed(page === 1 ? -1 : page);
    const components = initial.totalPages > 1 ? [pagerRow(initial.currentPage, initial.totalPages, interaction.id)] : [];
    
    const response = await interaction.reply({
      embeds: [initial.embed],
      components,
      withResponse: true,
    });
    const message = response.resource?.message ?? await interaction.fetchReply();

    if (initial.totalPages > 1) {
      const collector = message.createMessageComponentCollector({
        time: 60_000,
        filter: (btn) => btn.user.id === interaction.user.id && btn.customId.startsWith(`queue-page:${interaction.id}:`),
      });

      collector.on("collect", async (btn) => {
        const [, , target] = btn.customId.split(":");
        const nextPage = Number(target);
        const data = buildEmbed(nextPage);
        await btn.update({
          embeds: [data.embed],
          components: [pagerRow(data.currentPage, data.totalPages, interaction.id)],
        });
      });
      
      collector.on("end", () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  },
};

function pagerRow(page: number, total: number, interactionId: string) {
  const prevId = `queue-page:${interactionId}:${Math.max(1, page - 1)}`;
  const nextId = `queue-page:${interactionId}:${Math.min(total, page + 1)}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(prevId).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(nextId).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= total),
  );
}
