import { SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types.js";

const helpText = [
  "**/play <url|query>** — queue a track or YouTube playlist (confirms search).",
  "**/skip**, **/next**, **/previous**, **/pause**, **/resume**, **/stop** — control playback.",
  "**/queue**, **/shuffle**, **/move**, **/remove**, **/loop**, **/volume** — manage queue.",
  "**/playlist add|play|queue|list|remove|rename|clear|moveitem|fuse** — manage playlists.",
  "**/join**, **/leave** — control voice connection.",
  "**/nowplaying** — show current track.",
].join("\n");

export const helpCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show help for otonoko.").setDMPermission(false),
  async execute(interaction) {
    await interaction.reply({ content: helpText });
  },
};
