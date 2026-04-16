import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types.js";
import { requireGuildMember, requireSameVoiceChannel, requireVoiceChannel } from "./helpers.js";
import { setFilters } from "../music/controller.js";
import { musicManager } from "../music/manager.js";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Apply audio filters")
    .addBooleanOption((opt) => opt.setName("bassboost").setDescription("Toggle Bass Boost"))
    .addBooleanOption((opt) => opt.setName("nightcore").setDescription("Toggle Nightcore"))
    .addBooleanOption((opt) => opt.setName("vaporwave").setDescription("Toggle Vaporwave"))
    .addBooleanOption((opt) => opt.setName("8d").setDescription("Toggle 8D Audio"))
    .addBooleanOption((opt) => opt.setName("lofi").setDescription("Toggle Lofi (Low fidelity)"))
    .addBooleanOption((opt) => opt.setName("lowpass").setDescription("Toggle Lowpass (Muffled)"))
    .addBooleanOption((opt) => opt.setName("clear").setDescription("Clear all filters")),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = requireGuildMember(interaction);
    requireVoiceChannel(interaction);
    requireSameVoiceChannel(interaction);
    const guildId = member.guild.id;
    
    const clear = interaction.options.getBoolean("clear");
    if (clear) {
      await setFilters(guildId, { 
        bassBoost: false, 
        nightcore: false, 
        vaporwave: false, 
        _8d: false,
        lofi: false,
        lowpass: false
      });
      return interaction.reply("Cleared all filters.");
    }

    const bassBoost = interaction.options.getBoolean("bassboost");
    const nightcore = interaction.options.getBoolean("nightcore");
    const vaporwave = interaction.options.getBoolean("vaporwave");
    const _8d = interaction.options.getBoolean("8d");
    const lofi = interaction.options.getBoolean("lofi");
    const lowpass = interaction.options.getBoolean("lowpass");

    const state = musicManager.get(guildId);
    const newFilters = { ...state.filters };

    if (bassBoost !== null) newFilters.bassBoost = bassBoost;
    if (nightcore !== null) newFilters.nightcore = nightcore;
    if (vaporwave !== null) newFilters.vaporwave = vaporwave;
    if (_8d !== null) newFilters._8d = _8d;
    if (lofi !== null) newFilters.lofi = lofi;
    if (lowpass !== null) newFilters.lowpass = lowpass;

    await setFilters(guildId, newFilters);
    
    const active = Object.entries(newFilters)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ");
      
    await interaction.reply(`Updated filters. Active: ${active || "None"}`);
  },
};

export default command;
