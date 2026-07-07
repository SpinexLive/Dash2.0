import { ChannelType, type Message } from 'discord.js';
import { prisma } from '@hll/db';
import { client, GUILD_ID } from '../client';

/** Flattens a message (content + every embed) into a single searchable string. */
function flattenMessage(msg: Message): string {
  const parts: string[] = [];
  if (msg.content) parts.push(msg.content);
  for (const e of msg.embeds) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    for (const f of e.fields) parts.push(`${f.name}\n${f.value}`);
    if (e.footer?.text) parts.push(e.footer.text);
  }
  return parts.join('\n');
}

/** Pulls the applicant's Discord user id from the "UserId:" submission stat. */
export function extractApplicantId(application: string): string | null {
  const match = application.match(/UserId:\s*`?(\d{17,20})`?/i);
  return match ? match[1] : null;
}

/**
 * Extracts the answer to: "3. What is your Steam/EPIC ID?"
 * Tolerates markdown headers (### **3.** …) and validates Steam64 / Epic.
 */
export function extractGameId(application: string): string | null {
  const lines = application.split('\n').map((l) => l.trim());
  const qIdx = lines.findIndex(
    (l) => /Steam\/?EPIC ID/i.test(l) && /\b3\b/.test(l),
  );

  let answer: string | null = null;
  if (qIdx >= 0) {
    for (let i = qIdx + 1; i < lines.length; i++) {
      if (lines[i]) {
        answer = lines[i];
        break;
      }
    }
  }

  if (!answer) {
    const steam = application.match(/\b(7656\d{13})\b/);
    return steam ? steam[1] : null;
  }

  answer = answer.replace(/[`*]/g, '').trim();
  const steam = answer.match(/\b(7656\d{13}|\d{17})\b/);
  if (steam) return steam[1];
  const epic = answer.match(/\b([0-9a-fA-F]{32})\b/);
  if (epic) return epic[1];
  if (/^\d+$/.test(answer)) return answer;
  return answer || null;
}

/** Polls the recruit channel for every application it can find. */
export async function pollRecruits() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const channelId = settings?.recruitChannelId;
  if (!channelId) {
    console.log('[recruit-poll] no recruit channel configured');
    return;
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.log(
      `[recruit-poll] channel ${channelId} missing or not a text channel (type=${channel?.type})`,
    );
    return;
  }

  let scanned = 0;
  let embeds = 0;
  let parsed = 0;
  const activeMessageIds = new Set<string>();

  // Page through the channel's full history (Discord caps each fetch at 100).
  let before: string | undefined;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      scanned++;
      if (client.user && msg.author.id === client.user.id) continue; // skip self
      if (msg.embeds.length) embeds++;

      // Applications are posted as embeds by the form bot — flatten everything.
      let text = flattenMessage(msg);
      if (!text.trim()) continue;

      // Identify the applicant from the embed (not the form bot author).
      const discordId = extractApplicantId(text);
      if (!discordId) continue; // not a parseable application

      activeMessageIds.add(msg.id);

      // Resolve the applicant's nickname and rewrite mentions as readable names
      // so the dashboard can show the nickname without its own Discord lookup.
      const member = await guild.members.fetch(discordId).catch(() => null);
      const nick = member?.nickname ?? member?.user.username ?? null;
      text = text.replace(/<@!?(\d+)>/g, (_m, id: string) =>
        id === discordId && nick ? `@${nick}` : `@${id}`,
      );

      const gameId = extractGameId(text);
      parsed++;

      await prisma.recruit.upsert({
        where: { messageId: msg.id },
        create: {
          messageId: msg.id,
          discordId,
          rawApplication: text,
          extractedGameId: gameId,
          status: 'pending',
          postedAt: new Date(msg.createdTimestamp),
        },
        update: {
          // keep the latest parse but never overwrite a processed recruit
          rawApplication: text,
          extractedGameId: gameId,
        },
      });
    }

    before = batch.last()?.id;
    if (!before) break;
  }

  if (activeMessageIds.size > 0) {
    const removed = await prisma.recruit.deleteMany({
      where: {
        messageId: { notIn: [...activeMessageIds] },
      },
    });
    console.log(
      `[recruit-poll] scanned=${scanned} withEmbeds=${embeds} applications=${parsed} removedRows=${removed.count}`,
    );
  } else {
    const removed = await prisma.recruit.deleteMany({ where: { status: 'pending' } });
    console.log(
      `[recruit-poll] scanned=${scanned} withEmbeds=${embeds} applications=${parsed} removedRows=${removed.count}`,
    );
  }
}
