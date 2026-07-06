import { Client, GatewayIntentBits, Partials } from 'discord.js';

/** Shared Discord gateway client with the intents needed for all jobs/handlers. */
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // role sync (privileged)
    GatewayIntentBits.GuildVoiceStates, // briefing presence (privileged)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // recruit parsing (privileged)
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

export const GUILD_ID = process.env.DISCORD_GUILD_ID!;
