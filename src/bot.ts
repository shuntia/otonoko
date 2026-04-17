import { Client, GatewayIntentBits, Partials } from "discord.js";
import { env } from "./config/env.js";
import { log } from "./logger.js";
import { handleInteraction, registerCommands } from "./commands/index.js";
import { initSchema } from "./db/playlistStore.js";
import { initCacheSchema } from "./db/cacheStore.js";
import { initQueueSchema } from "./db/queueStore.js";
import { initGuildSettingsSchema } from "./db/guildSettingsStore.js";
import { startCachePruner } from "./db/cachePruner.js";
import { setupVoiceWatchers } from "./voice/watchers.js";
import { handleChatActivity, handleMessageDelete, handleMessageUpdate } from "./status/statusManager.js";
import { attachStatusClient } from "./status/sessionManager.js";
import { musicManager } from "./music/manager.js";
import { statsTracker } from "./utils/statsTracker.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

client.once("clientReady", async () => {
  log.info(`Ready as ${client.user?.tag ?? "unknown"}`);
  await initSchema();
  await initCacheSchema();
  await initQueueSchema();
  await initGuildSettingsSchema();
  startCachePruner();
  attachStatusClient(client);
  await registerCommands(client);
  setupVoiceWatchers(client);
  statsTracker.start(client);
  await musicManager.restoreGuildVolumes();
  await musicManager.restore(client);
});

client.on("interactionCreate", async (interaction) => {
  await handleInteraction(interaction);
});

client.on("messageCreate", async (msg) => {
  await handleChatActivity(msg);
});

client.on("messageDelete", (msg) => {
  handleMessageDelete(msg);
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  handleMessageUpdate(oldMsg, newMsg);
});

client.on("error", (err) => {
  log.error("Client error", err);
});

client.on("warn", (msg) => log.warn("Client warn", msg));
client.on("debug", (msg) => log.debug("Client debug", msg));

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason);
});
process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", err);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void client.login(env.DISCORD_TOKEN);

async function shutdown(signal: string) {
  log.info(`Shutting down on ${signal}`);
  try {
    client.destroy();
  } finally {
    process.exit(0);
  }
}
