import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type VoiceChannel,
  type MessageCreateOptions,
} from 'discord.js';
import { prisma } from '@hll/db';
import { client, GUILD_ID } from '../client';
import { redis } from '../redis';
import { raidHelper } from '../services/raidhelper';
import { syncAllRoles } from '../jobs/role-sync.job';
import { syncVoicePresence } from '../jobs/presence-sync.job';
import { syncGuildMeta } from '../jobs/guild-meta.job';
import { pollRecruits } from '../jobs/recruit-poll.job';
import { scrapeHllRecords } from '../jobs/hllrecords-scrape.job';

interface AssignRoleCommand {
  type: 'assignRole';
  discordId: string;
  roleId: string;
}
interface PostRosterCommand {
  type: 'postRoster';
  rosterId: string;
}
interface UpdateRosterCommand {
  type: 'updateRoster';
  rosterId: string;
}
interface RemindPendingCommand {
  type: 'remindPending';
  rosterId: string;
}
interface CleanupSquadLeaderRoleCommand {
  type: 'cleanupSquadLeaderRole';
  roleId: string;
}
interface SyncMembersCommand {
  type: 'syncMembers';
  requestId?: string;
}
interface SyncConnectedServerNicknamesCommand {
  type: 'syncConnectedServerNicknames';
  requestId: string;
  guildId: string;
  targets: { discordId: string; nickname: string }[];
}
interface AssignConnectedServerRosterRolesCommand {
  type: 'assignConnectedServerRosterRoles'; requestId: string; guildId: string;
  infantryRoleId?: string | null; tankRoleId?: string | null;
  targets: { discordId: string; name: string; position: string; role: 'infantry' | 'tank' }[];
}
const BOT_RESPONSE_CHANNEL = 'bot:responses';

interface PollRecruitsCommand {
  type: 'pollRecruits';
  requestId?: string;
}
interface ShareMatchCommand {
  type: 'shareMatch';
  channelId: string;
  content: string;
}
interface ScrapeHllRecordsCommand {
  type: 'scrapeHllRecords';
}
interface CreateBriefingVoiceChannelsCommand {
  type: 'createBriefingVoiceChannels';
  categoryId: string;
  names: string[];
  autoDelete?: boolean;
  deleteAfterMinutes?: number | null;
}
type BotCommand =
  | AssignRoleCommand
  | PostRosterCommand
  | UpdateRosterCommand
  | RemindPendingCommand
  | CleanupSquadLeaderRoleCommand
  | SyncMembersCommand
  | SyncConnectedServerNicknamesCommand
  | AssignConnectedServerRosterRolesCommand
  | PollRecruitsCommand
  | ShareMatchCommand
  | ScrapeHllRecordsCommand
  | CreateBriefingVoiceChannelsCommand;

