import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type {
  CandidateSnapshot,
  Position,
  RoleProfile,
  TacticalProfile,
  Valuation,
} from '@gavel-xi/shared';

const DATA = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data';
// England, Spain, Italy, Germany, France, Portugal, Netherlands, Belgium, Turkey.
const NINE_LEAGUES = new Set(['GB1', 'ES1', 'IT1', 'L1', 'FR1', 'PO1', 'NL1', 'BE1', 'TR1']);
const positionMap: Record<string, Position> = {
  Goalkeeper: 'GK',
  'Left-Back': 'LB',
  'Right-Back': 'RB',
  'Centre-Back': 'CB',
  'Left Midfield': 'LW',
  'Right Midfield': 'RW',
  'Defensive Midfield': 'DM',
  'Central Midfield': 'CM',
  'Attacking Midfield': 'AM',
  'Left Winger': 'LW',
  'Right Winger': 'RW',
  'Centre-Forward': 'ST',
  'Second Striker': 'ST',
};
const positionBias: Record<Position, Partial<RoleProfile>> = {
  GK: { defending: 90, aerial: 74, composure: 76, passing: 68 },
  LB: { pace: 74, defending: 72, passing: 67, pressing: 72 },
  RB: { pace: 74, defending: 72, passing: 67, pressing: 72 },
  CB: { defending: 84, aerial: 82, physical: 80, passing: 64 },
  LWB: { pace: 77, defending: 69, passing: 70, pressing: 73 },
  RWB: { pace: 77, defending: 69, passing: 70, pressing: 73 },
  DM: { defending: 76, passing: 76, composure: 74, physical: 72 },
  CM: { passing: 78, technique: 77, creativity: 74, pressing: 68 },
  AM: { technique: 82, creativity: 84, passing: 80, finishing: 70 },
  LW: { pace: 84, technique: 80, creativity: 76, finishing: 74 },
  RW: { pace: 84, technique: 80, creativity: 76, finishing: 74 },
  ST: { finishing: 84, physical: 75, composure: 78, aerial: 70 },
  MANAGER: {},
};
const managerTactics: TacticalProfile = {
  possession: 70,
  pressing: 70,
  transition: 70,
  lowBlock: 60,
  highLine: 65,
  directness: 60,
  widthPreference: 65,
  buildUpRisk: 60,
  tacticalFlexibility: 70,
};

function csv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted && char === '"' && text[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') {
      row.push(field);
      field = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (header === undefined) throw new Error('Dataset CSV was empty.');
  return data
    .filter((values) => values.length === header.length)
    .map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])));
}
function integer(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function age(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? Math.max(16, Math.min(45, Math.floor((Date.now() - time) / 31_556_952_000)))
    : 25;
}
function clamp(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)));
}
function role(position: Position, value: number): RoleProfile {
  const base: RoleProfile = {
    pace: value,
    physical: value,
    technique: value,
    creativity: value,
    defending: value,
    aerial: value,
    passing: value,
    finishing: value,
    pressing: value,
    composure: value,
  };
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(positionBias[position]).map(([key, score]) => [
        key,
        clamp(score! * 0.7 + value * 0.3),
      ]),
    ),
  } as RoleProfile;
}
function valuation(value: number, updatedAt: string): Valuation {
  return {
    valueEUR: value,
    source: 'Transfermarkt-derived open catalogue',
    sourceUrl: null,
    valuationDate: updatedAt,
    retrievedAt: new Date().toISOString(),
    confidence: 0.7,
    type: 'market_value',
  };
}

