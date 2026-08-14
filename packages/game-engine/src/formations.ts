import type { Formation, FormationSlot, Position } from '@gavel-xi/shared';
import type { RoomSettingsInput } from '@gavel-xi/shared';

export type FormationName = RoomSettingsInput['formation'];

interface SlotTemplate {
  readonly label: string;
  readonly position: Position;
  readonly compatiblePositions: readonly Position[];
  readonly x: number;
  readonly y: number;
}

const slot = (
  label: string,
  position: Position,
  compatiblePositions: readonly Position[],
  x: number,
  y: number,
): SlotTemplate => ({ label, position, compatiblePositions, x, y });

const GK = slot('GK', 'GK', ['GK'], 50, 92);
const LB = slot('LB', 'LB', ['LB'], 13, 72);
const LCB = slot('CB', 'CB', ['CB'], 37, 78);
const RCB = slot('CB', 'CB', ['CB'], 63, 78);
const RB = slot('RB', 'RB', ['RB'], 87, 72);
// Wing-back is the tactical slot label. The catalog's verified source position
// is full-back, so these slots recruit exact LB/RB players instead of inventing
// a second position or borrowing an unrelated role.
const LWB = slot('LWB', 'LB', ['LB'], 11, 61);
const RWB = slot('RWB', 'RB', ['RB'], 89, 61);
const LDM = slot('DM', 'DM', ['DM'], 37, 59);
const RDM = slot('DM', 'DM', ['DM'], 63, 59);
const LCM = slot('CM', 'CM', ['CM'], 29, 53);
const CM = slot('CM', 'CM', ['CM'], 50, 56);
const RCM = slot('CM', 'CM', ['CM'], 71, 53);
const LM = slot('LM', 'LW', ['LW'], 14, 47);
const RM = slot('RM', 'RW', ['RW'], 86, 47);
const AM = slot('AM', 'AM', ['AM'], 50, 38);
const LAM = slot('AM', 'AM', ['AM'], 34, 35);
const RAM = slot('AM', 'AM', ['AM'], 66, 35);
const LW = slot('LW', 'LW', ['LW'], 17, 20);
const RW = slot('RW', 'RW', ['RW'], 83, 20);
const ST = slot('ST', 'ST', ['ST'], 50, 12);
const LST = slot('ST', 'ST', ['ST'], 38, 14);
const RST = slot('ST', 'ST', ['ST'], 62, 14);
const MANAGER = slot('Manager', 'MANAGER', ['MANAGER'], 50, 102);

const templates: Record<FormationName, readonly SlotTemplate[]> = {
  '4-2-1-3': [GK, LB, LCB, RCB, RB, LDM, RDM, AM, LW, ST, RW, MANAGER],
  '4-3-3': [GK, LB, LCB, RCB, RB, LCM, CM, RCM, LW, ST, RW, MANAGER],
  '4-2-3-1': [GK, LB, LCB, RCB, RB, LDM, RDM, LAM, AM, RAM, ST, MANAGER],
  '4-4-2': [GK, LB, LCB, RCB, RB, LM, LCM, RCM, RM, LST, RST, MANAGER],
  '3-4-2-1': [
    GK,
    { ...LCB, x: 25 },
    { ...LCB, x: 50 },
    { ...RCB, x: 75 },
    LWB,
    LCM,
    RCM,
    RWB,
    LAM,
    RAM,
    ST,
    MANAGER,
  ],
  '3-5-2': [
    GK,
    { ...LCB, x: 25 },
    { ...LCB, x: 50 },
    { ...RCB, x: 75 },
    LWB,
    LCM,
    CM,
    RCM,
    RWB,
    LST,
    RST,
    MANAGER,
  ],
  '5-2-1-2': [
    GK,
    LB,
    { ...LCB, x: 30 },
    { ...LCB, x: 50 },
    { ...RCB, x: 70 },
    RB,
    LCM,
    RCM,
    AM,
    LST,
    RST,
    MANAGER,
  ],
};

function materialize(name: FormationName): Formation {
  const counts = new Map<Position, number>();
  const slots: FormationSlot[] = templates[name].map((template) => {
    const cycleIndex = counts.get(template.position) ?? 0;
    counts.set(template.position, cycleIndex + 1);
    return {
      id: `${template.position.toLowerCase()}-${cycleIndex + 1}`,
      label: template.label,
      position: template.position,
      compatiblePositions: [...template.compatiblePositions],
      x: template.x,
      y: template.y,
      cycleIndex,
    };
  });
  return { name, slots };
}

export const FORMATIONS: Readonly<Record<FormationName, Formation>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(templates) as FormationName[]).map((name) => [name, materialize(name)]),
  ) as Record<FormationName, Formation>,
);

/** Compatibility name used by state adapters. Presets must be treated as immutable. */
export const FORMATION_PRESETS: Readonly<Record<FormationName, Formation>> = FORMATIONS;

export const FORMATION_NAMES = Object.freeze(Object.keys(FORMATIONS) as FormationName[]);

export function resolveFormation(name: FormationName): Formation {
  const formation = FORMATIONS[name];
  return {
    name: formation.name,
    slots: formation.slots.map((formationSlot) => ({
      ...formationSlot,
      compatiblePositions: [...formationSlot.compatiblePositions],
    })),
  };
}

export const getFormation = resolveFormation;

export function isPositionCompatible(slot: FormationSlot, positions: readonly Position[]): boolean {
  return slot.compatiblePositions.some((position) => positions.includes(position));
}
