import 'reflect-metadata';
import './load-env';
import cron from 'node-cron';
import { Events } from 'discord.js';
import { client } from './client';
import { subscriber } from './redis';
import { pollRecruits } from './jobs/recruit-poll.job';
import { syncAllRoles } from './jobs/role-sync.job';
import { syncVoicePresence } from './jobs/presence-sync.job';
import { syncGuildMeta } from './jobs/guild-meta.job';
import { scrapeHllRecords } from './jobs/hllrecords-scrape.job';
import { handleBotCommand } from './handlers/commands';
import { registerInteractionHandler } from './handlers/interactions';
import { registerGatewayHandlers } from './handlers/gateway';

const BOT_COMMAND_CHANNEL = 'bot:commands';

async function main() {
  registerInteractionHandler();
  registerGatewayHandlers();

  client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] logged in as ${c.user.tag}`);

    // Initial syncs.
    await syncAllRoles().catch((e) => console.error('[bot] role sync', e));
    await syncVoicePresence().catch((e) => console.error('[bot] voice sync', e));
    await syncGuildMeta().catch((e) => console.error('[bot] guild meta', e));
    await pollRecruits().catch((e) => console.error('[bot] recruit poll', e));

    // Scheduled recruit intake poll.
    cron.schedule(process.env.RECRUIT_POLL_CRON ?? '*/5 * * * *', () => {
      pollRecruits().catch((e) => console.error('[bot] recruit poll', e));
    });

    // Periodic safety-net role re-sync (hourly) and voice refresh (30s).
    cron.schedule('0 * * * *', () => {
      syncAllRoles().catch((e) => console.error('[bot] role sync', e));
      syncGuildMeta().catch((e) => console.error('[bot] guild meta', e));
    });
    setInterval(() => {
      syncVoicePresence().catch((e) => console.error('[bot] voice sync', e));
    }, 30_000);

    // Daily hllrecords.com stat scrape (default 05:00 server time).
    cron.schedule(process.env.HLLRECORDS_CRON ?? '0 5 * * *', () => {
      scrapeHllRecords().catch((e) => console.error('[bot] hllrecords', e));
    });
  });

  // Listen for commands from the API.
  await subscriber.subscribe(BOT_COMMAND_CHANNEL);
  subscriber.on('message', (_channel, message) => {
    handleBotCommand(message).catch((e) => console.error('[bot] command', e));
  });

  await client.login(process.env.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  console.error('[bot] fatal', err);
  process.exit(1);
});
