import { Client, Interaction, REST, Routes, ButtonInteraction, GuildMember } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { env } from "../config/env.js";
import { log } from "../logger.js";
import { SlashCommand } from "./types.js";
import { musicManager, LoopMode } from "../music/manager.js";
import { pause, resume, skip, stop, shuffleQueue } from "../music/controller.js";
import { playCommand } from "./play.js";
import { queueCommand } from "./queue.js";
import { skipCommand } from "./skip.js";
import { pauseCommand } from "./pause.js";
import { resumeCommand } from "./resume.js";
import { stopCommand } from "./stop.js";
import { nowPlayingCommand } from "./nowplaying.js";
import { volumeCommand } from "./volume.js";
import { shuffleCommand } from "./shuffle.js";
import { loopCommand } from "./loop.js";
import { joinCommand } from "./join.js";
import { leaveCommand } from "./leave.js";
import { playlistCommand } from "./playlist.js";
import { moveCommand } from "./move.js";
import { removeCommand } from "./remove.js";
import { helpCommand } from "./help.js";
import { previousCommand } from "./previous.js";
import { nextCommand } from "./next.js";
import { seekCommand } from "./seek.js";
import filterCommand from "./filter.js";
import { debugCommand } from "./debug.js";
import { haltCommand } from "./halt.js";
import { restartCommand } from "./restart.js";
import { cleanCommand } from "./clean.js";
import { statsForNerdsCommand } from "./statsfornerds.js";
import { command as bugCommand } from "./bug.js";

export const commands: SlashCommand[] = [
  playCommand,
  queueCommand,
  skipCommand,
  pauseCommand,
  resumeCommand,
  stopCommand,
  nowPlayingCommand,
  volumeCommand,
  shuffleCommand,
  loopCommand,
  joinCommand,
  leaveCommand,
  playlistCommand,
  moveCommand,
  removeCommand,
  previousCommand,
  nextCommand,
  seekCommand,
  filterCommand,
  debugCommand,
  haltCommand,
  restartCommand,
  cleanCommand,
  helpCommand,
  statsForNerdsCommand,
  bugCommand,
];

export async function registerCommands(client: Client<true> | Client) {
  const readyClient = client instanceof Client && client.isReady() ? client : null;
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const targetGuild = env.GUILD_ID;
  const commandData = commands.map((cmd) => cmd.data.toJSON());
  try {
    if (targetGuild) {
      const route = Routes.applicationGuildCommands(env.CLIENT_ID, targetGuild);
      await rest.put(route, { body: commandData });
      log.info(`Registered ${commandData.length} commands (guild ${targetGuild})`);
    } else {
      const route = Routes.applicationCommands(env.CLIENT_ID);
      await rest.put(route, { body: commandData });
      log.info(`Registered ${commandData.length} global commands`);
    }
    if (readyClient) {
      readyClient.user?.setPresence({ activities: [{ name: "bootstrapping otonoko" }] });
    }
  } catch (err) {
    log.error("Failed to register commands", err);
    throw err;
  }
}

export async function handleInteraction(interaction: Interaction) {
  if (interaction.isAutocomplete()) {
    const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
    if (!command || !command.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      log.warn(`Autocomplete for ${interaction.commandName} failed`, err);
    }
    return;
  }
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
  if (!command) {
    await interaction.reply({ content: "Unknown command." });
    return;
  }
  try {
    log.info("Command invoked", {
      command: interaction.commandName,
      user: interaction.user.id,
      guild: interaction.guildId,
    });
    await command.execute(interaction);
  } catch (err) {
    const errorId = log.error(`Command ${interaction.commandName} failed`, err);
    const content = `Error: ${formatError(err)} (Error ID: ${errorId})`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;
  
  try {
    const state = musicManager.get(guildId);
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const memberChannelId = member?.voice?.channelId ?? null;
    const botChannelId = state.connection?.joinConfig.channelId ?? null;
    if (!memberChannelId) {
      await interaction.reply({ content: "Join a voice channel to use player controls.", ephemeral: true });
      return;
    }
    if (botChannelId && memberChannelId !== botChannelId) {
      await interaction.reply({ content: "You must be in the same voice channel as the bot.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    
    switch (interaction.customId) {
      case 'player_pause':
        if (state.player.state.status === AudioPlayerStatus.Paused) {
          resume(guildId);
        } else {
          pause(guildId);
        }
        break;
      case 'player_skip':
        skip(guildId);
        break;
      case 'player_stop':
        stop(guildId);
        break;
      case 'player_loop': {
        const modes: LoopMode[] = ['off', 'track', 'queue'];
        const currentIdx = modes.indexOf(state.loop);
        const nextIdx = (currentIdx + 1) % modes.length;
        state.loop = modes[nextIdx];
        break;
      }
      case 'player_shuffle':
        shuffleQueue(guildId);
        break;
    }
  } catch (err) {
    const errorId = log.error("Button interaction failed", err);
    const content = `Action failed. Error ID: ${errorId}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  }
}
