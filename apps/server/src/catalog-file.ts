import { readFile } from 'node:fs/promises';
import type { CandidateSnapshot, Position } from '@gavel-xi/shared';

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

export async function readCatalogFile(path: string) {
  const document = record(JSON.parse(await readFile(path, 'utf8')));
  return {
    source:
      typeof document['source'] === 'string' && document['source'].trim() !== ''
        ? document['source']
        : 'local-catalog',
    players: candidates(document['players'], 'PLAYER'),
    managers: candidates(document['managers'], 'MANAGER'),
  };
}