/** Handles commands published by the API over the `bot:commands` Redis channel. */
export async function handleBotCommand(raw: string) {
  let cmd: BotCommand;
  try {
    cmd = JSON.parse(raw) as BotCommand;
  } catch (err) {
    console.error('[bot] invalid command payload', raw, err);
    return;
  }

  if (cmd.type === 'assignRole') {
    await assignRole(cmd.discordId, cmd.roleId);
  } else if (cmd.type === 'postRoster') {
    console.log(`[bot] postRoster requested for roster ${cmd.rosterId}`);
    await postRoster(cmd.rosterId);
  } else if (cmd.type === 'updateRoster') {
    console.log(`[bot] updateRoster requested for roster ${cmd.rosterId}`);
    await updateRoster(cmd.rosterId);
  } else if (cmd.type === 'remindPending') {
    console.log(`[bot] remindPending requested for roster ${cmd.rosterId}`);
    await remindPending(cmd.rosterId);
  } else if (cmd.type === 'cleanupSquadLeaderRole') {
    await cleanupSquadLeaderRole(cmd.roleId);
  } else if (cmd.type === 'syncMembers') {
    try {
      await syncAllRoles();
      await syncVoicePresence().catch(() => {});
      await syncGuildMeta().catch(() => {});
      await redis.publish(
        BOT_RESPONSE_CHANNEL,
        JSON.stringify({ type: 'syncMembersComplete', requestId: cmd.requestId, ok: true }),
      );
    } catch (error) {
      await redis.publish(
        BOT_RESPONSE_CHANNEL,
        JSON.stringify({
          type: 'syncMembersComplete',
          requestId: cmd.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  } else if (cmd.type === 'syncConnectedServerNicknames') {
    await syncConnectedServerNicknames(cmd);
  } else if (cmd.type === 'assignConnectedServerRosterRoles') {
    await assignConnectedServerRosterRoles(cmd);
  } else if (cmd.type === 'pollRecruits') {
    await pollRecruits();
    if (cmd.requestId) {
      await redis.publish(
        BOT_RESPONSE_CHANNEL,
        JSON.stringify({ type: 'recruitPollComplete', requestId: cmd.requestId }),
      );
    }
  } else if (cmd.type === 'shareMatch') {
    await shareMatch(cmd.channelId, cmd.content);
  } else if (cmd.type === 'scrapeHllRecords') {
    await scrapeHllRecords();
  } else if (cmd.type === 'createBriefingVoiceChannels') {
    await createBriefingVoiceChannels(cmd);
  }
}

async function assignConnectedServerRosterRoles(cmd: AssignConnectedServerRosterRolesCommand) {
  let assigned = 0; let unchanged = 0; let failed = 0; let error: string | undefined;
  const missing: { discordId: string; name: string; position: string; role: string }[] = [];
  try {
    const guild = await client.guilds.fetch(cmd.guildId);
    for (const target of cmd.targets) {
      // Fetch only this member via Discord's REST API. A full member fetch uses
      // Gateway opcode 8 and is aggressively rate-limited on connected servers.
      let member;
      try { member = await guild.members.fetch({ user: target.discordId, force: true }); }
      catch (err) {
        if ((err as { code?: number }).code === 10007) { missing.push(target); continue; }
        failed += 1;
        console.error(`[bot] connected roster member lookup failed for ${target.discordId}`, err);
        continue;
      }
      const roleId = target.role === 'infantry' ? cmd.infantryRoleId : cmd.tankRoleId;
      if (!roleId) continue;
      if (member.roles.cache.has(roleId)) { unchanged += 1; continue; }
      try { await member.roles.add(roleId, `Roster role assignment: ${target.position}`); assigned += 1; }
      catch (err) { failed += 1; console.error(`[bot] connected roster role assignment failed for ${target.discordId}`, err); }
    }
  } catch (err) { error = err instanceof Error ? err.message : String(err); }
  await redis.publish(BOT_RESPONSE_CHANNEL, JSON.stringify({
    type: 'connectedServerRosterRoleAssignmentComplete', requestId: cmd.requestId, ok: !error,
    assigned, unchanged, failed, missing, ...(error ? { error } : {}),
  }));
}

/**
 * Copies primary-dashboard names to members with the same Discord identity in
 * a connected server. The connected server is intentionally not used by any
 * other dashboard workflow.
 */
async function syncConnectedServerNicknames(cmd: SyncConnectedServerNicknamesCommand) {
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let failed = 0;
  let error: string | undefined;
  try {
    const guild = await client.guilds.fetch(cmd.guildId);
    for (const target of cmd.targets) {
      // Do not request the full guild member list (Gateway opcode 8).
      let member;
      try {
        // `force` ensures a current REST lookup, not a potentially stale cache
        // entry; it never sends the gateway-wide opcode 8 request.
        member = await guild.members.fetch({ user: target.discordId, force: true });
      } catch (err) {
        if ((err as { code?: number }).code === 10007) {
          missing += 1;
        } else {
          failed += 1;
          console.error(`[bot] nickname sync member lookup failed for ${target.discordId} in ${cmd.guildId}`, err);
        }
        continue;
      }
      const nickname = target.nickname.trim().slice(0, 32);
      if (!nickname || member.nickname === nickname) {
        unchanged += 1;
        continue;
      }
      try {
        await member.setNickname(nickname, 'Synced from primary clan dashboard');
        updated += 1;
      } catch (err) {
        failed += 1;
        console.error(`[bot] nickname sync failed for ${target.discordId} in ${cmd.guildId}`, err);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[bot] connected-server nickname sync failed for ${cmd.guildId}`, err);
  }
  await redis.publish(
    BOT_RESPONSE_CHANNEL,
    JSON.stringify({
      type: 'connectedServerNicknameSyncComplete',
      requestId: cmd.requestId,
      ok: !error,
      updated,
      unchanged,
      missing,
      failed,
      ...(error ? { error } : {}),
    }),
  );
}

async function createBriefingVoiceChannels(cmd: CreateBriefingVoiceChannelsCommand) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const category = await guild.channels.fetch(cmd.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) return;

    const created: VoiceChannel[] = [];
    for (const name of cmd.names.map((n) => n.trim()).filter(Boolean).slice(0, 25)) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category.id,
      });
      created.push(channel);
    }

    if (cmd.autoDelete && cmd.deleteAfterMinutes && cmd.deleteAfterMinutes > 0) {
      const delayMs = Math.min(cmd.deleteAfterMinutes, 10080) * 60 * 1000;
      setTimeout(() => {
        void Promise.all(
          created.map(async (channel) => {
            try {
              const fresh = await guild.channels.fetch(channel.id);
              if (fresh?.type === ChannelType.GuildVoice) await fresh.delete('Briefing voice channel auto-delete');
            } catch (err) {
              console.error(`[bot] auto-delete briefing voice channel ${channel.id} failed`, err);
            }
          }),
        ).then(() => syncGuildMeta().catch(() => {}));
      }, delayMs);
    }

    await syncGuildMeta().catch(() => {});
    await syncVoicePresence().catch(() => {});
  } catch (err) {
    console.error('[bot] createBriefingVoiceChannels failed', err);
  }
}

async function shareMatch(channelId: string, content: string) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    await channel.send({ content });
  } catch (err) {
    console.error('[bot] shareMatch failed', err);
  }
}

async function assignRole(discordId: string, roleId: string) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId);
    await member.roles.add(roleId);
  } catch (err) {
    console.error('[bot] assignRole failed', err);
  }
}

const SQUAD_LEADER_SLOT_KINDS = new Set([
  'commander',
  'artillery',
  'spotter',
  'tankCommander',
  'squadLeader',
]);

function squadLeaderDiscordIds(data: unknown) {
  const layout = (data ?? {}) as RosterLayout;
  const ids = new Set<string>();
  for (const squad of layout.squads ?? []) {
    for (const slot of squad.slots ?? []) {
      if (slot.kind && SQUAD_LEADER_SLOT_KINDS.has(slot.kind) && slot.player?.discordId) {
        ids.add(slot.player.discordId);
      }
    }
  }
  return [...ids];
}

async function assignRosterSquadLeaderRole(roster: RosterWithSlots) {
  const roleId = roster.squadLeaderRoleId;
  if (!roleId || roster.squadLeaderRoleAssignedAt) return;
  const endsAt = roster.eventStartTime ? roster.eventStartTime.getTime() + 2 * 60 * 60 * 1000 : null;
  if (endsAt && endsAt <= Date.now()) {
    await prisma.roster.update({ where: { id: roster.id }, data: { squadLeaderRoleRemovedAt: new Date() } });
    return;
  }
  const ids = squadLeaderDiscordIds(roster.data);
  if (ids.length) {
    const guild = await client.guilds.fetch(GUILD_ID);
    await Promise.all(ids.map(async (discordId) => {
      try {
        const member = await guild.members.fetch(discordId);
        await member.roles.add(roleId, `Roster ${roster.id} squad leadership`);
      } catch (err) {
        console.error(`[bot] squad leader role assignment failed for ${discordId}`, err);
      }
    }));
  }
  await prisma.roster.update({ where: { id: roster.id }, data: { squadLeaderRoleAssignedAt: new Date() } });
}

async function removeRosterSquadLeaderRole(roster: RosterWithSlots) {
  if (!roster.squadLeaderRoleId || roster.squadLeaderRoleRemovedAt) return;
  const guild = await client.guilds.fetch(GUILD_ID);
  await Promise.all(squadLeaderDiscordIds(roster.data).map(async (discordId) => {
    try {
      const member = await guild.members.fetch(discordId);
      await member.roles.remove(roster.squadLeaderRoleId!, `Roster ${roster.id} leadership period ended`);
    } catch (err) {
      console.error(`[bot] squad leader role removal failed for ${discordId}`, err);
    }
  }));
  await prisma.roster.update({ where: { id: roster.id }, data: { squadLeaderRoleRemovedAt: new Date() } });
}

export async function cleanupExpiredRosterSquadLeaderRoles() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const rosters = await prisma.roster.findMany({
    where: {
      squadLeaderRoleId: { not: null },
      squadLeaderRoleAssignedAt: { not: null },
      squadLeaderRoleRemovedAt: null,
      eventStartTime: { not: null, lte: cutoff },
    },
    include: { slots: true },
  });
  for (const roster of rosters) await removeRosterSquadLeaderRole(roster);
}

async function cleanupSquadLeaderRole(roleId: string) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch();
  await Promise.all(members.filter((member) => member.roles.cache.has(roleId)).map(async (member) => {
    try {
      await member.roles.remove(roleId, 'Manual squad leader role cleanup');
    } catch (err) {
      console.error(`[bot] manual squad leader role cleanup failed for ${member.id}`, err);
    }
  }));
  await prisma.roster.updateMany({
    where: { squadLeaderRoleId: roleId, squadLeaderRoleAssignedAt: { not: null }, squadLeaderRoleRemovedAt: null },
    data: { squadLeaderRoleRemovedAt: new Date() },
  });
}

interface LayoutPlayer {
  discordId?: string;
  name?: string;
  roles?: { key?: string; name?: string }[];
}
interface LayoutSlot {
  label?: string;
  kind?: string;
  player?: LayoutPlayer | null;
}
interface LayoutSquad {
  name?: string;
  type?: string;
  slots?: LayoutSlot[];
}
interface RosterLayout {
  squads?: LayoutSquad[];
  reserves?: LayoutPlayer[];
}

const DEFAULT_STATUS_ICON: Record<string, string> = {
  accepted: '<:yes:1389367850082500729>',
  declined: '<:no:1389367851470553108>',
  pending: '<:pending:1397222095770878069>',
};

const DEFAULT_SLOT_ICON: Record<string, string> = {
  commander: '',
  artillery: '',
  spotter: '',
  sniper: '',
  tankCommander: '',
  gunner: '',
  driver: '',
  squadLeader: '',
  infantry: '',
};

const DEFAULT_ROLE_ICON: Record<string, string> = {
  engineer: '',
  'anti-tank': '',
  mg: '',
  garrison: '',
  supplies: '',
  'supply-truck': '',
  'truck-driver': '',
  'at-gun': '',
  sniper: '',
};

const DEFAULT_BUTTON_ICON: Record<string, string> = {
  confirm: '✅',
  decline: '❌',
};

interface RosterEmojiConfig {
  status: Record<string, string>;
  slots: Record<string, string>;
  roles: Record<string, string>;
  buttons: Record<string, string>;
}

interface RosterEventMeta {
  description?: string | null;
  startTime?: number | null;
}

type RosterWithSlots = NonNullable<Awaited<ReturnType<typeof loadRoster>>>;

interface SendableDiscordChannel {
  send(payload: MessageCreateOptions): Promise<{ id: string }>;
  messages?: {
    fetch(messageId: string): Promise<{
      edit(payload: MessageCreateOptions): Promise<unknown>;
    }>;
  };
}

export function loadRoster(rosterId: string) {
  return prisma.roster.findUnique({
    where: { id: BigInt(rosterId) },
    include: { slots: true },
  });
}

export async function loadRosterEmojiConfig(): Promise<RosterEmojiConfig> {
  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { rosterEmojis: true },
  });
  const raw =
    settings?.rosterEmojis && typeof settings.rosterEmojis === 'object'
      ? (settings.rosterEmojis as {
          status?: Record<string, string>;
          slots?: Record<string, string>;
          roles?: Record<string, string>;
          buttons?: Record<string, string>;
        })
      : {};

  return {
    status: { ...DEFAULT_STATUS_ICON, ...(raw.status ?? {}) },
    slots: { ...DEFAULT_SLOT_ICON, ...(raw.slots ?? {}) },
    roles: { ...DEFAULT_ROLE_ICON, ...(raw.roles ?? {}) },
      buttons: { ...DEFAULT_BUTTON_ICON, ...(raw.buttons ?? {}) },
  };
}

async function loadRosterEventMeta(roster: RosterWithSlots): Promise<RosterEventMeta> {
  const savedStartTime = roster.eventStartTime
    ? Math.floor(roster.eventStartTime.getTime() / 1000)
    : null;

  if (!roster.raidhelperEventId) {
    return { startTime: savedStartTime };
  }

  const event = await raidHelper.getEvent(roster.raidhelperEventId);
  const eventStartTime = event?.startTime ? Number(event.startTime) : null;

  return {
    description: event?.description ?? null,
    startTime: savedStartTime ?? eventStartTime,
  };
}

function buildEmbedDescription(meta: RosterEventMeta) {
  const lines: string[] = [];
  if (meta.startTime) {
    lines.push(`**Time:** <t:${meta.startTime}:F> (<t:${meta.startTime}:R>)`);
  }

  const description = meta.description?.trim();
  if (description) {
    lines.push(description);
  }

  const text = lines.join('\n\n');
  return text ? text.slice(0, 4096) : null;
}

/** Build the roster embed + Confirm/Decline buttons from the saved squad layout. */
export async function buildRosterMessage(roster: RosterWithSlots, emojiConfig: RosterEmojiConfig) {
  const layout = (roster.data ?? {}) as RosterLayout;
  const responseByDiscord = new Map(
    roster.slots.map((s) => [s.discordId ?? '', s.response as string]),
  );

  const renderStatus = (p?: LayoutPlayer | null) => {
    if (!p?.discordId) return emojiConfig.status.pending;
    return emojiConfig.status[responseByDiscord.get(p.discordId) ?? 'pending'];
  };

  const renderPlayer = (p?: LayoutPlayer | null) => {
    if (!p?.discordId) return '_Empty_';
    const roleEmojis = (p.roles ?? [])
      .map((role) => (role.key ? emojiConfig.roles[role.key] : null))
      .filter(Boolean)
      .join(' ');
    return `<@${p.discordId}>${roleEmojis ? ` ${roleEmojis}` : ''}`;
  };

  const embed = new EmbedBuilder()
    .setTitle(roster.name || roster.eventTitle || 'Match Roster')
    .setColor(0xff6f00);
  const description = buildEmbedDescription(await loadRosterEventMeta(roster));
  if (description) embed.setDescription(description);

  const squads = Array.isArray(layout.squads) ? layout.squads : [];
  for (const squad of squads.slice(0, 24)) {
    const slots = Array.isArray(squad.slots) ? squad.slots : [];
    const lines = slots
      .map((slot) => {
        const slotIcon = slot.kind ? emojiConfig.slots[slot.kind] : '';
        return `${renderStatus(slot.player)} ${slotIcon || '•'} ${renderPlayer(slot.player)}`;
      })
      .join('\n');

    embed.addFields({
      name: `__${squad.name || 'Squad'}__`,
      value: lines || '_Empty squad_',
      inline: false,
    });
  }

  const reserves = Array.isArray(layout.reserves) ? layout.reserves : [];
  if (reserves.length) {
    embed.addFields({
      name: '__Reserves__',
      value:
        reserves.map((p) => `${renderStatus(p)} ${renderPlayer(p)}`).join('\n') ||
        '_No reserves_',
      inline: false,
    });
  }

  const total = roster.slots.length;
  const confirmed = roster.slots.filter((s) => s.response === 'accepted').length;
  const declined = roster.slots.filter((s) => s.response === 'declined').length;
  const pending = total - confirmed - declined;
  embed.setFooter({
    text: `${confirmed} confirmed | ${pending} pending | ${declined} declined`,
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`roster:${roster.id}:accept`)
      .setLabel('Confirm')
      .setEmoji(emojiConfig.buttons.confirm || DEFAULT_BUTTON_ICON.confirm)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`roster:${roster.id}:decline`)
      .setLabel('Decline')
      .setEmoji(emojiConfig.buttons.decline || DEFAULT_BUTTON_ICON.decline)
      .setStyle(ButtonStyle.Danger),
  );

  const mentions = roster.slots
    .map((s) => s.discordId)
    .filter((id): id is string => Boolean(id))
    .map((id) => `<@${id}>`)
    .join(' ');

  return {
    content: mentions ? `Roster posted for confirmation: ${mentions}` : undefined,
    embeds: [embed],
    components: [row],
  };
}

async function resolveChannel(roster: RosterWithSlots) {
  let channelId = roster.channelId;
  if (!channelId && roster.raidhelperEventId) {
    const event = await raidHelper.getEvent(roster.raidhelperEventId);
    channelId = event?.channelId ?? null;
  }
  if (!channelId) {
    console.error(`[bot] roster ${roster.id} has no Discord channel id`);
    return null;
  }
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    console.error(
      `[bot] roster ${roster.id} channel ${channelId} is not a sendable text channel`,
    );
    return null;
  }
  return { channel: channel as unknown as SendableDiscordChannel, channelId };
}

async function postRoster(rosterId: string) {
  const roster = await loadRoster(rosterId);
  if (!roster) {
    console.error(`[bot] postRoster failed: roster ${rosterId} not found`);
    return;
  }

  if (roster.messageId && roster.channelId) {
    await updateRoster(rosterId);
    return;
  }

  const resolved = await resolveChannel(roster);
  if (!resolved) return;

  try {
    const message = await buildRosterMessage(roster, await loadRosterEmojiConfig());
    const sent = await resolved.channel.send(message);
    await prisma.roster.update({
      where: { id: roster.id },
      data: { messageId: sent.id, channelId: resolved.channelId, status: 'posted' },
    });
    await assignRosterSquadLeaderRole(roster);
    console.log(`[bot] posted roster ${roster.id} to channel ${resolved.channelId}`);
  } catch (err) {
    console.error(`[bot] postRoster failed for roster ${roster.id}`, err);
  }
}

async function updateRoster(rosterId: string) {
  const roster = await loadRoster(rosterId);
  if (!roster?.messageId || !roster.channelId) {
    await postRoster(rosterId);
    return;
  }
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(roster.channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      console.error(
        `[bot] updateRoster failed: channel ${roster.channelId} is not a message channel`,
      );
      return;
    }
    const message = await channel.messages.fetch(roster.messageId);
    await message.edit(await buildRosterMessage(roster, await loadRosterEmojiConfig()));
    await prisma.roster.update({ where: { id: roster.id }, data: { status: 'posted' } });
  } catch (err) {
    if ((err as { code?: number }).code === 10008) {
      console.warn(`[bot] roster ${roster.id} message missing; posting a fresh embed`);
      await prisma.roster.update({
        where: { id: roster.id },
        data: { messageId: null, status: 'draft' },
      });
      await postRoster(rosterId);
      return;
    }
    console.error('[bot] updateRoster failed', err);
  }
}

async function remindPending(rosterId: string) {
  const roster = await loadRoster(rosterId);
  if (!roster) return;
  const resolved = await resolveChannel(roster);
  if (!resolved) return;

  const pending = roster.slots.filter((s) => s.response === 'pending' && s.discordId);
  if (!pending.length) return;
  const mentions = pending.map((s) => `<@${s.discordId}>`).join(' ');
  const title = roster.name || roster.eventTitle || 'the match roster';
  await resolved.channel.send({
    content: `Reminder: please confirm your spot for **${title}**: ${mentions}`,
  });
}
