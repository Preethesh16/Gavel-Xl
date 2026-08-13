import type { FormationSlot, RoomMemberView, SquadEntryView } from '@gavel-xi/shared';

type PitchSlot = Pick<FormationSlot, 'id' | 'label' | 'position' | 'x' | 'y'>;

const coordinates = {
  GK: [50, 89],
  LB: [14, 70],
  LCB: [36, 76],
  CB: [50, 76],
  RCB: [64, 76],
  RB: [86, 70],
  LWB: [14, 59],
  RWB: [86, 59],
  LDM: [35, 56],
  DM: [50, 58],
  RDM: [65, 56],
  LCM: [32, 47],
  CM: [50, 47],
  RCM: [68, 47],
  LAM: [31, 35],
  AM: [50, 34],
  RAM: [69, 35],
  LW: [17, 24],
  LS: [36, 18],
  ST: [50, 15],
  RS: [64, 18],
  RW: [83, 24],
} as const;

function slot(
  id: keyof typeof coordinates,
  label: string,
  position: PitchSlot['position'],
): PitchSlot {
  const [x, y] = coordinates[id];
  return { id, label, position, x, y };
}

export const FORMATION_PITCHES: Record<string, PitchSlot[]> = {
  '4-2-1-3': [
    slot('GK', 'GK', 'GK'),
    slot('LB', 'LB', 'LB'),
    slot('LCB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('RB', 'RB', 'RB'),
    slot('LDM', 'CM/DM', 'CM'),
    slot('RDM', 'CM/DM', 'DM'),
    slot('AM', 'AM', 'AM'),
    slot('LW', 'LW', 'LW'),
    slot('ST', 'ST', 'ST'),
    slot('RW', 'RW', 'RW'),
  ],
  '4-3-3': [
    slot('GK', 'GK', 'GK'),
    slot('LB', 'LB', 'LB'),
    slot('LCB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('RB', 'RB', 'RB'),
    slot('LCM', 'CM', 'CM'),
    slot('DM', 'DM', 'DM'),
    slot('RCM', 'CM', 'CM'),
    slot('LW', 'LW', 'LW'),
    slot('ST', 'ST', 'ST'),
    slot('RW', 'RW', 'RW'),
  ],
  '4-2-3-1': [
    slot('GK', 'GK', 'GK'),
    slot('LB', 'LB', 'LB'),
    slot('LCB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('RB', 'RB', 'RB'),
    slot('LDM', 'DM', 'DM'),
    slot('RDM', 'CM', 'CM'),
    slot('LAM', 'AM', 'AM'),
    slot('AM', 'AM', 'AM'),
    slot('RAM', 'AM', 'AM'),
    slot('ST', 'ST', 'ST'),
  ],
  '4-4-2': [
    slot('GK', 'GK', 'GK'),
    slot('LB', 'LB', 'LB'),
    slot('LCB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('RB', 'RB', 'RB'),
    slot('LW', 'LM', 'LW'),
    slot('LCM', 'CM', 'CM'),
    slot('RCM', 'CM', 'CM'),
    slot('RW', 'RM', 'RW'),
    slot('LS', 'ST', 'ST'),
    slot('RS', 'ST', 'ST'),
  ],
  '3-4-2-1': [
    slot('GK', 'GK', 'GK'),
    slot('LCB', 'CB', 'CB'),
    slot('CB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('LWB', 'LWB', 'LWB'),
    slot('LCM', 'CM', 'CM'),
    slot('RCM', 'CM', 'CM'),
    slot('RWB', 'RWB', 'RWB'),
    slot('LAM', 'AM', 'AM'),
    slot('RAM', 'AM', 'AM'),
    slot('ST', 'ST', 'ST'),
  ],
  '3-5-2': [
    slot('GK', 'GK', 'GK'),
    slot('LCB', 'CB', 'CB'),
    slot('CB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('LWB', 'LWB', 'LWB'),
    slot('LCM', 'CM', 'CM'),
    slot('DM', 'DM', 'DM'),
    slot('RCM', 'CM', 'CM'),
    slot('RWB', 'RWB', 'RWB'),
    slot('LS', 'ST', 'ST'),
    slot('RS', 'ST', 'ST'),
  ],
  '5-2-1-2': [
    slot('GK', 'GK', 'GK'),
    slot('LWB', 'LWB', 'LWB'),
    slot('LCB', 'CB', 'CB'),
    slot('CB', 'CB', 'CB'),
    slot('RCB', 'CB', 'CB'),
    slot('RWB', 'RWB', 'RWB'),
    slot('LCM', 'CM', 'CM'),
    slot('RCM', 'CM', 'CM'),
    slot('AM', 'AM', 'AM'),
    slot('LS', 'ST', 'ST'),
    slot('RS', 'ST', 'ST'),
  ],
};

export interface LineupEntry {
  slot: PitchSlot;
  entry: SquadEntryView | null;
}

export function buildLineup(
  formation: string,
  member: RoomMemberView,
  entries: SquadEntryView[],
): LineupEntry[] {
  const available = entries.filter((entry) => entry.memberId === member.id);
  const used = new Set<string>();
  return (FORMATION_PITCHES[formation] ?? FORMATION_PITCHES['4-2-1-3'] ?? []).map((pitchSlot) => {
    const exact = available.find((entry) => !used.has(entry.id) && entry.slotId === pitchSlot.id);
    const compatible =
      exact ??
      available.find((entry) => {
        if (used.has(entry.id) || entry.candidate.kind === 'MANAGER') return false;
        const positions = entry.candidate.positions;
        if (positions.includes(pitchSlot.position)) return true;
        if (pitchSlot.position === 'CM')
          return positions.includes('DM') || positions.includes('AM');
        if (pitchSlot.position === 'LWB')
          return positions.includes('LB') || positions.includes('LW');
        if (pitchSlot.position === 'RWB')
          return positions.includes('RB') || positions.includes('RW');
        return false;
      });
    if (compatible) used.add(compatible.id);
    return { slot: pitchSlot, entry: compatible ?? null };
  });
}
