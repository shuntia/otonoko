import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  InteractionResponse,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | SlashCommandOptionsOnlyBuilder;

export interface SlashCommand {
  data: SlashCommandData;
  execute: (interaction: ChatInputCommandInteraction) => Promise<InteractionResponse<boolean> | void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}