async function fetchCsv(name: string): Promise<Record<string, string>[]> {
  const response = await fetch(`${DATA}/${name}.csv.gz`);
  if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`);
  const stream = response.body?.pipeThrough(new DecompressionStream('gzip'));
  if (stream === undefined) throw new Error(`Could not decompress ${name}.`);
  return csv(await new Response(stream).text());
}

export async function createTransfermarktCatalog(): Promise<{
  source: string;
  generatedAt: string;
  players: CandidateSnapshot[];
  managers: CandidateSnapshot[];
}> {
  const [playersRaw, clubsRaw] = await Promise.all([fetchCsv('players'), fetchCsv('clubs')]);
  const clubs = new Map(
    clubsRaw
      .filter((club) => NINE_LEAGUES.has(club['domestic_competition_id'] ?? ''))
      .map((club) => [club['club_id']!, club]),
  );
  const updatedAt = new Date().toISOString();
  const players: CandidateSnapshot[] = playersRaw.flatMap((entry) => {
    const club = clubs.get(entry['current_club_id'] ?? '');
    const position = positionMap[entry['sub_position'] ?? ''];
    const value = integer(entry['market_value_in_eur'] ?? '');
    if (
      club === undefined ||
      position === undefined ||
      value <= 0 ||
      integer(entry['last_season'] ?? '0') < 2024
    )
      return [];
    const id = `transfermarkt:${entry['player_id']}`;
    const baseline = clamp(45 + Math.log10(value) * 7);
    return [
      {
        id,
        kind: 'PLAYER' as const,
        fullName: entry['name']!,
        commonName: entry['name']!,
        age: age(entry['date_of_birth'] ?? ''),
        nationality: entry['country_of_citizenship'] || 'Unknown',
        club: entry['current_club_name'] || club['name']!,
        league: club['domestic_competition_id']!,
        positions: [position],
        preferredPosition: position,
        imageUrl: entry['image_url'] || null,
        season: String(entry['last_season']),
        appearances: 0,
        starts: 0,
        minutes: 0,
        goals: 0,
        assists: 0,
        cleanSheets: 0,
        currentFormRating: baseline,
        availabilityRating: 75,
        competitionStrength: 82,
        lastFive: Array.from({ length: 5 }, () => baseline),
        role: role(position, baseline),
        valuation: valuation(value, updatedAt),
        dataSource:
          'Transfermarkt-derived open catalogue; profiles and market valuations; imported snapshot',
        dataUpdatedAt: updatedAt,
      },
    ];
  });
  const managers: CandidateSnapshot[] = [...clubs.values()].flatMap((club) => {
    const name = club['coach_name']?.trim();
    if (name === undefined || name === '') return [];
    return [
      {
        id: `transfermarkt:coach:${club['club_id']}`,
        kind: 'MANAGER' as const,
        fullName: name,
        commonName: name,
        age: 45,
        nationality: 'Unknown',
        club: club['name']!,
        league: club['domestic_competition_id']!,
        positions: ['MANAGER'],
        preferredPosition: 'MANAGER',
        imageUrl: null,
        season: 'catalog',
        appearances: 0,
        starts: 0,
        minutes: 0,
        goals: 0,
        assists: 0,
        cleanSheets: 0,
        currentFormRating: 70,
        availabilityRating: 90,
        competitionStrength: 82,
        lastFive: [70, 70, 70, 70, 70],
        role: role('MANAGER', 70),
        tactics: managerTactics,
        valuation: valuation(10_000_000, updatedAt),
        dataSource: 'Transfermarkt-derived open catalogue; club coach at import time',
        dataUpdatedAt: updatedAt,
      },
    ];
  });
  if (players.length < 300 || managers.length < 9)
    throw new Error(
      `Catalogue too small: ${players.length} specific-position players, ${managers.length} managers.`,
    );
  return {
    source: 'transfermarkt-datasets open snapshot',
    generatedAt: updatedAt,
    players,
    managers,
  };
}

async function main(): Promise<void> {
  const output = process.argv[2] ?? 'catalog.json';
  const result = await createTransfermarktCatalog();
  await writeFile(output, `${JSON.stringify(result)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, players: result.players.length, managers: result.managers.length, hash: createHash('sha256').update(JSON.stringify(result)).digest('hex') }, null, 2)}\n`,
  );
}
if (
  process.argv[1]?.endsWith('catalog-bootstrap.ts') ||
  process.argv[1]?.endsWith('catalog-bootstrap.js')
) {
  await main();
}
