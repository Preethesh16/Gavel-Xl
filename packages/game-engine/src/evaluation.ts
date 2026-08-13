import type {
  CandidateSnapshot,
  EvaluationView,
  MetricScoreView,
  Position,
  RoleProfile,
  SquadEntryView,
  TacticalProfile,
  TeamResultView,
} from '@gavel-xi/shared';
import { METRIC_CATEGORIES, METRIC_NAMES } from './metrics.js';
import { formRating, type FormLookback } from './ratings.js';

const ROLE_KEYS: Array<keyof RoleProfile> = [
  'pace',
  'physical',
  'technique',
  'creativity',
  'defending',
  'aerial',
  'passing',
  'finishing',
  'pressing',
  'composure',
];

const DEFAULT_TACTICS: TacticalProfile = {
  possession: 50,
  pressing: 50,
  transition: 50,
  lowBlock: 50,
  highLine: 50,
  directness: 50,
  widthPreference: 50,
  buildUpRisk: 50,
  tacticalFlexibility: 50,
};

interface TeamFeatures {
  memberId: string;
  formLookback: FormLookback;
  players: CandidateSnapshot[];
  positioned: Array<{ position: Exclude<Position, 'MANAGER'>; player: CandidateSnapshot }>;
  manager: CandidateSnapshot | null;
  entries: SquadEntryView[];
  role: RoleProfile;
  attack: number;
  midfield: number;
  defence: number;
  goalkeeping: number;
  tactics: number;
  technical: number;
  physical: number;
  mentality: number;
  chemistry: number;
  situations: number;
  availability: number;
  form: number;
  valueEfficiency: number;
  squadMarketValueEUR: number;
  spentEUR: number;
  remainingEUR: number;
}

export interface EvaluationInput {
  memberIds: string[];
  squads: SquadEntryView[];
  initialBudgets: Record<string, number>;
  seed: string;
  seedCommitment: string;
  formLookback: FormLookback;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(clamp(value) * 10) / 10;
}

