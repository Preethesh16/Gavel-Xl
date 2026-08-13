import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CandidateSnapshot, Position } from '@gavel-xi/shared';
import { loadConfig, loadRootEnvironment } from './config.js';
import { PrismaPersistence } from './persistence.js';

const positions = new Set<Position>([
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
  'MANAGER',
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Catalog file must contain a JSON object.');
  }
  return value as Record<string, unknown>;
}

function candidates(value: unknown, kind: 'PLAYER' | 'MANAGER'): CandidateSnapshot[] {
  if (!Array.isArray(value))
    throw new Error(`Catalog field ${kind.toLowerCase()}s must be an array.`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const candidate = record(entry) as unknown as CandidateSnapshot;
    if (candidate.kind !== kind || typeof candidate.id !== 'string' || candidate.id.trim() === '') {
      throw new Error(`${kind} record ${index + 1} has an invalid id or kind.`);
    }
    if (seen.has(candidate.id))
      throw new Error(`Duplicate ${kind.toLowerCase()} id: ${candidate.id}`);
    seen.add(candidate.id);
    if (
      !Array.isArray(candidate.positions) ||
      candidate.positions.length === 0 ||
      candidate.positions.some((position) => !positions.has(position)) ||
      !candidate.positions.includes(candidate.preferredPosition)
    ) {
      throw new Error(`${candidate.id} has an invalid or unverified preferred position.`);
    }
    if (kind === 'PLAYER' && candidate.positions.includes('MANAGER')) {
      throw new Error(`${candidate.id} is a player with a manager position.`);
    }
    if (kind === 'MANAGER' && candidate.preferredPosition !== 'MANAGER') {
      throw new Error(`${candidate.id} is a manager without MANAGER as its preferred position.`);
    }
    if (
      !Number.isFinite(candidate.valuation?.valueEUR) ||
      (candidate.valuation.valueEUR ?? 0) <= 0
    ) {
      throw new Error(`${candidate.id} has no usable valuation.`);
    }
    return candidate;
  });
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) throw new Error('Usage: catalog:import <catalog.json>');
  loadRootEnvironment();
  const config = loadConfig();
  if (config.DATABASE_URL === undefined)
    throw new Error('DATABASE_URL is required for catalog import.');
  const document = record(JSON.parse(await readFile(path, 'utf8')));
  const players = candidates(document['players'], 'PLAYER');
  const managers = candidates(document['managers'], 'MANAGER');
  const source =
    typeof document['source'] === 'string' && document['source'].trim() !== ''
      ? document['source']
      : 'manual-catalog-import';
  const persistence = new PrismaPersistence({ connectionString: config.DATABASE_URL });
  await persistence.connect();
  try {
    await persistence.replaceCatalog({ source, players, managers });
    process.stdout.write(
      `${JSON.stringify({ source, players: players.length, managers: managers.length, sha256: createHash('sha256').update(JSON.stringify(document)).digest('hex') }, null, 2)}\n`,
    );
  } finally {
    await persistence.close();
  }
}

await main();
