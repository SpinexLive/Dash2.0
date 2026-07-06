import { ChannelType } from 'discord.js';
import { client, GUILD_ID } from '../client';
import { redis } from '../redis';

/**
 * Snapshots the membership of every voice channel into Redis so the Briefing
 * page can show who is currently in voice. Refreshed on a short interval and
 * on voiceStateUpdate events.
 */
export async function syncVoicePresence() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();

  for (const channel of channels.values()) {
    if (!channel || channel.type !== ChannelType.GuildVoice) continue;
    const members = [...channel.members.values()].map((m) => ({
      discordId: m.id,
      nick: m.nickname ?? m.user.username,
    }));
    await redis.set(`voice:${channel.id}`, JSON.stringify(members), 'EX', 60);
  }
}
