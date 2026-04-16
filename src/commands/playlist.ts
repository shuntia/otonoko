import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ComponentType,
  Message,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  addItem,
  clearPlaylist,
  clonePlaylist,
  createPlaylist,
  fusePlaylists,
  getPlaylistByName,
  listItems,
  listPlaylists,
  moveItemToPlaylist,
  Playlist,
  removeItem,
  removePlaylist,
  renamePlaylist,
  searchPlaylists,
} from "../db/playlistStore.js";
import { ensureConnection, enqueueAndPlay } from "../music/controller.js";
import { resolveTrack } from "../music/trackResolver.js";
import { SlashCommand } from "./types.js";
import { requireGuildMember, requireSameVoiceChannel, requireVoiceChannel, requireVoicePermissions } from "./helpers.js";

export const playlistCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Manage playlists.")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new empty playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Bind to User or Guild")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clone")
        .setDescription("Clone an existing playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Source playlist name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("new_name").setDescription("New playlist name").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Source scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        )
        .addStringOption((o) =>
          o
            .setName("target_scope")
            .setDescription("Target scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a track to a playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("query").setDescription("URL or search query").setRequired(true))
        .addBooleanOption((o) => o.setName("dedupe").setDescription("Skip if URL already exists").setRequired(false))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("play")
        .setDescription("Enqueue a playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("queue")
        .setDescription("Alias of play.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("query")
        .setDescription("List items in a playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List playlists.")
        .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a playlist or an item.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("index").setDescription("Item index (optional)"))
        .addStringOption((o) => o.setName("query").setDescription("Search query to find item to remove"))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("rename")
        .setDescription("Rename a playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Current name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("new_name").setDescription("New name").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear all items from a playlist.")
        .addStringOption((o) => o.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Playlist scope")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("moveitem")
        .setDescription("Move an item from one playlist to another.")
        .addStringOption((o) => o.setName("source").setDescription("Source playlist").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("target").setDescription("Target playlist").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("index").setDescription("Item index in source").setRequired(true).setMinValue(1))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Scope for both (or source)")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("fuse")
        .setDescription("Merge all items from source into target.")
        .addStringOption((o) => o.setName("source").setDescription("Source playlist").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("target").setDescription("Target playlist").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("dedupe").setDescription("Skip duplicate URLs").setRequired(false))
        .addStringOption((o) =>
          o
            .setName("scope")
            .setDescription("Scope for both")
            .addChoices({ name: "User", value: "user" }, { name: "Guild", value: "guild" }),
        ),
    )
    .setDMPermission(false),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "create") {
      await handleCreate(interaction);
      return;
    }
    if (sub === "clone") {
      await handleClone(interaction);
      return;
    }
    if (sub === "add") {
      await handleAdd(interaction);
      return;
    }
    if (sub === "play" || sub === "queue") {
      await handlePlay(interaction);
      return;
    }
    if (sub === "query") {
      await handleQuery(interaction);
      return;
    }
    if (sub === "list") {
      await handleList(interaction);
      return;
    }
    if (sub === "remove") {
      await handleRemove(interaction);
      return;
    }
    if (sub === "rename") {
      await handleRename(interaction);
      return;
    }
    if (sub === "clear") {
      await handleClear(interaction);
      return;
    }
    if (sub === "moveitem") {
      await handleMoveItem(interaction);
      return;
    }
    if (sub === "fuse") {
      await handleFuse(interaction);
      return;
    }
    await interaction.reply({ content: "Unknown subcommand." });
  },
  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "name" && focused.name !== "source" && focused.name !== "target") return;
    
    const scope = interaction.options.getString("scope");
    
    let results: Playlist[] = [];
    
    if (scope === "guild" && interaction.guildId) {
      results = await searchPlaylists(focused.value, interaction.guildId);
    } else if (scope === "user") {
      results = await searchPlaylists(focused.value, interaction.user.id);
    } else {
      if (interaction.guildId) {
        const guildResults = await searchPlaylists(focused.value, interaction.guildId);
        results.push(...guildResults);
      }
      const userResults = await searchPlaylists(focused.value, interaction.user.id);
      results.push(...userResults);
    }
    
    const options = results.slice(0, 25).map((p) => ({
      name: `${p.name} (${p.ownerId === interaction.guildId ? "Guild" : "User"})`,
      value: p.name
    }));
    
    await interaction.respond(options);
  },
};

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getOwnerId(interaction: ChatInputCommandInteraction, scope?: string | null): string | null {
  if (scope === "guild") {
    if (!interaction.guildId) throw new Error("Guild scope requires being in a guild.");
    return interaction.guildId;
  }
  if (scope === "user") {
    return interaction.user.id;
  }
  return null;
}