function average(values: number[], fallback = 50): number {
  return values.length === 0
    ? fallback
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roleAverage(players: CandidateSnapshot[]): RoleProfile {
  return Object.fromEntries(
    ROLE_KEYS.map((key) => [key, average(players.map((player) => player.role[key]))]),
  ) as unknown as RoleProfile;
}

const PLAYER_POSITIONS = new Set<Exclude<Position, 'MANAGER'>>([
  'GK',
  'LB',
  'CB',
  'RB',
  'LWB',
  'RWB',
  'DM',
  'CM',
  'AM',
  'LW',
  'RW',
  'ST',
]);

function assignedPosition(entry: SquadEntryView): Exclude<Position, 'MANAGER'> {
  const slotPosition = entry.slotId.split('-')[0]?.toUpperCase();
  if (PLAYER_POSITIONS.has(slotPosition as Exclude<Position, 'MANAGER'>)) {
    return slotPosition as Exclude<Position, 'MANAGER'>;
  }
  return entry.candidate.preferredPosition as Exclude<Position, 'MANAGER'>;
}

function group(
  positioned: TeamFeatures['positioned'],
  positions: readonly Exclude<Position, 'MANAGER'>[],
): CandidateSnapshot[] {
  const allowed = new Set(positions);
  return positioned.filter(({ position }) => allowed.has(position)).map(({ player }) => player);
}

function compatibility(manager: CandidateSnapshot | null, role: RoleProfile): number {
  const tactics = manager?.tactics ?? DEFAULT_TACTICS;
  const system = [
    100 - Math.abs(tactics.possession - role.passing),
    100 - Math.abs(tactics.pressing - role.pressing),
    100 - Math.abs(tactics.transition - average([role.pace, role.creativity])),
    100 - Math.abs(tactics.highLine - average([role.pace, role.defending])),
    100 - Math.abs(tactics.directness - average([role.finishing, role.aerial])),
    tactics.tacticalFlexibility,
  ];
  return average(system);
}

function buildFeatures(
  memberId: string,
  entries: SquadEntryView[],
  initialBudget: number,
  formLookback: FormLookback,
): TeamFeatures {
  const owned = entries.filter((entry) => entry.memberId === memberId);
  const playerEntries = owned.filter((entry) => entry.candidate.kind === 'PLAYER');
  const positioned = playerEntries.map((entry) => ({
    position: assignedPosition(entry),
    player: entry.candidate,
  }));
  const players = positioned.map(({ player }) => player);
  const manager = owned.find((entry) => entry.candidate.kind === 'MANAGER')?.candidate ?? null;
  const attackers = group(positioned, ['LW', 'RW', 'ST', 'AM']);
  const midfielders = group(positioned, ['DM', 'CM', 'AM']);
  const defenders = group(positioned, ['LB', 'CB', 'RB', 'LWB', 'RWB', 'DM']);
  const keepers = group(positioned, ['GK']);
  const role = roleAverage(players);
  const attack = average(
    attackers.map((player) =>
      average([
        formRating(player, formLookback),
        player.role.finishing,
        player.role.creativity,
        player.role.pace,
      ]),
    ),
  );
  const midfield = average(
    midfielders.map((player) =>
      average([
        formRating(player, formLookback),
        player.role.passing,
        player.role.creativity,
        player.role.pressing,
      ]),
    ),
  );
  const defence = average(
    defenders.map((player) =>
      average([
        formRating(player, formLookback),
        player.role.defending,
        player.role.aerial,
        player.role.pace,
      ]),
    ),
  );
  const goalkeeping = average(
    keepers.map((player) =>
      average([
        formRating(player, formLookback),
        player.role.defending,
        player.role.composure,
        player.role.aerial,
        player.role.passing,
        clamp((player.cleanSheets / Math.max(1, player.appearances)) * 200),
      ]),
    ),
  );
  const managerRating = manager === null ? 50 : formRating(manager, formLookback);
  const managerFit = compatibility(manager, role);
  const tactics = average([managerRating, managerFit, manager?.tactics?.tacticalFlexibility ?? 50]);
  const technical = average([role.technique, role.passing, role.creativity, role.finishing]);
  const physical = average([role.pace, role.physical, role.aerial, role.pressing]);
  const mentality = average([
    role.composure,
    average(players.map((player) => player.availabilityRating)),
    average(players.map((player) => formRating(player, formLookback))),
  ]);
  const sideBalance = 100 - Math.abs(attack - defence) * 0.7;
  const unitSpread =
    Math.max(attack, midfield, defence, goalkeeping) -
    Math.min(attack, midfield, defence, goalkeeping);
  const chemistry = average([managerFit, sideBalance, 100 - unitSpread]);
  const situations = average([attack, midfield, defence, goalkeeping, tactics, chemistry]);
  const squadMarketValueEUR = owned.reduce((sum, entry) => sum + (entry.marketValueEUR ?? 0), 0);
  const spentEUR = owned.reduce((sum, entry) => sum + entry.purchasePriceEUR, 0);
  const rawEfficiency = spentEUR <= 0 ? 0 : squadMarketValueEUR / spentEUR;
  const valueEfficiency = clamp(
    45 +
      (rawEfficiency - 1) * 30 +
      (average(players.map((player) => formRating(player, formLookback))) - 70) * 0.25,
  );
  return {
    memberId,
    formLookback,
    players,
    positioned,
    manager,
    entries: owned,
    role,
    attack,
    midfield,
    defence,
    goalkeeping,
    tactics,
    technical,
    physical,
    mentality,
    chemistry,
    situations,
    availability: average(players.map((player) => player.availabilityRating)),
    form: average(players.map((player) => formRating(player, formLookback))),
    valueEfficiency,
    squadMarketValueEUR,
    spentEUR,
    remainingEUR: Math.max(0, initialBudget - spentEUR),
  };
}

type PlayerPosition = Exclude<Position, 'MANAGER'>;
type Signal = (team: TeamFeatures) => number;
type MetricEvaluator = (team: TeamFeatures) => number;

const GK = ['GK'] as const;
const CB = ['CB'] as const;
const FB = ['LB', 'LWB', 'RB', 'RWB'] as const;
const LEFT_FB = ['LB', 'LWB'] as const;
const RIGHT_FB = ['RB', 'RWB'] as const;
const DM = ['DM'] as const;
const CM = ['CM'] as const;
const AM = ['AM'] as const;
const LW = ['LW'] as const;
const RW = ['RW'] as const;
const ST = ['ST'] as const;
const WINGS = ['LW', 'RW'] as const;
const FRONT = ['LW', 'ST', 'RW'] as const;
const ATTACK = ['LW', 'RW', 'ST', 'AM'] as const;
const MIDFIELD = ['DM', 'CM', 'AM'] as const;
const DEFENCE = ['LB', 'LWB', 'CB', 'RB', 'RWB', 'DM'] as const;
const BACK_FOUR = ['LB', 'LWB', 'CB', 'RB', 'RWB'] as const;
const LEFT_SIDE = ['LB', 'LWB', 'LW'] as const;
const RIGHT_SIDE = ['RB', 'RWB', 'RW'] as const;
const SPINE = ['GK', 'CB', 'DM', 'CM', 'AM', 'ST'] as const;
const ALL_OUTFIELD = ['LB', 'LWB', 'CB', 'RB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const;

function unit(team: TeamFeatures, positions: readonly PlayerPosition[]): CandidateSnapshot[] {
  return group(team.positioned, positions);
}

function unitAverage(
  team: TeamFeatures,
  positions: readonly PlayerPosition[],
  value: (player: CandidateSnapshot) => number,
): number {
  return average(unit(team, positions).map(value));
}

function role(positions: readonly PlayerPosition[], key: keyof RoleProfile): Signal {
  return (team) => unitAverage(team, positions, (player) => player.role[key]);
}

function form(positions: readonly PlayerPosition[]): Signal {
  return (team) => unitAverage(team, positions, (player) => formRating(player, team.formLookback));
}

function availability(positions: readonly PlayerPosition[]): Signal {
  return (team) => unitAverage(team, positions, (player) => player.availabilityRating);
}

function recent(positions: readonly PlayerPosition[]): Signal {
  return (team) => unitAverage(team, positions, (player) => formRating(player, team.formLookback));
}

function starts(positions: readonly PlayerPosition[]): Signal {
  return (team) =>
    unitAverage(team, positions, (player) =>
      clamp((player.starts / Math.max(1, player.appearances)) * 100),
    );
}

function minutes(positions: readonly PlayerPosition[]): Signal {
  return (team) => unitAverage(team, positions, (player) => clamp((player.minutes / 2_700) * 100));
}

function perNinety(
  positions: readonly PlayerPosition[],
  select: (player: CandidateSnapshot) => number,
  eliteRate: number,
): Signal {
  return (team) =>
    unitAverage(team, positions, (player) =>
      clamp(((select(player) * 90) / Math.max(450, player.minutes) / eliteRate) * 100),
    );
}

const goals = (positions: readonly PlayerPosition[]): Signal =>
  perNinety(positions, (player) => player.goals, 0.8);
const assists = (positions: readonly PlayerPosition[]): Signal =>
  perNinety(positions, (player) => player.assists, 0.55);

function cleanSheets(positions: readonly PlayerPosition[]): Signal {
  return (team) =>
    unitAverage(team, positions, (player) =>
      clamp((player.cleanSheets / Math.max(1, player.appearances)) * 200),
    );
}

function competition(positions: readonly PlayerPosition[]): Signal {
  return (team) => unitAverage(team, positions, (player) => player.competitionStrength);
}

function managerTactic(key: keyof TacticalProfile): Signal {
  return (team) => team.manager?.tactics?.[key] ?? DEFAULT_TACTICS[key];
}

const managerCurrent: Signal = (team) =>
  team.manager === null ? 50 : formRating(team.manager, team.formLookback);
const managerAvailability: Signal = (team) => team.manager?.availabilityRating ?? 50;
const managerFit: Signal = (team) => compatibility(team.manager, team.role);

function teamValue(
  key: keyof Pick<
    TeamFeatures,
    | 'attack'
    | 'midfield'
    | 'defence'
    | 'goalkeeping'
    | 'tactics'
    | 'technical'
    | 'physical'
    | 'mentality'
    | 'chemistry'
    | 'situations'
    | 'availability'
    | 'form'
    | 'valueEfficiency'
  >,
): Signal {
  return (team) => team[key];
}

function blend(...weightedSignals: ReadonlyArray<readonly [Signal, number]>): MetricEvaluator {
  const totalWeight = weightedSignals.reduce((total, [, weight]) => total + weight, 0);
  return (team) =>
    rounded(
      weightedSignals.reduce((total, [signal, weight]) => total + signal(team) * weight, 0) /
        totalWeight,
    );
}

function balance(left: Signal, right: Signal): Signal {
  return (team) => clamp(100 - Math.abs(left(team) - right(team)));
}

function cohesion(
  positions: readonly PlayerPosition[],
  keys: readonly (keyof RoleProfile)[],
): Signal {
  return (team) => {
    const players = unit(team, positions);
    if (players.length === 0) return 50;
    const scores = players.map((player) => average(keys.map((key) => player.role[key])));
    const spread = Math.max(...scores) - Math.min(...scores);
    return clamp(average(scores) * 0.75 + (100 - spread) * 0.25);
  };
}

function bestPlayer(
  positions: readonly PlayerPosition[],
  keys: readonly (keyof RoleProfile)[],
): Signal {
  return (team) => {
    const scores = unit(team, positions).map((player) =>
      average([formRating(player, team.formLookback), ...keys.map((key) => player.role[key])]),
    );
    return scores.length === 0 ? 50 : Math.max(...scores);
  };
}

const lwRwBalance = balance(
  blend([form(LW), 0.4], [role(LW, 'pace'), 0.3], [role(LW, 'creativity'), 0.3]),
  blend([form(RW), 0.4], [role(RW, 'pace'), 0.3], [role(RW, 'creativity'), 0.3]),
);
const fullBackBalance = balance(
  blend([role(LEFT_FB, 'defending'), 0.5], [role(LEFT_FB, 'pace'), 0.5]),
  blend([role(RIGHT_FB, 'defending'), 0.5], [role(RIGHT_FB, 'pace'), 0.5]),
);
const midfieldBalance = cohesion(MIDFIELD, ['passing', 'creativity', 'defending', 'pressing']);
const cbPartnership = cohesion(CB, ['defending', 'aerial', 'pace', 'passing']);
const attackMidfieldConnection = balance(
  blend([role(ATTACK, 'creativity'), 0.5], [role(ATTACK, 'finishing'), 0.5]),
  blend([role(MIDFIELD, 'passing'), 0.5], [role(MIDFIELD, 'creativity'), 0.5]),
);

/** Every named metric owns an explicit, position-scoped model. */
const METRIC_EVALUATORS = {
  'Striker quality': blend(
    [form(ST), 0.35],
    [role(ST, 'finishing'), 0.3],
    [role(ST, 'composure'), 0.2],
    [goals(ST), 0.15],
  ),
  Finishing: blend(
    [role(FRONT, 'finishing'), 0.55],
    [goals(FRONT), 0.2],
    [form(FRONT), 0.15],
    [role(FRONT, 'composure'), 0.1],
  ),
  'Left-wing threat': blend(
    [form(LW), 0.25],
    [role(LW, 'pace'), 0.25],
    [role(LW, 'technique'), 0.2],
    [role(LW, 'creativity'), 0.2],
    [assists(LW), 0.1],
  ),
  'Right-wing threat': blend(
    [form(RW), 0.25],
    [role(RW, 'pace'), 0.25],
    [role(RW, 'technique'), 0.2],
    [role(RW, 'creativity'), 0.2],
    [assists(RW), 0.1],
  ),
  'Front-line creativity': blend(
    [role(FRONT, 'creativity'), 0.45],
    [role(FRONT, 'passing'), 0.2],
    [assists(FRONT), 0.2],
    [form(FRONT), 0.15],
  ),
  'One-v-one ability': blend(
    [role(WINGS, 'technique'), 0.4],
    [role(WINGS, 'pace'), 0.3],
    [role(WINGS, 'creativity'), 0.2],
    [form(WINGS), 0.1],
  ),
  'Counterattacking threat': blend(
    [role(FRONT, 'pace'), 0.35],
    [role(FRONT, 'finishing'), 0.25],
    [form(FRONT), 0.2],
    [managerTactic('transition'), 0.2],
  ),
  'Penalty-box movement': blend(
    [form(ST), 0.3],
    [role(ST, 'finishing'), 0.3],
    [role(ST, 'composure'), 0.2],
    [starts(ST), 0.2],
  ),
  'Aerial attacking threat': blend(
    [role(ST, 'aerial'), 0.55],
    [role(ST, 'physical'), 0.2],
    [form(ST), 0.15],
    [role(FRONT, 'creativity'), 0.1],
  ),
  'Overall attacking balance': blend(
    [teamValue('attack'), 0.45],
    [lwRwBalance, 0.25],
    [attackMidfieldConnection, 0.2],
    [availability(FRONT), 0.1],
  ),

  'Passing quality': blend(
    [role(MIDFIELD, 'passing'), 0.55],
    [role(MIDFIELD, 'technique'), 0.2],
    [form(MIDFIELD), 0.15],
    [managerTactic('possession'), 0.1],
  ),
  'Tempo control': blend(
    [role(CM, 'passing'), 0.35],
    [role(CM, 'composure'), 0.25],
    [role(DM, 'passing'), 0.2],
    [managerTactic('possession'), 0.2],
  ),
  'Press resistance': blend(
    [role(MIDFIELD, 'technique'), 0.4],
    [role(MIDFIELD, 'composure'), 0.35],
    [role(MIDFIELD, 'physical'), 0.15],
    [form(MIDFIELD), 0.1],
  ),
  'Ball progression': blend(
    [role(MIDFIELD, 'passing'), 0.35],
    [role(MIDFIELD, 'creativity'), 0.3],
    [role(MIDFIELD, 'pace'), 0.15],
    [managerTactic('buildUpRisk'), 0.2],
  ),
  'Defensive midfield protection': blend(
    [role(DM, 'defending'), 0.5],
    [role(DM, 'pressing'), 0.2],
    [role(DM, 'physical'), 0.2],
    [form(DM), 0.1],
  ),
  'Midfield pressing': blend(
    [role(MIDFIELD, 'pressing'), 0.5],
    [role(MIDFIELD, 'physical'), 0.2],
    [availability(MIDFIELD), 0.15],
    [managerTactic('pressing'), 0.15],
  ),
  Creativity: blend(
    [role(MIDFIELD, 'creativity'), 0.5],
    [role(MIDFIELD, 'passing'), 0.2],
    [assists(MIDFIELD), 0.2],
    [form(AM), 0.1],
  ),
  'Transition play': blend(
    [role(MIDFIELD, 'pace'), 0.2],
    [role(MIDFIELD, 'passing'), 0.25],
    [role(MIDFIELD, 'pressing'), 0.2],
    [managerTactic('transition'), 0.25],
    [form(MIDFIELD), 0.1],
  ),
  'Ball retention': blend(
    [role(MIDFIELD, 'technique'), 0.35],
    [role(MIDFIELD, 'passing'), 0.35],
    [role(MIDFIELD, 'composure'), 0.2],
    [managerTactic('possession'), 0.1],
  ),
  'Overall midfield balance': blend(
    [teamValue('midfield'), 0.5],
    [midfieldBalance, 0.3],
    [availability(MIDFIELD), 0.1],
    [managerFit, 0.1],
  ),

  'Best centre-back quality': blend(
    [bestPlayer(CB, ['defending', 'aerial', 'pace']), 0.75],
    [form(CB), 0.25],
  ),
  'CB partnership': blend([cbPartnership, 0.6], [form(CB), 0.2], [availability(CB), 0.2]),
  'Full-back defending': blend(
    [role(FB, 'defending'), 0.5],
    [role(FB, 'pace'), 0.2],
    [role(FB, 'physical'), 0.15],
    [form(FB), 0.15],
  ),
  'Full-back attacking': blend(
    [role(FB, 'pace'), 0.25],
    [role(FB, 'passing'), 0.25],
    [role(FB, 'creativity'), 0.25],
    [assists(FB), 0.15],
    [form(FB), 0.1],
  ),
  'One-v-one defending': blend(
    [role(BACK_FOUR, 'defending'), 0.5],
    [role(BACK_FOUR, 'pace'), 0.25],
    [role(BACK_FOUR, 'composure'), 0.15],
    [form(BACK_FOUR), 0.1],
  ),
  'Aerial defending': blend(
    [role(CB, 'aerial'), 0.55],
    [role(CB, 'defending'), 0.25],
    [role(CB, 'physical'), 0.15],
    [form(CB), 0.05],
  ),
  'Recovery defending': blend(
    [role(BACK_FOUR, 'pace'), 0.4],
    [role(BACK_FOUR, 'defending'), 0.35],
    [role(BACK_FOUR, 'pressing'), 0.15],
    [managerTactic('highLine'), 0.1],
  ),
  'Defensive build-up': blend(
    [role(CB, 'passing'), 0.4],
    [role(CB, 'composure'), 0.25],
    [role(FB, 'passing'), 0.15],
    [managerTactic('buildUpRisk'), 0.2],
  ),
  'High-line suitability': blend(
    [role(BACK_FOUR, 'pace'), 0.35],
    [role(BACK_FOUR, 'defending'), 0.25],
    [role(GK, 'pace'), 0.15],
    [managerTactic('highLine'), 0.25],
  ),
  'Overall defensive unit': blend(
    [teamValue('defence'), 0.5],
    [cbPartnership, 0.2],
    [fullBackBalance, 0.15],
    [availability(BACK_FOUR), 0.15],
  ),

  'Shot stopping': blend(
    [role(GK, 'defending'), 0.45],
    [form(GK), 0.25],
    [role(GK, 'composure'), 0.15],
    [cleanSheets(GK), 0.15],
  ),
  Distribution: blend(
    [role(GK, 'passing'), 0.55],
    [role(GK, 'technique'), 0.2],
    [role(GK, 'composure'), 0.15],
    [form(GK), 0.1],
  ),
  Sweeping: blend(
    [role(GK, 'pace'), 0.35],
    [role(GK, 'defending'), 0.3],
    [role(GK, 'composure'), 0.15],
    [managerTactic('highLine'), 0.2],
  ),
  'Cross claiming': blend(
    [role(GK, 'aerial'), 0.55],
    [role(GK, 'physical'), 0.2],
    [role(GK, 'composure'), 0.15],
    [form(GK), 0.1],
  ),
  'Penalty saving': blend(
    [role(GK, 'defending'), 0.4],
    [role(GK, 'composure'), 0.35],
    [recent(GK), 0.25],
  ),
  Reflexes: blend([role(GK, 'pace'), 0.3], [role(GK, 'defending'), 0.45], [form(GK), 0.25]),
  Reliability: blend(
    [availability(GK), 0.25],
    [starts(GK), 0.2],
    [role(GK, 'composure'), 0.2],
    [recent(GK), 0.2],
    [cleanSheets(GK), 0.15],
  ),
  'Big-match performance': blend(
    [recent(GK), 0.4],
    [role(GK, 'composure'), 0.35],
    [competition(GK), 0.15],
    [form(GK), 0.1],
  ),
  'Build-up compatibility': blend(
    [role(GK, 'passing'), 0.35],
    [role(CB, 'passing'), 0.25],
    [managerTactic('possession'), 0.2],
    [managerFit, 0.2],
  ),
  'Overall goalkeeper score': blend(
    [teamValue('goalkeeping'), 0.45],
    [role(GK, 'defending'), 0.25],
    [availability(GK), 0.15],
    [role(GK, 'composure'), 0.15],
  ),

  'Manager current quality': blend(
    [managerCurrent, 0.65],
    [managerAvailability, 0.15],
    [managerTactic('tacticalFlexibility'), 0.2],
  ),
  'Manager-squad compatibility': blend([managerFit, 0.7], [teamValue('chemistry'), 0.3]),
  'Build-up structure': blend(
    [managerTactic('possession'), 0.3],
    [managerTactic('buildUpRisk'), 0.25],
    [role([...GK, ...CB, ...MIDFIELD], 'passing'), 0.3],
    [role([...GK, ...CB, ...MIDFIELD], 'composure'), 0.15],
  ),
  'Positional play': blend(
    [managerTactic('possession'), 0.35],
    [role(MIDFIELD, 'technique'), 0.25],
    [role(MIDFIELD, 'passing'), 0.25],
    [managerFit, 0.15],
  ),
  'Pressing system': blend(
    [managerTactic('pressing'), 0.45],
    [role([...MIDFIELD, ...FRONT], 'pressing'), 0.35],
    [availability([...MIDFIELD, ...FRONT]), 0.2],
  ),
  'Counterattacking structure': blend(
    [managerTactic('transition'), 0.4],
    [managerTactic('directness'), 0.2],
    [role(FRONT, 'pace'), 0.25],
    [role(MIDFIELD, 'passing'), 0.15],
  ),
  'Defensive organisation': blend(
    [managerTactic('lowBlock'), 0.3],
    [role(DEFENCE, 'defending'), 0.35],
    [role(DEFENCE, 'composure'), 0.2],
    [managerFit, 0.15],
  ),
  'Tactical flexibility': blend(
    [managerTactic('tacticalFlexibility'), 0.7],
    [managerCurrent, 0.15],
    [managerFit, 0.15],
  ),
  'In-game adaptability': blend(
    [managerTactic('tacticalFlexibility'), 0.45],
    [managerCurrent, 0.25],
    [managerTactic('transition'), 0.15],
    [managerTactic('directness'), 0.15],
  ),
  'Overall tactical ceiling': blend(
    [teamValue('tactics'), 0.45],
    [managerFit, 0.25],
    [managerCurrent, 0.15],
    [teamValue('chemistry'), 0.15],
  ),

  'First touch': blend(
    [role(ALL_OUTFIELD, 'technique'), 0.65],
    [role(ALL_OUTFIELD, 'composure'), 0.2],
    [form(ALL_OUTFIELD), 0.15],
  ),
  'Close control': blend(
    [role([...MIDFIELD, ...FRONT], 'technique'), 0.6],
    [role([...MIDFIELD, ...FRONT], 'composure'), 0.2],
    [role([...MIDFIELD, ...FRONT], 'pace'), 0.2],
  ),
  'Short passing': blend(
    [role([...CB, ...MIDFIELD], 'passing'), 0.6],
    [role([...CB, ...MIDFIELD], 'technique'), 0.2],
    [role([...CB, ...MIDFIELD], 'composure'), 0.2],
  ),
  'Long passing': blend(
    [role([...GK, ...CB, ...DM, ...CM], 'passing'), 0.65],
    [role([...GK, ...CB, ...DM, ...CM], 'technique'), 0.15],
    [form([...GK, ...CB, ...DM, ...CM]), 0.2],
  ),
  Dribbling: blend(
    [role([...WINGS, ...AM], 'technique'), 0.55],
    [role([...WINGS, ...AM], 'pace'), 0.25],
    [role([...WINGS, ...AM], 'creativity'), 0.2],
  ),
  Crossing: blend(
    [role([...FB, ...WINGS], 'passing'), 0.4],
    [role([...FB, ...WINGS], 'technique'), 0.25],
    [role([...FB, ...WINGS], 'creativity'), 0.2],
    [assists([...FB, ...WINGS]), 0.15],
  ),
  'Chance creation': blend(
    [role([...MIDFIELD, ...WINGS], 'creativity'), 0.5],
    [role([...MIDFIELD, ...WINGS], 'passing'), 0.25],
    [assists([...MIDFIELD, ...WINGS]), 0.25],
  ),
  'Progressive passing': blend(
    [role([...CB, ...MIDFIELD], 'passing'), 0.45],
    [role([...CB, ...MIDFIELD], 'creativity'), 0.25],
    [managerTactic('buildUpRisk'), 0.15],
    [form([...CB, ...MIDFIELD]), 0.15],
  ),
  'Shooting technique': blend(
    [role(FRONT, 'finishing'), 0.55],
    [role(FRONT, 'technique'), 0.3],
    [goals(FRONT), 0.15],
  ),
  'Overall technical quality': blend(
    [teamValue('technical'), 0.65],
    [form(ALL_OUTFIELD), 0.2],
    [managerFit, 0.15],
  ),

  Pace: blend(
    [role(ALL_OUTFIELD, 'pace'), 0.65],
    [form(ALL_OUTFIELD), 0.2],
    [availability(ALL_OUTFIELD), 0.15],
  ),
  Acceleration: blend(
    [role([...FB, ...WINGS, ...ST], 'pace'), 0.7],
    [role([...FB, ...WINGS, ...ST], 'technique'), 0.15],
    [form([...FB, ...WINGS, ...ST]), 0.15],
  ),
  Strength: blend(
    [role([...CB, ...DM, ...ST], 'physical'), 0.65],
    [role([...CB, ...DM, ...ST], 'aerial'), 0.2],
    [form([...CB, ...DM, ...ST]), 0.15],
  ),
  Stamina: blend(
    [minutes(ALL_OUTFIELD), 0.4],
    [availability(ALL_OUTFIELD), 0.3],
    [role(ALL_OUTFIELD, 'pressing'), 0.2],
    [form(ALL_OUTFIELD), 0.1],
  ),
  'Aerial athleticism': blend(
    [role([...CB, ...ST, ...GK], 'aerial'), 0.6],
    [role([...CB, ...ST, ...GK], 'physical'), 0.25],
    [form([...CB, ...ST, ...GK]), 0.15],
  ),
  'Duel ability': blend(
    [role([...DEFENCE, ...MIDFIELD, ...ST], 'physical'), 0.4],
    [role([...DEFENCE, ...MIDFIELD, ...ST], 'defending'), 0.25],
    [role([...DEFENCE, ...MIDFIELD, ...ST], 'composure'), 0.15],
    [form([...DEFENCE, ...MIDFIELD, ...ST]), 0.2],
  ),
  'Recovery speed': blend(
    [role([...FB, ...CB, ...DM], 'pace'), 0.55],
    [role([...FB, ...CB, ...DM], 'defending'), 0.25],
    [availability([...FB, ...CB, ...DM]), 0.2],
  ),
  'Defensive athleticism': blend(
    [role(DEFENCE, 'physical'), 0.4],
    [role(DEFENCE, 'pace'), 0.3],
    [role(DEFENCE, 'defending'), 0.2],
    [form(DEFENCE), 0.1],
  ),
  'Attacking explosiveness': blend(
    [role(FRONT, 'pace'), 0.45],
    [role(FRONT, 'physical'), 0.2],
    [role(FRONT, 'finishing'), 0.2],
    [form(FRONT), 0.15],
  ),
  'Overall physical profile': blend(
    [teamValue('physical'), 0.65],
    [availability(ALL_OUTFIELD), 0.2],
    [form(ALL_OUTFIELD), 0.15],
  ),

  Leadership: blend(
    [role(SPINE, 'composure'), 0.35],
    [form(SPINE), 0.2],
    [managerCurrent, 0.25],
    [managerFit, 0.2],
  ),
  Composure: blend(
    [role(ALL_OUTFIELD, 'composure'), 0.7],
    [recent(ALL_OUTFIELD), 0.15],
    [competition(ALL_OUTFIELD), 0.15],
  ),
  'Work rate': blend(
    [role(ALL_OUTFIELD, 'pressing'), 0.4],
    [minutes(ALL_OUTFIELD), 0.25],
    [availability(ALL_OUTFIELD), 0.2],
    [form(ALL_OUTFIELD), 0.15],
  ),
  'Tactical intelligence': blend(
    [role([...DEFENCE, ...MIDFIELD], 'composure'), 0.3],
    [role([...DEFENCE, ...MIDFIELD], 'passing'), 0.25],
    [managerFit, 0.25],
    [managerCurrent, 0.2],
  ),
  'Pressure handling': blend(
    [role(SPINE, 'composure'), 0.45],
    [recent(SPINE), 0.25],
    [competition(SPINE), 0.15],
    [managerCurrent, 0.15],
  ),
  Discipline: blend(
    [role(ALL_OUTFIELD, 'composure'), 0.45],
    [availability(ALL_OUTFIELD), 0.25],
    [managerFit, 0.15],
    [managerTactic('tacticalFlexibility'), 0.15],
  ),
  Resilience: blend(
    [availability(SPINE), 0.3],
    [recent(SPINE), 0.3],
    [role(SPINE, 'physical'), 0.2],
    [role(SPINE, 'composure'), 0.2],
  ),
  'Big-match reliability': blend(
    [recent(SPINE), 0.35],
    [role(SPINE, 'composure'), 0.3],
    [competition(SPINE), 0.2],
    [managerCurrent, 0.15],
  ),
  'Competitive mentality': blend(
    [role(ALL_OUTFIELD, 'pressing'), 0.25],
    [role(ALL_OUTFIELD, 'composure'), 0.3],
    [form(ALL_OUTFIELD), 0.25],
    [managerCurrent, 0.2],
  ),
  'Overall mental profile': blend(
    [teamValue('mentality'), 0.6],
    [managerFit, 0.2],
    [recent(ALL_OUTFIELD), 0.2],
  ),

  'GK-CB compatibility': blend(
    [balance(role(GK, 'passing'), role(CB, 'passing')), 0.35],
    [role([...GK, ...CB], 'composure'), 0.25],
    [role([...GK, ...CB], 'defending'), 0.25],
    [managerTactic('buildUpRisk'), 0.15],
  ),
  'CB partnership compatibility': blend(
    [cbPartnership, 0.7],
    [availability(CB), 0.15],
    [form(CB), 0.15],
  ),
  'Full-back balance': blend(
    [fullBackBalance, 0.65],
    [role(FB, 'defending'), 0.2],
    [role(FB, 'pace'), 0.15],
  ),
  'Midfield balance': blend(
    [midfieldBalance, 0.65],
    [form(MIDFIELD), 0.2],
    [availability(MIDFIELD), 0.15],
  ),
  'Attack-midfield connection': blend(
    [attackMidfieldConnection, 0.6],
    [role([...ATTACK, ...MIDFIELD], 'passing'), 0.2],
    [managerFit, 0.2],
  ),
  'Left-side balance': blend(
    [cohesion(LEFT_SIDE, ['pace', 'passing', 'defending', 'creativity']), 0.7],
    [form(LEFT_SIDE), 0.15],
    [availability(LEFT_SIDE), 0.15],
  ),
  'Right-side balance': blend(
    [cohesion(RIGHT_SIDE, ['pace', 'passing', 'defending', 'creativity']), 0.7],
    [form(RIGHT_SIDE), 0.15],
    [availability(RIGHT_SIDE), 0.15],
  ),
  'Central spine': blend(
    [cohesion(SPINE, ['composure', 'passing', 'defending', 'finishing']), 0.55],
    [form(SPINE), 0.25],
    [managerFit, 0.2],
  ),
  'Defensive protection': blend(
    [role([...DM, ...CB], 'defending'), 0.45],
    [role([...DM, ...CB], 'physical'), 0.2],
    [role([...DM, ...CB], 'pressing'), 0.2],
    [managerTactic('lowBlock'), 0.15],
  ),
  'Overall XI balance': blend(
    [teamValue('chemistry'), 0.5],
    [lwRwBalance, 0.15],
    [fullBackBalance, 0.15],
    [midfieldBalance, 0.1],
    [managerFit, 0.1],
  ),

  'Breaking low blocks': blend(
    [role([...AM, ...WINGS], 'creativity'), 0.35],
    [role([...AM, ...WINGS], 'technique'), 0.25],
    [role(ST, 'finishing'), 0.2],
    [managerTactic('possession'), 0.2],
  ),
  'Defending a lead': blend(
    [role(DEFENCE, 'defending'), 0.35],
    [role(DEFENCE, 'composure'), 0.2],
    [managerTactic('lowBlock'), 0.25],
    [teamValue('mentality'), 0.2],
  ),
  'Chasing a goal': blend(
    [teamValue('attack'), 0.35],
    [role([...AM, ...FRONT], 'creativity'), 0.25],
    [managerTactic('tacticalFlexibility'), 0.2],
    [managerTactic('directness'), 0.2],
  ),
  'Countering elite opponents': blend(
    [role(FRONT, 'pace'), 0.25],
    [role(DEFENCE, 'defending'), 0.25],
    [managerTactic('transition'), 0.25],
    [teamValue('mentality'), 0.25],
  ),
  'Playing through high press': blend(
    [role([...GK, ...CB, ...MIDFIELD], 'passing'), 0.35],
    [role([...GK, ...CB, ...MIDFIELD], 'composure'), 0.3],
    [role(MIDFIELD, 'technique'), 0.2],
    [managerTactic('buildUpRisk'), 0.15],
  ),
  'High pressing': blend(
    [role([...MIDFIELD, ...FRONT], 'pressing'), 0.4],
    [role([...MIDFIELD, ...FRONT], 'physical'), 0.2],
    [managerTactic('pressing'), 0.3],
    [availability([...MIDFIELD, ...FRONT]), 0.1],
  ),
  'Set-piece threat': blend(
    [role([...CB, ...ST], 'aerial'), 0.4],
    [role([...CB, ...ST], 'physical'), 0.2],
    [role([...FB, ...MIDFIELD], 'passing'), 0.25],
    [role([...FB, ...MIDFIELD], 'creativity'), 0.15],
  ),
  'Knockout-match suitability': blend(
    [teamValue('tactics'), 0.25],
    [teamValue('mentality'), 0.25],
    [teamValue('defence'), 0.2],
    [teamValue('attack'), 0.15],
    [teamValue('goalkeeping'), 0.15],
  ),
  'League consistency': blend(
    [availability(ALL_OUTFIELD), 0.3],
    [recent(ALL_OUTFIELD), 0.25],
    [form(ALL_OUTFIELD), 0.2],
    [competition(ALL_OUTFIELD), 0.15],
    [managerCurrent, 0.1],
  ),
  'Best complete XI': blend(
    [teamValue('attack'), 0.15],
    [teamValue('midfield'), 0.15],
    [teamValue('defence'), 0.15],
    [teamValue('goalkeeping'), 0.15],
    [teamValue('tactics'), 0.15],
    [teamValue('chemistry'), 0.15],
    [teamValue('mentality'), 0.1],
  ),
} satisfies Record<(typeof METRIC_NAMES)[number]['metric'], MetricEvaluator>;

function findWinnerIds(scores: Record<string, number>): string[] {
  const top = Math.max(...Object.values(scores));
  return Object.entries(scores)
    .filter(([, score]) => score === top)
    .map(([memberId]) => memberId)
    .sort();
}

function bestEntry(
  teams: TeamFeatures[],
  score: (entry: SquadEntryView) => number,
  chooseMaximum = true,
): SquadEntryView | null {
  const entries = teams
    .flatMap((team) => team.entries)
    .filter((entry) => entry.candidate.kind === 'PLAYER');
  return (
    [...entries].sort((left, right) => {
      const difference = score(right) - score(left);
      return (chooseMaximum ? difference : -difference) || left.id.localeCompare(right.id);
    })[0] ?? null
  );
}

function addAward(
  awards: EvaluationView['awards'],
  title: string,
  team: TeamFeatures,
  detail: string,
): void {
  awards.push({ title, memberId: team.memberId, detail });
}

function topBy(teams: TeamFeatures[], value: (team: TeamFeatures) => number): TeamFeatures {
  return [...teams].sort(
    (left, right) => value(right) - value(left) || left.memberId.localeCompare(right.memberId),
  )[0]!;
}

export function evaluateGame(input: EvaluationInput): EvaluationView {
  if (input.memberIds.length < 2) throw new Error('Evaluation requires at least two teams');
  const teams = input.memberIds.map((memberId) =>
    buildFeatures(memberId, input.squads, input.initialBudgets[memberId] ?? 0, input.formLookback),
  );
  const metrics: MetricScoreView[] = METRIC_NAMES.map(({ category, metric }, index) => {
    const evaluateMetric = METRIC_EVALUATORS[metric];
    const scores = Object.fromEntries(teams.map((team) => [team.memberId, evaluateMetric(team)]));
    return { index: index + 1, category, metric, scores, winnerIds: findWinnerIds(scores) };
  });
  const categoryScoresByTeam = new Map<string, Record<string, number>>();
  for (const team of teams) {
    categoryScoresByTeam.set(
      team.memberId,
      Object.fromEntries(
        METRIC_CATEGORIES.map(({ category }) => {
          const values = metrics
            .filter((metric) => metric.category === category)
            .map((metric) => metric.scores[team.memberId]!);
          return [category, rounded(average(values))];
        }),
      ),
    );
  }
  const provisional = teams.map((team) => {
    const categoryScores = categoryScoresByTeam.get(team.memberId)!;
    const overallScore = rounded(average(Object.values(categoryScores)));
    const sortedCategories = Object.entries(categoryScores).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
    return {
      team,
      categoryScores,
      overallScore,
      strengths: sortedCategories.slice(0, 2).map(([category]) => category),
      weakness: sortedCategories.at(-1)?.[0] ?? 'SQUAD DEPTH',
    };
  });
  const ranked = [...provisional].sort(
    (left, right) =>
      right.overallScore - left.overallScore ||
      left.team.memberId.localeCompare(right.team.memberId),
  );
  const categoryWinnerCounts = new Map<string, number>();
  for (const { category } of METRIC_CATEGORIES) {
    const values = ranked.map((result) => ({
      memberId: result.team.memberId,
      score: result.categoryScores[category]!,
    }));
    const top = Math.max(...values.map(({ score }) => score));
    for (const { memberId, score } of values) {
      if (score === top)
        categoryWinnerCounts.set(memberId, (categoryWinnerCounts.get(memberId) ?? 0) + 1);
    }
  }
  const results: TeamResultView[] = ranked.map((result, index) => {
    const metricWins = metrics.filter((metric) =>
      metric.winnerIds.includes(result.team.memberId),
    ).length;
    const consistency = average([
      result.team.situations,
      result.team.availability,
      result.team.mentality,
      result.overallScore,
    ]);
    return {
      memberId: result.team.memberId,
      rank: index + 1,
      overallScore: result.overallScore,
      categoryScores: result.categoryScores,
      metricWins,
      categoryWins: categoryWinnerCounts.get(result.team.memberId) ?? 0,
      strengths: result.strengths,
      weakness: result.weakness,
      squadMarketValueEUR: result.team.squadMarketValueEUR,
      spentEUR: result.team.spentEUR,
      remainingEUR: result.team.remainingEUR,
      auctionEfficiency: rounded(result.team.valueEfficiency),
      leaguePoints: Math.round(clamp(20 + consistency * 0.82, 20, 102)),
      knockoutRating: rounded(
        average([
          result.team.tactics,
          result.team.mentality,
          result.team.defence,
          result.team.attack,
        ]),
      ),
      finalRating: rounded(
        average([
          result.team.tactics,
          result.team.mentality,
          result.team.goalkeeping,
          result.team.situations,
        ]),
      ),
    };
  });

  const awards: EvaluationView['awards'] = [];
  addAward(
    awards,
    'Draft Champion',
    teams.find((team) => team.memberId === results[0]!.memberId)!,
    `Top overall score: ${results[0]!.overallScore}`,
  );
  addAward(
    awards,
    'Best Attack',
    topBy(teams, (team) => team.attack),
    'Highest current-form attacking model',
  );
  addAward(
    awards,
    'Best Midfield',
    topBy(teams, (team) => team.midfield),
    'Strongest midfield control profile',
  );
  addAward(
    awards,
    'Best Defence',
    topBy(teams, (team) => team.defence),
    'Best defensive unit score',
  );
  addAward(
    awards,
    'Best Goalkeeper',
    topBy(teams, (team) => team.goalkeeping),
    'Top goalkeeping model',
  );
  addAward(
    awards,
    'Best Manager Fit',
    topBy(teams, (team) => team.tactics),
    'Best system-to-squad compatibility',
  );
  addAward(
    awards,
    'Best Tactical XI',
    topBy(teams, (team) => average([team.tactics, team.situations])),
    'Highest tactical ceiling',
  );
  addAward(
    awards,
    'Most Balanced XI',
    topBy(teams, (team) => team.chemistry),
    'Smallest weakness across units',
  );
  addAward(
    awards,
    'Most Technical XI',
    topBy(teams, (team) => team.technical),
    'Best technique and distribution blend',
  );
  addAward(
    awards,
    'Most Physical XI',
    topBy(teams, (team) => team.physical),
    'Best athletic profile',
  );
  addAward(
    awards,
    'Best Budget Management',
    topBy(teams, (team) => average([team.valueEfficiency, clamp(team.remainingEUR / 5_000_000)])),
    'Value without sacrificing squad strength',
  );
  addAward(
    awards,
    'Best Value Squad',
    topBy(teams, (team) => team.valueEfficiency),
    'Strongest market-value and form efficiency',
  );
  const bargain = bestEntry(teams, (entry) => {
    const market = entry.marketValueEUR ?? 0;
    return entry.purchasePriceEUR <= 0
      ? 0
      : (market / entry.purchasePriceEUR) * formRating(entry.candidate, input.formLookback);
  });
  if (bargain)
    awards.push({
      title: 'Best Bargain',
      memberId: bargain.memberId,
      detail: bargain.candidate.commonName,
    });
  const overpay = bestEntry(teams, (entry) => {
    const market = Math.max(1, entry.marketValueEUR ?? 1);
    return (
      (entry.purchasePriceEUR / market) * (101 - formRating(entry.candidate, input.formLookback))
    );
  });
  if (overpay)
    awards.push({
      title: 'Biggest Overpay',
      memberId: overpay.memberId,
      detail: overpay.candidate.commonName,
    });
  const forced = bestEntry(
    teams.map((team) => ({
      ...team,
      entries: team.entries.filter((entry) => entry.acquisition !== 'AUCTION'),
    })),
    (entry) => formRating(entry.candidate, input.formLookback),
  );
  if (forced)
    awards.push({
      title: 'Best Forced Signing',
      memberId: forced.memberId,
      detail: forced.candidate.commonName,
    });
  const gamble = bestEntry(
    teams,
    (entry) => entry.purchasePriceEUR / Math.max(1, entry.marketValueEUR ?? 1),
  );
  if (gamble)
    awards.push({
      title: 'Biggest Gamble',
      memberId: gamble.memberId,
      detail: gamble.candidate.commonName,
    });
  const superstar = bestEntry(teams, (entry) => formRating(entry.candidate, input.formLookback));
  if (superstar)
    awards.push({
      title: 'Best Superstar Purchase',
      memberId: superstar.memberId,
      detail: superstar.candidate.commonName,
    });

  const resultByMember = new Map(results.map((result) => [result.memberId, result]));
  const headToHead: EvaluationView['headToHead'] = [];
  for (let homeIndex = 0; homeIndex < teams.length; homeIndex += 1) {
    for (let awayIndex = homeIndex + 1; awayIndex < teams.length; awayIndex += 1) {
      const home = teams[homeIndex]!;
      const away = teams[awayIndex]!;
      const homeExpected = clamp(
        1.25 + (home.attack + home.tactics - away.defence - away.goalkeeping) / 42,
        0.2,
        4.5,
      );
      const awayExpected = clamp(
        1.1 + (away.attack + away.tactics - home.defence - home.goalkeeping) / 42,
        0.2,
        4.5,
      );
      const homeGoals = Math.max(0, Math.round(homeExpected));
      const awayGoals = Math.max(0, Math.round(awayExpected));
      const homeResult = resultByMember.get(home.memberId)!;
      const awayResult = resultByMember.get(away.memberId)!;
      headToHead.push({
        homeMemberId: home.memberId,
        awayMemberId: away.memberId,
        homeGoals,
        awayGoals,
        explanation: `${homeResult.strengths[0]} meets ${awayResult.strengths[0]}; the model separates them through attack, defensive resistance and manager fit.`,
      });
    }
  }
  return {
    metrics,
    teams: results,
    awards,
    headToHead,
    seed: input.seed,
    seedCommitment: input.seedCommitment,
  };
}
