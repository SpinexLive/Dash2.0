// Squad/role configuration for the roster builder. Icons live in /public/icons.

export interface RoleDef {
  key: string;
  name: string;
  icon: string;
}

export interface SlotDef {
  label: string;
  icon: string;
  kind: SlotKind;
}

export type SlotKind =
  | 'commander'
  | 'squadLeader'
  | 'infantry'
  | 'tankCommander'
  | 'gunner'
  | 'driver'
  | 'spotter'
  | 'sniper'
  | 'artillery';

export interface SquadTypeDef {
  type: string;
  name: string;
  icon: string;
  /** Always-present slots. */
  required: SlotDef[];
  /** Toggleable slots (enabled by default when a squad is created). */
  optional: SlotDef[];
  /** Infantry squads use configurable SL/infantry counts instead of fixed slots. */
  configurable?: boolean;
}

const ICON = (file: string) => `/icons/${file}`;

/** Draggable roles that can be attached to an assigned player. */
export const ROLES: RoleDef[] = [
  { key: 'engineer', name: 'Engineer', icon: ICON('Engineer.png') },
  { key: 'anti-tank', name: 'Anti-Tank', icon: ICON('antitank.png') },
  { key: 'mg', name: 'Machine Gun', icon: ICON('heavy mg.png') },
  { key: 'garrison', name: 'Garrison', icon: ICON('garrison.png') },
  { key: 'sniper', name: 'Sniper', icon: ICON('sniper.png') },
  { key: 'supplies', name: 'Supplies', icon: ICON('support.png') },
  { key: 'supply-truck', name: 'Supply Truck', icon: ICON('supplytruck.png') },
  { key: 'at-gun', name: 'AT Gun', icon: ICON('atgun.png') },
];

export const SL_SLOT: SlotDef = {
  label: 'Squad Leader',
  icon: ICON('squadleader.png'),
  kind: 'squadLeader',
};
export const INF_SLOT: SlotDef = { label: 'Infantry', icon: ICON('infantry.png'), kind: 'infantry' };

/** Default counts for a new infantry squad. */
export const INFANTRY_DEFAULT = { squadLeaders: 2, infantry: 5 };

/** Slot kinds that count toward the squad-leader cap. */
export const LEADERSHIP_KINDS: SlotKind[] = [
  'squadLeader',
  'tankCommander',
  'spotter',
  'artillery',
];
export const SL_MAX = 20;

/** Squad templates the user can add to a roster (in display order). */
export const SQUAD_TYPES: SquadTypeDef[] = [
  {
    type: 'commander',
    name: 'Commander',
    icon: ICON('commander.png'),
    required: [{ label: 'Commander', icon: ICON('commander.png'), kind: 'commander' }],
    optional: [],
  },
  {
    type: 'artillery',
    name: 'Artillery',
    icon: ICON('artillery.png'),
    required: [{ label: 'Gunner', icon: ICON('artillery.png'), kind: 'artillery' }],
    optional: [],
  },
  {
    type: 'recon',
    name: 'Recon',
    icon: ICON('spotter.png'),
    required: [{ label: 'Spotter', icon: ICON('spotter.png'), kind: 'spotter' }],
    optional: [{ label: 'Sniper', icon: ICON('sniper.png'), kind: 'sniper' }],
  },
  {
    type: 'armour',
    name: 'Armour',
    icon: ICON('armour.png'),
    required: [
      { label: 'Tank Commander', icon: ICON('tankcommander.png'), kind: 'tankCommander' },
    ],
    optional: [
      { label: 'Gunner', icon: ICON('tankcrewman.png'), kind: 'gunner' },
      { label: 'Driver', icon: ICON('driver.png'), kind: 'driver' },
    ],
  },
  {
    type: 'infantry',
    name: 'Infantry',
    icon: ICON('infantry.png'),
    required: [],
    optional: [],
    configurable: true,
  },
];

export function squadTemplate(type: string): SquadTypeDef | undefined {
  return SQUAD_TYPES.find((s) => s.type === type);
}
