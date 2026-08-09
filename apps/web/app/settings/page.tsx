'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';

interface RoleOption {
  id: string;
  name: string;
  position?: number;
  color?: string;
}
interface ChannelOption {
  id: string;
  name: string;
}
interface BriefingVoiceChannelSettings {
  categoryId: string | null;
  names: string[];
  autoDelete: boolean;
  deleteAfterMinutes: number | null;
}
interface DiscordEmojiOption {
  id: string;
  name: string;
  animated?: boolean;
  url?: string;
  code: string;
}

interface ImportGameIdsResult {
  rows: number;
  parsed: number;
  matched: number;
  updated: number;
  missingUser: number;
  invalidGameId: number;
}

interface Settings {
  memberRoleId: string | null;
  memberRoleIds: string[];
  adminRoleIds: string[];
  recruitChannelId: string | null;
  matchChannelId: string | null;
  squadLeaderRoleId: string | null;
  briefingVoiceChannelId: string | null;
  briefingVoiceChannels: BriefingVoiceChannelSettings;
  rconApiUrl: string | null;
  rconApiToken: string | null;
  rankRoles: RankRoleSettings;
  selectableRoles: RoleOption[];
  rosterEmojis: RosterEmojiSettings;
}

interface RankRoleSettings {
  recruit: RoleOption[];
  member: RoleOption[];
  competitive: RoleOption[];
  collab: RoleOption[];
}

interface RosterEmojiSettings {
  status?: Record<string, string>;
  slots?: Record<string, string>;
  roles?: Record<string, string>;
  buttons?: Record<string, string>;
}

const DEFAULT_ROSTER_EMOJIS: RosterEmojiSettings = {
  status: {
    accepted: '<:yes:1389367850082500729>',
    declined: '<:no:1389367851470553108>',
    pending: '<:pending:1397222095770878069>',
  },
  buttons: {
    confirm: '\u2705',
    decline: '\u274c',
  },
  slots: {},
  roles: {},
};

const EMPTY_RANK_ROLES: RankRoleSettings = {
  recruit: [],
  member: [],
  competitive: [],
  collab: [],
};

const EMPTY_BRIEFING_VOICE_CHANNELS: BriefingVoiceChannelSettings = {
  categoryId: null,
  names: [],
  autoDelete: false,
  deleteAfterMinutes: null,
};

const SLOT_EMOJI_FIELDS = [
  ['commander', 'Commander'],
  ['artillery', 'Artillery'],
  ['spotter', 'Spotter'],
  ['sniper', 'Sniper'],
  ['tankCommander', 'Tank Commander'],
  ['gunner', 'Gunner'],
  ['driver', 'Driver'],
  ['squadLeader', 'Squad Leader'],
  ['infantry', 'Infantry'],
] as const;