async function findPlaylist(name: string, interaction: ChatInputCommandInteraction, scope?: string | null) {
  const ownerId = getOwnerId(interaction, scope);
  if (ownerId) {
    return getPlaylistByName(name, ownerId);
  }
  
  if (interaction.guildId) {
    const guildPlaylist = await getPlaylistByName(name, interaction.guildId);
    if (guildPlaylist) return guildPlaylist;
  }
  
  return getPlaylistByName(name, interaction.user.id);
}

async function handleCreate(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  if (name.length > 100) return interaction.reply({ content: "Playlist name too long (max 100 chars)." });
  if (name.trim().length === 0) return interaction.reply({ content: "Playlist name cannot be empty." });
  const scope = interaction.options.getString("scope");
  try {
    const ownerId = getOwnerId(interaction, scope) ?? interaction.user.id;
    const existing = await getPlaylistByName(name, ownerId);
    if (existing) {
      return interaction.reply({ content: `Playlist **${name}** already exists.` });
    }
    await createPlaylist(name, ownerId);
    await interaction.reply({ content: `Created playlist **${name}** (${ownerId === interaction.guildId ? "Guild" : "User"}).` });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleClone(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const newName = interaction.options.getString("new_name", true);
  if (newName.length > 100) return interaction.reply({ content: "New playlist name too long (max 100 chars)." });
  if (newName.trim().length === 0) return interaction.reply({ content: "New playlist name cannot be empty." });
  const scope = interaction.options.getString("scope");
  const targetScope = interaction.options.getString("target_scope");
  
  try {
    const source = await findPlaylist(name, interaction, scope);
    if (!source) {
      return interaction.reply({ content: "Source playlist not found." });
    }
    
    const targetOwnerId = getOwnerId(interaction, targetScope) ?? interaction.user.id;
    const existing = await getPlaylistByName(newName, targetOwnerId);
    if (existing) {
      return interaction.reply({ content: `Target playlist **${newName}** already exists.` });
    }
    
    const cloned = await clonePlaylist(source.id, newName, targetOwnerId);
    const items = await listItems(cloned.id);
    await interaction.reply({ content: `Cloned **${name}** to **${newName}** with ${items.length} items.` });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleAdd(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const query = interaction.options.getString("query", true);
  const dedupe = interaction.options.getBoolean("dedupe") ?? true;
  const scope = interaction.options.getString("scope");
  await interaction.deferReply();
  try {
    let playlist = await findPlaylist(name, interaction, scope);
    if (!playlist) {
        // If not found, create new. Default to User if scope unspecified.
        const ownerId = getOwnerId(interaction, scope) ?? interaction.user.id;
        playlist = await createPlaylist(name, ownerId);
    }
    const resolved = await resolveTrack(query);
    if (resolved.message) return interaction.editReply(resolved.message);
    const track = await pickTrack(interaction, resolved);
    if (!track) return interaction.editReply("No track found.");
    
    await addItem(playlist.id, {
      title: track.title,
      url: track.url,
      durationSec: Math.floor(track.durationMs / 1000),
      addedBy: interaction.user.id,
      dedupeUrl: dedupe,
    });
    await interaction.editReply(`Added **${track.title}** to playlist **${name}**.`);
  } catch (err) {
    await interaction.editReply({ content: formatError(err) });
  }
}

async function handlePlay(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const scope = interaction.options.getString("scope");
  const member = requireGuildMember(interaction);
  const channel = requireVoiceChannel(interaction);
  requireSameVoiceChannel(interaction);
  await requireVoicePermissions(interaction, channel);
  
  try {
    const playlist = await findPlaylist(name, interaction, scope);
    if (!playlist) {
      return interaction.reply({ content: "Playlist not found." });
    }
    const items = await listItems(playlist.id);
    if (items.length === 0) {
      return interaction.reply({ content: "Playlist is empty." });
    }
    await interaction.deferReply();
    await ensureConnection(member, channel);
    items.forEach((item) => {
      void enqueueAndPlay(interaction.guildId!, {
        title: item.title,
        url: item.url,
        durationMs: item.durationSec * 1000,
        requestedBy: interaction.user.id,
      });
    });
    await interaction.editReply(`Queued playlist **${name}** (${items.length} tracks).`);
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const page = interaction.options.getInteger("page") ?? 1;
  const scope = interaction.options.getString("scope");
  try {
    const ownerId = getOwnerId(interaction, scope);
    
    if (ownerId) {
      const playlists = await listPlaylists(ownerId, (page - 1) * 10, 10);
      if (playlists.length === 0) return interaction.reply({ content: "No playlists." });
      const lines = playlists.map((p) => `• ${p.name}`);
      await interaction.reply({ content: lines.join("\n") });
    } else {
      let content = "";
      if (interaction.guildId) {
        const guildPlaylists = await listPlaylists(interaction.guildId, 0, 10);
        if (guildPlaylists.length > 0) {
          content += "**Guild Playlists**\n" + guildPlaylists.map(p => `• ${p.name}`).join("\n") + "\n\n";
        }
      }
      const userPlaylists = await listPlaylists(interaction.user.id, 0, 10);
      if (userPlaylists.length > 0) {
        content += "**User Playlists**\n" + userPlaylists.map(p => `• ${p.name}`).join("\n");
      }
      if (!content) content = "No playlists found.";
      await interaction.reply({ content });
    }
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleQuery(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const page = interaction.options.getInteger("page") ?? 1;
  const scope = interaction.options.getString("scope");
  try {
    const playlist = await findPlaylist(name, interaction, scope);
    if (!playlist) return interaction.reply({ content: "Playlist not found." });
    
    const items = await listItems(playlist.id);
    if (items.length === 0) return interaction.reply({ content: `Playlist **${name}** is empty.` });
    
    const pageSize = 10;
    const totalPages = Math.ceil(items.length / pageSize);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const start = (currentPage - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    
    const lines = pageItems.map((item, i) => `${start + i + 1}. [${item.title}](${item.url}) (${item.durationSec}s)`);
    
    await interaction.reply({
      content: `**Playlist: ${name}** (${playlist.ownerId === interaction.guildId ? "Guild" : "User"}) (Page ${currentPage}/${totalPages})\n${lines.join("\n")}`,
      flags: 4096
    });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const index = interaction.options.getInteger("index");
  const query = interaction.options.getString("query");
  const scope = interaction.options.getString("scope");
  try {
    const playlist = await findPlaylist(name, interaction, scope);
    if (!playlist) return interaction.reply({ content: "Playlist not found." });
    
    if (index) {
      const ok = await removeItem(playlist.id, index);
      return interaction.reply({ content: ok ? "Removed item." : "Invalid item index." });
    }

    if (query) {
      const items = await listItems(playlist.id);
      const matches = items.map((item, idx) => ({ item, idx: idx + 1 })).filter(({ item }) => item.title.toLowerCase().includes(query.toLowerCase()));
      
      if (matches.length === 0) {
        return interaction.reply({ content: "No items found matching that query." });
      }
      
      if (matches.length === 1) {
        const match = matches[0];
        await removeItem(playlist.id, match.idx);
        return interaction.reply({ content: `Removed **${match.item.title}** (position ${match.idx}).` });
      }

      // Multiple matches, ask user to pick
      const options = matches.slice(0, 25).map((m) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(m.item.title.slice(0, 100))
          .setValue(String(m.idx))
          .setDescription(`Position: ${m.idx} | Duration: ${m.item.durationSec}s`),
      );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId("playlist-remove-pick").setPlaceholder("Select item to remove").addOptions(options),
      );

      await interaction.reply({ content: `Found ${matches.length} matches. Select one to remove:`, components: [row] });
      const reply = await interaction.fetchReply();

      try {
        const selection = await (reply as Message).awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          filter: (i: StringSelectMenuInteraction) => i.user.id === interaction.user.id && i.customId === "playlist-remove-pick",
          time: 30_000,
        });

        if (!selection) return;
        const choiceIdx = Number(selection.values[0]);
        const chosen = matches.find(m => m.idx === choiceIdx);
        
        if (chosen) {
          // Note: removeItem shifts indices, but since we are only removing one, the index is valid at this moment.
          // However, if multiple people are editing, this could be racey. But for a personal bot/small scale, it's fine.
          // Also, we need to be careful if the user selects something that was already removed? 
          // removeItem checks existence.
          
          const ok = await removeItem(playlist.id, choiceIdx);
          await selection.update({ content: ok ? `Removed **${chosen.item.title}**.` : "Failed to remove item (maybe already removed?).", components: [] });
        } else {
          await selection.update({ content: "Invalid selection.", components: [] });
        }
      } catch {
        await interaction.editReply({ content: "Timed out waiting for selection.", components: [] });
      }
      return;
    }

    const ok = await removePlaylist(name, playlist.ownerId);
    await interaction.reply({ content: ok ? "Removed playlist." : "Failed to remove playlist." });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleRename(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const newName = interaction.options.getString("new_name", true);
  if (newName.length > 100) return interaction.reply({ content: "New playlist name too long (max 100 chars)." });
  if (newName.trim().length === 0) return interaction.reply({ content: "New playlist name cannot be empty." });
  const scope = interaction.options.getString("scope");
  try {
    const playlist = await findPlaylist(name, interaction, scope);
    if (!playlist) return interaction.reply({ content: "Playlist not found." });
    
    const ok = await renamePlaylist(name, newName, playlist.ownerId);
    await interaction.reply({ content: ok ? "Renamed playlist." : "Playlist not found." });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleClear(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString("name", true);
  const scope = interaction.options.getString("scope");
  try {
    const playlist = await findPlaylist(name, interaction, scope);
    if (!playlist) return interaction.reply({ content: "Playlist not found." });
    await clearPlaylist(playlist.id);
    await interaction.reply({ content: "Cleared playlist." });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleMoveItem(interaction: ChatInputCommandInteraction) {
  const sourceName = interaction.options.getString("source", true);
  const targetName = interaction.options.getString("target", true);
  const index = interaction.options.getInteger("index", true);
  const scope = interaction.options.getString("scope");
  try {
    const source = await findPlaylist(sourceName, interaction, scope);
    if (!source) return interaction.reply({ content: "Source playlist not found." });
    
    let target = await findPlaylist(targetName, interaction, scope);
    if (!target) {
        // Create target if not found. Default to User.
        const ownerId = getOwnerId(interaction, scope) ?? interaction.user.id;
        target = await createPlaylist(targetName, ownerId);
    }
    
    const ok = await moveItemToPlaylist(source.id, target.id, index);
    await interaction.reply({ content: ok ? "Moved item." : "Invalid index." });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function handleFuse(interaction: ChatInputCommandInteraction) {
  const sourceName = interaction.options.getString("source", true);
  const targetName = interaction.options.getString("target", true);
  const dedupe = interaction.options.getBoolean("dedupe") ?? true;
  const scope = interaction.options.getString("scope");
  try {
    const source = await findPlaylist(sourceName, interaction, scope);
    if (!source) return interaction.reply({ content: "Source playlist not found." });
    
    let target = await findPlaylist(targetName, interaction, scope);
    if (!target) {
        const ownerId = getOwnerId(interaction, scope) ?? interaction.user.id;
        target = await createPlaylist(targetName, ownerId);
    }
    
    const added = await fusePlaylists(source.id, target.id, dedupe);
    await interaction.reply({ content: `Merged ${added} items into ${targetName}.` });
  } catch (err) {
    await interaction.reply({ content: formatError(err) });
  }
}

async function pickTrack(interaction: ChatInputCommandInteraction, resolved: Awaited<ReturnType<typeof resolveTrack>>) {
  if (!resolved.needsConfirmation && resolved.track) return resolved.track;
  const candidates = resolved.candidates ?? [];
  if (candidates.length === 0) return null;
  const options = candidates.slice(0, 5).map((c, idx) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(c.title.slice(0, 100))
      .setValue(String(idx))
      .setDescription(`Duration: ${Math.floor(c.durationMs / 1000)}s`),
  );
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("playlist-pick").setPlaceholder("Choose a track").addOptions(options),
  );
  await interaction.editReply({ content: "Pick the correct track:", components: [row] });
  const reply = await interaction.fetchReply();
  try {
  const selection = await (reply as Message).awaitMessageComponent({
    componentType: ComponentType.StringSelect,
    filter: (i: StringSelectMenuInteraction) => i.user.id === interaction.user.id && i.customId === "playlist-pick",
    time: 30_000,
  });
    if (!selection) return null;
    const choice = Number(selection.values[0]);
    const chosen = candidates[choice];
    await selection.update({ content: `Selected **${chosen.title}**`, components: [] });
    return chosen;
  } catch {
    await interaction.editReply({ content: "Timed out waiting for selection.", components: [] });
    return null;
  }
}
