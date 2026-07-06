import { ChannelType } from 'discord.js';
import { client, GUILD_ID } from '../client';
import { redis } from '../redis';

/**
 * Snapshots the guild's roles and channels into Redis so the Settings
 * page can offer dropdowns instead of raw ID fields. Refreshed on startup, on
 * a schedule, and whenever the API asks for a member re-sync.
 */
export async function syncGuildMeta() {
  const guild = await client.guilds.fetch(GUILD_ID);

  const roles = await guild.roles.fetch();
  const roleList = [...roles.values()]
    .filter((r) => r.id !== guild.id) // exclude @everyone
    .sort((a, b) => b.position - a.position) // highest hierarchy first
    .map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      color: r.hexColor,
    }));
  await redis.set('discord:roles', JSON.stringify(roleList));

  const channels = await guild.channels.fetch();
  const textChannels = [...channels.values()]
    .filter((c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));
  await redis.set('discord:channels', JSON.stringify(textChannels));

  const voiceChannels = [...channels.values()]
    .filter((c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildVoice)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));
  await redis.set('discord:voiceChannels', JSON.stringify(voiceChannels));

  const categories = [...channels.values()]
    .filter((c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));
  await redis.set('discord:categories', JSON.stringify(categories));

  const emojis = await guild.emojis.fetch();
  const emojiList = [...emojis.values()]
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map((e) => {
      const name = e.name ?? e.id;
      return {
        id: e.id,
        name,
        animated: e.animated ?? false,
        url: e.imageURL({ extension: e.animated ? 'gif' : 'png', size: 64 }) ?? '',
        code: `<${e.animated ? 'a' : ''}:${name}:${e.id}>`,
      };
    });
  await redis.set('discord:emojis', JSON.stringify(emojiList));
}