const ROLE_EMOJI_FIELDS = [
  ['engineer', 'Engineer'],
  ['anti-tank', 'Anti-Tank'],
  ['mg', 'Machine Gun'],
  ['garrison', 'Garrison'],
  ['supplies', 'Supplies'],
  ['supply-truck', 'Supply Truck'],
  ['truck-driver', 'Truck Driver'],
  ['at-gun', 'AT Gun'],
  ['sniper', 'Sniper Role'],
] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<ChannelOption[]>([]);
  const [categories, setCategories] = useState<ChannelOption[]>([]);
  const [emojis, setEmojis] = useState<DiscordEmojiOption[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportGameIdsResult | null>(null);

  useEffect(() => {
    api<Settings | null>('/settings')
      .then((s) =>
        setSettings({
          memberRoleId: s?.memberRoleId ?? null,
          memberRoleIds: normalizeMemberRoleIds(s),
          adminRoleIds: normalizeRoleIds(s?.adminRoleIds),
          recruitChannelId: s?.recruitChannelId ?? null,
          matchChannelId: s?.matchChannelId ?? null,
          squadLeaderRoleId: s?.squadLeaderRoleId ?? null,
          briefingVoiceChannelId: s?.briefingVoiceChannelId ?? null,
          briefingVoiceChannels: normalizeBriefingVoiceChannels(s?.briefingVoiceChannels),
          rconApiUrl: s?.rconApiUrl ?? 'http://45.151.81.182:8010/',
          rconApiToken: s?.rconApiToken ?? 'ecb6970c-0c86-420c-8902-c7c71729018b',
          rankRoles: normalizeRankRoles(s?.rankRoles),
          selectableRoles: s?.selectableRoles ?? [],
          rosterEmojis: mergeRosterEmojis(s?.rosterEmojis),
        }),
      )
      .catch(() => setSettings(null));
    api<RoleOption[]>('/settings/discord/roles')
      .then(setRoles)
      .catch(() => setRoles([]));
    api<ChannelOption[]>('/settings/discord/channels')
      .then(setChannels)
      .catch(() => setChannels([]));
    api<ChannelOption[]>('/settings/discord/voice-channels')
      .then(setVoiceChannels)
      .catch(() => setVoiceChannels([]));
    api<ChannelOption[]>('/settings/discord/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
    api<DiscordEmojiOption[]>('/settings/discord/emojis')
      .then(setEmojis)
      .catch(() => setEmojis([]));
    api<{ logoUrl: string | null }>('/settings/logo')
      .then((r) => setLogoUrl(r?.logoUrl ?? null))
      .catch(() => setLogoUrl(null));
  }, []);

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoError(null);
    if (!file.type.startsWith('image/')) {
      setLogoError('Please choose an image file.');
      return;
    }
    if (file.size > 1_000_000) {
      setLogoError('Image is too large (max 1 MB).');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setLogoBusy(true);
    try {
      const r = await api<{ logoUrl: string | null }>('/settings/logo', {
        method: 'PATCH',
        body: JSON.stringify({ logoUrl: dataUrl }),
      });
      setLogoUrl(r?.logoUrl ?? null);
      window.dispatchEvent(new Event('settings:logo-updated'));
    } catch {
      setLogoError('Upload failed. Try a smaller image.');
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setLogoError(null);
    try {
      await api('/settings/logo', {
        method: 'PATCH',
        body: JSON.stringify({ logoUrl: null }),
      });
      setLogoUrl(null);
      window.dispatchEvent(new Event('settings:logo-updated'));
    } finally {
      setLogoBusy(false);
    }
  }

  async function onGameIdImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setImportError('Please choose a JSON export file.');
      return;
    }
    setImportBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : Array.isArray(parsed?.data)
            ? parsed.data
            : null;
      if (!rows) {
        setImportError('JSON must be an array, or contain a rows/data array.');
        return;
      }
      const result = await api<ImportGameIdsResult>('/settings/import-game-ids', {
        method: 'PATCH',
        body: JSON.stringify({ rows }),
      });
      setImportResult(result);
    } catch {
      setImportError('Import failed. Check the JSON format and try again.');
    } finally {
      setImportBusy(false);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          memberRoleId: settings.memberRoleId,
          memberRoleIds: settings.memberRoleIds,
          adminRoleIds: settings.adminRoleIds,
          recruitChannelId: settings.recruitChannelId,
          matchChannelId: settings.matchChannelId,
          squadLeaderRoleId: settings.squadLeaderRoleId,
          briefingVoiceChannelId: settings.briefingVoiceChannelId,
          briefingVoiceChannels: settings.briefingVoiceChannels,
          rconApiUrl: settings.rconApiUrl,
          rconApiToken: settings.rconApiToken,
          rankRoles: settings.rankRoles,
          rosterEmojis: settings.rosterEmojis,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function setRankRole(group: keyof RankRoleSettings, roleId: string) {
    if (!settings) return;
    const selected = roles.find((r) => r.id === roleId);
    setSettings({
      ...settings,
      rankRoles: {
        ...settings.rankRoles,
        [group]: selected ? [{ id: selected.id, name: selected.name }] : [],
      },
    });
  }

  function toggleMemberRole(role: RoleOption, checked: boolean) {
    if (!settings) return;
    const ids = new Set(settings.memberRoleIds);
    if (checked) ids.add(role.id);
    else ids.delete(role.id);
    const memberRoleIds = roles.filter((r) => ids.has(r.id)).map((r) => r.id);
    setSettings({
      ...settings,
      memberRoleIds,
      memberRoleId: memberRoleIds[0] ?? null,
    });
  }

  function toggleAdminRole(role: RoleOption, checked: boolean) {
    if (!settings) return;
    const ids = new Set(settings.adminRoleIds);
    if (checked) ids.add(role.id);
    else ids.delete(role.id);
    setSettings({
      ...settings,
      adminRoleIds: roles.filter((r) => ids.has(r.id)).map((r) => r.id),
    });
  }

  function toggleCollabRole(role: RoleOption, checked: boolean) {
    if (!settings) return;
    const ids = new Set(settings.rankRoles.collab.map((r) => r.id));
    if (checked) ids.add(role.id);
    else ids.delete(role.id);
    setSettings({
      ...settings,
      rankRoles: {
        ...settings.rankRoles,
        collab: roles.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
      },
    });
  }

  function updateRosterEmoji(
    group: keyof RosterEmojiSettings,
    key: string,
    value: string,
  ) {
    if (!settings) return;
    setSettings({
      ...settings,
      rosterEmojis: {
        ...settings.rosterEmojis,
        [group]: {
          ...(settings.rosterEmojis[group] ?? {}),
          [key]: value,
        },
      },
    });
  }

  function updateBriefingVoiceChannel(index: number, value: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      briefingVoiceChannels: {
        ...settings.briefingVoiceChannels,
        names: settings.briefingVoiceChannels.names.map((name, i) => (i === index ? value : name)),
      },
    });
  }

  function addBriefingVoiceChannel() {
    if (!settings) return;
    setSettings({
      ...settings,
      briefingVoiceChannels: {
        ...settings.briefingVoiceChannels,
        names: [...settings.briefingVoiceChannels.names, ''],
      },
    });
  }

  function removeBriefingVoiceChannel(index: number) {
    if (!settings) return;
    setSettings({
      ...settings,
      briefingVoiceChannels: {
        ...settings.briefingVoiceChannels,
        names: settings.briefingVoiceChannels.names.filter((_, i) => i !== index),
      },
    });
  }

  if (!settings)
    return (
      <div className="animate-fade-in">
        <PageHeader title="Settings" />
        <div className="card p-10 text-center text-sm text-zinc-500">
          Loading settings...
        </div>
      </div>
    );

  const noRoles = roles.length === 0;
  const noChannels = channels.length === 0;
  const noVoiceChannels = voiceChannels.length === 0;
  const noCategories = categories.length === 0;
  const recruitRankId = settings.rankRoles.recruit[0]?.id ?? '';
  const memberRankId = settings.rankRoles.member[0]?.id ?? '';
  const competitiveRankId = settings.rankRoles.competitive[0]?.id ?? '';
  const collabRankId = settings.rankRoles.collab[0]?.id ?? '';
  const adminRoleIds = new Set(settings.adminRoleIds);
  const memberRoleIds = new Set(settings.memberRoleIds);
  const collabRoleIds = new Set(settings.rankRoles.collab.map((role) => role.id));

  return (
    <div className="animate-fade-in flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      <PageHeader
        title="Settings"
        description="Discord, roster, and server configuration."
      />

      <div className="grid w-full min-w-0 flex-1 gap-4 pb-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
        <div className="min-w-0 space-y-4">
          <SettingsPanel title="Discord Routing">
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="label">Briefing Voice Channel</span>
                <select
                  className="input"
                  value={settings.briefingVoiceChannelId ?? ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      briefingVoiceChannelId: e.target.value || null,
                    })
                  }
                >
                  <option value="">-- none --</option>
                  {voiceChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label">Recruit Application Channel</span>
                <select
                  className="input"
                  value={settings.recruitChannelId ?? ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      recruitChannelId: e.target.value || null,
                    })
                  }
                >
                  <option value="">-- none --</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label">Match Announcement Channel</span>
                <select
                  className="input"
                  value={settings.matchChannelId ?? ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      matchChannelId: e.target.value || null,
                    })
                  }
                >
                  <option value="">-- none --</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 lg:col-span-2">
                <label className="block">
                  <span className="label">Briefing Channel Category</span>
                  <select
                    className="input"
                    value={settings.briefingVoiceChannels.categoryId ?? ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        briefingVoiceChannels: {
                          ...settings.briefingVoiceChannels,
                          categoryId: e.target.value || null,
                        },
                      })
                    }
                  >
                    <option value="">-- none --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-lg border border-white/5 bg-black/15 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Voice Channels
                    </span>
                    <button type="button" onClick={addBriefingVoiceChannel} className="btn btn-ghost px-3 py-1 text-sm">
                      +
                    </button>
                  </div>
                  <div className="grid gap-2">
                    {settings.briefingVoiceChannels.names.length === 0 ? (
                      <div className="rounded-md border border-white/5 bg-black/20 p-3 text-xs text-zinc-600">
                        No briefing voice channels configured.
                      </div>
                    ) : (
                      settings.briefingVoiceChannels.names.map((name, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            className="input"
                            value={name}
                            onChange={(e) => updateBriefingVoiceChannel(index, e.target.value)}
                            placeholder={`Voice channel ${index + 1}`}
                          />
                          <button
                            type="button"
                            onClick={() => removeBriefingVoiceChannel(index)}
                            className="btn btn-ghost px-3 text-zinc-400 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/15 px-3 py-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={settings.briefingVoiceChannels.autoDelete}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          briefingVoiceChannels: {
                            ...settings.briefingVoiceChannels,
                            autoDelete: e.target.checked,
                          },
                        })
                      }
                    />
                    Auto delete created channels
                  </label>
                  <label className="block">
                    <span className="label">Minutes</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      disabled={!settings.briefingVoiceChannels.autoDelete}
                      value={settings.briefingVoiceChannels.deleteAfterMinutes ?? ''}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          briefingVoiceChannels: {
                            ...settings.briefingVoiceChannels,
                            deleteAfterMinutes: e.target.value ? Number(e.target.value) : null,
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
          </SettingsPanel>

          <SettingsPanel title="Roster Discord Emojis">
            <div className="grid gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <EmojiGroup title="Status">
                  {(
                    [
                      ['accepted', 'Accepted'],
                      ['declined', 'Declined'],
                      ['pending', 'Pending'],
                    ] as const
                  ).map(([key, label]) => (
                    <EmojiTile key={key} label={label}>
                      <EmojiSelect
                        emojis={emojis}
                        value={settings.rosterEmojis.status?.[key] ?? ''}
                        onChange={(value) => updateRosterEmoji('status', key, value)}
                      />
                    </EmojiTile>
                  ))}
                </EmojiGroup>

                <EmojiGroup title="Buttons">
                  {(
                    [
                      ['confirm', 'Confirm'],
                      ['decline', 'Decline'],
                    ] as const
                  ).map(([key, label]) => (
                    <EmojiTile key={key} label={label}>
                      <EmojiSelect
                        emojis={emojis}
                        value={settings.rosterEmojis.buttons?.[key] ?? ''}
                        onChange={(value) => updateRosterEmoji('buttons', key, value)}
                      />
                    </EmojiTile>
                  ))}
                </EmojiGroup>
              </div>

              <EmojiGroup title="Slots">
                {SLOT_EMOJI_FIELDS.map(([key, label]) => (
                  <EmojiTile key={key} label={label}>
                    <EmojiSelect
                      emojis={emojis}
                      value={settings.rosterEmojis.slots?.[key] ?? ''}
                      onChange={(value) => updateRosterEmoji('slots', key, value)}
                    />
                  </EmojiTile>
                ))}
              </EmojiGroup>

              <EmojiGroup title="Extra Roles">
                {ROLE_EMOJI_FIELDS.map(([key, label]) => (
                  <EmojiTile key={key} label={label}>
                    <EmojiSelect
                      emojis={emojis}
                      value={settings.rosterEmojis.roles?.[key] ?? ''}
                      onChange={(value) => updateRosterEmoji('roles', key, value)}
                    />
                  </EmojiTile>
                ))}
              </EmojiGroup>
            </div>
          </SettingsPanel>
        </div>

        <div className="min-w-0 space-y-4">
          <SettingsPanel title="Admin Access">
            <RoleChecklist
              title="Dashboard Roles"
              roles={roles}
              selectedIds={adminRoleIds}
              noRoles={noRoles}
              maxHeightClass="max-h-64"
              onToggle={toggleAdminRole}
            />
          </SettingsPanel>

          <SettingsPanel title="Game ID Import">
            <div className="space-y-3">
              <label className="btn btn-ghost inline-flex cursor-pointer">
                {importBusy ? 'Importing...' : 'Upload JSON'}
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  disabled={importBusy}
                  onChange={onGameIdImportFile}
                />
              </label>
              {importError && (
                <p className="text-sm text-red-400">{importError}</p>
              )}
              {importResult && (
                <div className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
                  <ImportStat label="Rows" value={importResult.rows} />
                  <ImportStat label="Parsed" value={importResult.parsed} />
                  <ImportStat label="Matched" value={importResult.matched} />
                  <ImportStat label="Updated" value={importResult.updated} />
                  <ImportStat label="Missing" value={importResult.missingUser} />
                  <ImportStat label="Invalid IDs" value={importResult.invalidGameId} />
                </div>
              )}
            </div>
          </SettingsPanel>

          <SettingsPanel title="Role Groups">
            <div className="grid gap-4">
              <RoleSelect
                title="Temporary Squad Leader Role"
                roles={roles}
                value={settings.squadLeaderRoleId ?? ''}
                noRoles={noRoles}
                onChange={(squadLeaderRoleId) => setSettings({ ...settings, squadLeaderRoleId: squadLeaderRoleId || null })}
              />
              <p className="-mt-2 text-xs text-zinc-500">
                Optional role assigned to roster commanders, artillery, spotters, tank commanders, and squad leaders when enabled at first publish. Remove it later with the manual cleanup button on a roster page.
              </p>
              <RoleChecklist
                title="Member Roles"
                roles={roles}
                selectedIds={memberRoleIds}
                noRoles={noRoles}
                maxHeightClass="max-h-72"
                onToggle={toggleMemberRole}
              />
              <RoleChecklist
                title="Collab Roles"
                roles={roles}
                selectedIds={collabRoleIds}
                noRoles={noRoles}
                maxHeightClass="max-h-72"
                onToggle={toggleCollabRole}
              />
              <div className="grid gap-4 lg:grid-cols-4">
                <RoleSelect
                  title="Recruit"
                  roles={roles}
                  value={recruitRankId}
                  noRoles={noRoles}
                  onChange={(roleId) => setRankRole('recruit', roleId)}
                />
                <RoleSelect
                  title="Member"
                  roles={roles}
                  value={memberRankId}
                  noRoles={noRoles}
                  onChange={(roleId) => setRankRole('member', roleId)}
                />
                <RoleSelect
                  title="Competitive"
                  roles={roles}
                  value={competitiveRankId}
                  noRoles={noRoles}
                  onChange={(roleId) => setRankRole('competitive', roleId)}
                />
                <RoleSelect
                  title="Collab"
                  roles={roles}
                  value={collabRankId}
                  noRoles={noRoles}
                  onChange={(roleId) => setRankRole('collab', roleId)}
                />
              </div>
            </div>
          </SettingsPanel>

          <SettingsPanel title="Clan Profile">
            <div className="flex flex-wrap items-center gap-4">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Clan logo"
                  className="h-20 w-20 rounded-lg border border-white/10 object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-brand text-lg font-black text-white">
                  HLL
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn btn-ghost cursor-pointer">
                  {logoBusy ? 'Uploading...' : logoUrl ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={logoBusy}
                    onChange={onLogoFile}
                  />
                </label>
                {logoUrl && (
                  <button
                    onClick={removeLogo}
                    disabled={logoBusy}
                    className="btn btn-ghost text-zinc-400 hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {logoError && (
              <p className="mt-3 text-xs text-red-400">{logoError}</p>
            )}
          </SettingsPanel>

          <SettingsPanel title="RCON">
            <div className="grid gap-4">
              <label className="block">
                <span className="label">API URL</span>
                <input
                  className="input"
                  value={settings.rconApiUrl ?? ''}
                  onChange={(e) => setSettings({ ...settings, rconApiUrl: e.target.value })}
                  placeholder="http://45.151.81.182:8010/"
                />
              </label>
              <label className="block">
                <span className="label">API Token</span>
                <input
                  className="input"
                  type="password"
                  value={settings.rconApiToken ?? ''}
                  onChange={(e) => setSettings({ ...settings, rconApiToken: e.target.value })}
                  placeholder="RCON API token"
                />
              </label>
            </div>
          </SettingsPanel>

        </div>
      </div>

      <div className="sticky bottom-0 z-20 border-t border-white/10 bg-zinc-950/90 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saved && (
            <span className="badge bg-emerald-500/10 text-emerald-400">
              Saved
            </span>
          )}
          {noChannels && (
            <span className="text-xs text-zinc-600">
              No text channels loaded - run a Discord sync.
            </span>
          )}
          {noVoiceChannels && (
            <span className="text-xs text-zinc-600">
              No voice channels loaded - run a Discord sync.
            </span>
          )}
          {noCategories && (
            <span className="text-xs text-zinc-600">
              No categories loaded - run a Discord sync.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="card min-w-0 p-5">
      <div className="mb-4 border-b border-white/5 pb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function RoleChecklist({
  title,
  roles,
  selectedIds,
  noRoles,
  maxHeightClass,
  onToggle,
}: {
  title: string;
  roles: RoleOption[];
  selectedIds: Set<string>;
  noRoles: boolean;
  maxHeightClass: string;
  onToggle: (role: RoleOption, checked: boolean) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
          {selectedIds.size}
        </span>
      </div>
      {noRoles ? (
        <div className="rounded-lg border border-white/5 bg-black/20 p-4 text-xs text-zinc-500">
          No roles loaded yet.
        </div>
      ) : (
        <div className={`${maxHeightClass} min-w-0 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-1`}>
          {roles.map((r) => {
            const checked = selectedIds.has(r.id);
            return (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={checked}
                  onChange={(e) => onToggle(r, e.target.checked)}
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      r.color && r.color !== '#000000' ? r.color : '#6b7280',
                  }}
                />
                <span className={checked ? 'truncate text-sm text-zinc-100' : 'truncate text-sm text-zinc-400'}>
                  {r.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleSelect({
  title,
  roles,
  value,
  noRoles,
  onChange,
}: {
  title: string;
  roles: RoleOption[];
  value: string;
  noRoles: boolean;
  onChange: (roleId: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="label">{title}</span>
      <select
        className="input"
        value={value}
        disabled={noRoles}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{noRoles ? 'No roles loaded' : '-- none --'}</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-zinc-200">{value}</div>
    </div>
  );
}

function EmojiGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-white/5 bg-black/15 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function EmojiTile({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/5 bg-white/[0.02] p-2">
      <span className="mb-1.5 block truncate text-xs text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function EmojiSelect({
  emojis,
  value,
  onChange,
}: {
  emojis: DiscordEmojiOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = emojis.find((e) => e.code === value);
  const filtered = emojis.filter((e) =>
    e.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const customValue = value && !selected ? value : '';

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-left text-sm text-zinc-200 outline-none hover:border-white/20"
      >
        {selected?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={selected.url} alt="" className="h-5 w-5 shrink-0 object-contain" />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/[0.04] text-[10px] text-zinc-500">
            {customValue ? 'custom' : '-'}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {selected?.name ?? (customValue || 'Use default')}
        </span>
        <span className="text-xs text-zinc-600">v</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-[min(18rem,calc(100vw-3rem))] max-w-full rounded-lg border border-white/10 bg-zinc-950 p-2 shadow-xl shadow-black/40">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emojis..."
            className="mb-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/20"
          />
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
              setQuery('');
            }}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.04] text-[10px]">
              -
            </span>
            Use default
          </button>
          {customValue && (
            <div className="mb-1 truncate rounded-md border border-brand/20 bg-brand/10 px-2 py-1.5 text-xs text-brand-bright">
              Current custom value: {customValue}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto pr-1">
            {filtered.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                onClick={() => {
                  onChange(emoji.code);
                  setOpen(false);
                  setQuery('');
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/[0.05] ${
                  emoji.code === value ? 'bg-brand/15 text-brand-bright' : 'text-zinc-300'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={emoji.url} alt="" className="h-5 w-5 object-contain" />
                <span className="min-w-0 flex-1 truncate">{emoji.name}</span>
                {emoji.animated && <span className="text-[10px] uppercase text-zinc-600">gif</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-zinc-600">
                No server emojis found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function mergeRosterEmojis(input: unknown): RosterEmojiSettings {
  const src = (input && typeof input === 'object' ? input : {}) as RosterEmojiSettings;
  return {
    status: {
      ...DEFAULT_ROSTER_EMOJIS.status,
      ...(src.status ?? {}),
    },
    buttons: {
      ...DEFAULT_ROSTER_EMOJIS.buttons,
      ...(src.buttons ?? {}),
    },
    slots: {
      ...DEFAULT_ROSTER_EMOJIS.slots,
      ...(src.slots ?? {}),
    },
    roles: {
      ...DEFAULT_ROSTER_EMOJIS.roles,
      ...(src.roles ?? {}),
    },
  };
}

function normalizeRankRoles(input: unknown): RankRoleSettings {
  if (Array.isArray(input)) {
    return {
      ...EMPTY_RANK_ROLES,
      member: cleanRoleOptions(input),
    };
  }
  if (!input || typeof input !== 'object') return EMPTY_RANK_ROLES;
  const src = input as Partial<Record<keyof RankRoleSettings, unknown>>;
  return {
    recruit: cleanRoleOptions(src.recruit),
    member: cleanRoleOptions(src.member),
    competitive: cleanRoleOptions(src.competitive),
    collab: cleanRoleOptions(src.collab),
  };
}

function cleanRoleOptions(input: unknown): RoleOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((role) => {
      if (!role || typeof role !== 'object' || !('id' in role)) return null;
      const id = typeof role.id === 'string' ? role.id.trim() : '';
      if (!id) return null;
      const name =
        'name' in role && typeof role.name === 'string' && role.name.trim()
          ? role.name.trim()
          : id;
      return { id, name };
    })
    .filter((role): role is RoleOption => Boolean(role));
}

function normalizeMemberRoleIds(input: Partial<Settings> | null | undefined) {
  const clean = normalizeRoleIds(input?.memberRoleIds);
  if (input?.memberRoleId?.trim()) clean.push(input.memberRoleId.trim());
  return [...new Set(clean)];
}

function normalizeBriefingVoiceChannels(input: unknown): BriefingVoiceChannelSettings {
  if (!input || typeof input !== 'object') return EMPTY_BRIEFING_VOICE_CHANNELS;
  const src = input as Partial<BriefingVoiceChannelSettings>;
  const categoryId = typeof src.categoryId === 'string' && src.categoryId.trim() ? src.categoryId.trim() : null;
  const names = Array.isArray(src.names) ? src.names.filter((name): name is string => typeof name === 'string') : [];
  const autoDelete = Boolean(src.autoDelete);
  const deleteAfterMinutes = typeof src.deleteAfterMinutes === 'number' && src.deleteAfterMinutes > 0
    ? src.deleteAfterMinutes
    : null;
  return { categoryId, names, autoDelete, deleteAfterMinutes };
}

function normalizeRoleIds(input: unknown) {
  const ids = Array.isArray(input) ? input : [];
  return [
    ...new Set(
      ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())),
    ),
  ];
}
