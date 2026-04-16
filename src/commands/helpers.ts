import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, VoiceBasedChannel } from "discord.js";
import { musicManager } from "../music/manager.js";

export function requireGuildMember(interaction: ChatInputCommandInteraction): GuildMember {
  const member = interaction.member;
  if (!member || !(member instanceof Object) || !(member as GuildMember).voice) {
    throw new Error("This command must be used in a guild.");
  }
  return member as GuildMember;
}

export function requireVoiceChannel(interaction: ChatInputCommandInteraction): VoiceBasedChannel {
  const member = requireGuildMember(interaction);
  const channel = member.voice.channel;
  if (!channel) {
    throw new Error("You must be in a voice channel.");
  }
  return channel;
}

export function requireSameVoiceChannel(interaction: ChatInputCommandInteraction) {
  const member = requireGuildMember(interaction);
  const state = musicManager.get(interaction.guildId!);
  const botChannelId = state.connection?.joinConfig.channelId;
  if (botChannelId && member.voice.channelId !== botChannelId) {
    throw new Error("You must be in the same voice channel as the bot.");
  }
}

export async function requireVoicePermissions(
  interaction: ChatInputCommandInteraction,
  channel: VoiceBasedChannel,
) {
  const guild = interaction.guild;
  if (!guild) return;
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return;

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect)) {
    throw new Error("I don't have permission to connect to that voice channel.");
  }
  if (!perms?.has(PermissionFlagsBits.Speak)) {
    throw new Error("I don't have permission to speak in that voice channel.");
  }
}
