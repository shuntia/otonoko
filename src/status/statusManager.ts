import { ChannelType, Client, Message, MessagePayload, MessageCreateOptions, MessageEditOptions, PartialMessage } from "discord.js";
import { log } from "../logger.js";

interface StatusEntry {
  channelId: string;
  messageId: string;
}

let clientRef: Client | null = null;
const statusByChannel = new Map<string, StatusEntry>();
const pendingUpdates = new Map<string, string | MessagePayload | MessageCreateOptions | MessageEditOptions>();
const isUpdating = new Set<string>();

export function setStatusClient(client: Client) {
  clientRef = client;
}

export function getClient(): Client | null {
  return clientRef;
}

export async function updateStatus(channelId: string, payload: string | MessagePayload | MessageCreateOptions | MessageEditOptions) {
  if (!clientRef) return;
  
  pendingUpdates.set(channelId, payload);
  void processUpdateQueue(channelId);
}

async function processUpdateQueue(channelId: string) {
  if (isUpdating.has(channelId)) return;
  
  const payload = pendingUpdates.get(channelId);
  if (!payload) return;
  
  // Clear pending so we can detect if new ones come in
  pendingUpdates.delete(channelId);
  isUpdating.add(channelId);
  
  try {
    const channel = await clientRef!.channels.fetch(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement && channel.type !== ChannelType.GuildVoice)) return;
    
    const existing = statusByChannel.get(channelId);
    let targetMessageId = existing?.messageId;

    if (!targetMessageId && "messages" in channel) {
      const fetched = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      if (fetched && fetched.size > 0) {
        const sorted = fetched.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        const latest = sorted.first();
        
        if (latest && latest.author.id === clientRef!.user?.id && latest.components.length > 0) {
          targetMessageId = latest.id;
        } else {
          // If the latest message isn't ours (or isn't a status message), delete any old status messages found
          const oldStatus = sorted.find(m => m.author.id === clientRef!.user?.id && m.components.length > 0);
          if (oldStatus) {
            await oldStatus.delete().catch(() => {});
          }
        }
      }
    }

    if (targetMessageId && "messages" in channel) {
      try {
        const msg = await channel.messages.fetch(targetMessageId);
        
        // Check if it's the last message by fetching the latest message
        const latestMessages = await channel.messages.fetch({ limit: 1 });
        const lastMsg = latestMessages.first();

        if (lastMsg && lastMsg.id !== msg.id) {
           // Not the last message, delete and resend
           await msg.delete();
           statusByChannel.delete(channelId);
           // Fall through to send new
        } else {
           await msg.edit(payload as MessagePayload | MessageEditOptions | string);
           statusByChannel.set(channelId, { channelId, messageId: msg.id });
           return;
        }
      } catch {
        // fall through to send a new one
      }
    }
    
    if (!channel.isTextBased() || channel.isDMBased()) return;
    const message = await channel.send(payload as MessagePayload | MessageCreateOptions | string);
    statusByChannel.set(channelId, { channelId, messageId: message.id });
  } catch (err) {
    log.warn("updateStatus failed", err);
  } finally {
    isUpdating.delete(channelId);
    // If a new update came in while we were working, process it now
    if (pendingUpdates.has(channelId)) {
      void processUpdateQueue(channelId);
    }
  }
}

export async function clearStatus(channelId: string) {
  if (!clientRef) return;
  const existing = statusByChannel.get(channelId);
  if (!existing) return;
  try {
    const channel = await clientRef.channels.fetch(channelId);
    if (
      channel &&
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement || channel.type === ChannelType.GuildVoice) &&
      "messages" in channel
    ) {
      await channel.messages.delete(existing.messageId).catch(() => undefined);
    }
  } catch {
    // ignore
  } finally {
    statusByChannel.delete(channelId);
  }
}

export async function handleChatActivity(_message: Message) {
  return;
}

export function handleMessageDelete(message: Message | PartialMessage) {
  const entry = statusByChannel.get(message.channelId);
  if (entry && entry.messageId === message.id) {
    statusByChannel.delete(message.channelId);
  }
}

export function handleMessageUpdate(oldMsg: Message | PartialMessage, newMsg: Message | PartialMessage) {
  const entry = statusByChannel.get(newMsg.channelId);
  if (entry && entry.messageId === newMsg.id) {
    // If embeds were removed (e.g. by user), delete the message so it gets recreated
    if (newMsg.embeds.length === 0) {
      statusByChannel.delete(newMsg.channelId);
      newMsg.delete().catch(() => {});
    }
  }
}
