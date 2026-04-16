import {
  ActionRowBuilder,
  ComponentType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { SlashCommand } from "./types.js";
import { requireGuildMember, requireSameVoiceChannel, requireVoiceChannel, requireVoicePermissions } from "./helpers.js";
import { resolveTrack, resolveYoutubePlaylist } from "../music/trackResolver.js";
import { ensureConnection, enqueueAndPlay, replaceTrack } from "../music/controller.js";
import { formatDuration } from "../utils/format.js";

export const playCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play audio from a URL or search query.")
    .addStringOption((option) =>
      option.setName("query").setDescription("YouTube URL or search query").setRequired(true),
    )
    .addStringOption((opt) => 
      opt.setName("source")
         .setDescription("Search provider (default: youtube)")
         .addChoices(
           { name: "YouTube", value: "youtube" },
           { name: "Spotify", value: "spotify" },
           { name: "SoundCloud", value: "soundcloud" }
         )
    )
    .setDMPermission(false),
  async execute(interaction) {
    const member = requireGuildMember(interaction);
    const channel = requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const query = interaction.options.getString("query", true);
    const source = interaction.options.getString("source") || "youtube";
    await interaction.deferReply();
    await requireVoicePermissions(interaction, channel);

    if (source === "youtube") {
      const playlist = await resolveYoutubePlaylist(query);
      if (playlist) {
        if (playlist.message && playlist.tracks.length === 0) {
          await interaction.editReply(playlist.message);
          return;
        }
        if (playlist.tracks.length === 0) {
          await interaction.editReply("No playable videos found in playlist.");
          return;
        }

        await ensureConnection(member, channel);
        const state = (await import("../music/manager.js")).musicManager.get(interaction.guildId!);
        state.lastTextChannelId = channel.id;
        const { updateSession } = await import("../status/sessionManager.js");
        updateSession(interaction.guildId!, channel.id, state.lastTextChannelId, state.sessionToken);

        for (const track of playlist.tracks) {
          await enqueueAndPlay(interaction.guildId!, { ...track, requestedBy: interaction.user.id });
        }

        const title = playlist.title ? `**${playlist.title}**` : "playlist";
        const now = state.current
          ? `Now playing: **${state.current.title}** (${formatDuration(state.current.durationMs)})`
          : "Now playing: nothing yet.";
        let content = `Queued ${title} (${playlist.tracks.length} tracks).`;
        if (playlist.skipped > 0) {
          content += ` Skipped ${playlist.skipped} unavailable items.`;
        }
        if (playlist.totalItems && playlist.totalItems !== playlist.tracks.length + playlist.skipped) {
          content += ` Playlist reports ${playlist.totalItems} items.`;
        }
        content += `\n${now}`;
        await interaction.editReply({ content, components: [] });
        return;
      }
    }

    const resolved = await resolveTrack(query, source);
    if (resolved.message) {
      await interaction.editReply(resolved.message);
      return;
    }

    const track = resolved.track;
    if (!track) {
      await interaction.editReply("No track found.");
      return;
    }

    // Assign a unique ID to the track for potential replacement
    track.id = crypto.randomUUID();

    await ensureConnection(member, channel);
    const state = (await import("../music/manager.js")).musicManager.get(interaction.guildId!);
    // Prefer the voice channel itself as the text channel if possible, otherwise fallback to interaction channel
    state.lastTextChannelId = channel.id;
    const { updateSession } = await import("../status/sessionManager.js");
    updateSession(interaction.guildId!, channel.id, state.lastTextChannelId, state.sessionToken);
    
    await enqueueAndPlay(interaction.guildId!, { ...track, requestedBy: interaction.user.id });
    
    const now = state.current
      ? `Now playing: **${state.current.title}** (${formatDuration(state.current.durationMs)})`
      : "Now playing: nothing yet.";
    
    let content = `Queued **${track.title}** (${formatDuration(track.durationMs)})\n${now}`;
    const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

    // If we have alternatives, offer a correction menu
    if (resolved.candidates && resolved.candidates.length > 1) {
      const options = resolved.candidates.slice(0, 5).map((c, idx) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(String(c.title ?? "Unknown").slice(0, 100))
          .setValue(String(idx))
          .setDescription(`Duration: ${formatDuration(c.durationMs)}`)
      );
      
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("correct-track")
          .setPlaceholder("Wrong track? Pick the correct one")
          .addOptions(options),
      );
      components.push(row);
    }

    const message = await interaction.editReply({ content, components });

    if (components.length > 0) {
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id && i.customId === "correct-track",
        time: 60_000, // Give them 1 minute to correct
      });

      collector.on("collect", async (i: StringSelectMenuInteraction) => {
        const choiceIdx = Number(i.values[0]);
        const newTrack = resolved.candidates![choiceIdx];
        if (!newTrack) return;

        // Assign new ID
        newTrack.id = crypto.randomUUID();
        newTrack.requestedBy = interaction.user.id;

        const replaced = await replaceTrack(interaction.guildId!, track.id!, newTrack);
        if (replaced) {
          await i.update({ 
            content: `Corrected to **${newTrack.title}** (${formatDuration(newTrack.durationMs)})`, 
            components: [] 
          });
        } else {
          await i.reply({ content: "Could not replace track (it may have already finished playing).", ephemeral: true });
        }
      });

      collector.on("end", () => {
        // Remove the dropdown after timeout if message is still editable
        interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  },
};
