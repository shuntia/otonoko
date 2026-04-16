import dotenv from "dotenv";
import { z } from "zod";
import { log } from "../logger.js";

dotenv.config();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  CLIENT_ID: z.string().min(1, "CLIENT_ID is required"),
  GUILD_ID: z.string().optional(),
  OWNER_IDS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  log.error("Invalid environment", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed");
}

export const env = parsed.data;

export const ownerIds: string[] =
  env.OWNER_IDS?.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0) ?? [];
