import {
  roomSettingsSchema,
  type CandidateSnapshot,
  type Position,
  type RoomSettingsInput,
} from '@gavel-xi/shared';
import type { EngineMember, EngineSnapshot } from './types.js';

const POSITIONS: Exclude<Position, 'MANAGER'>[] = [
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
];

function candidate(
  position: Position,
  index: number,
  kind: 'PLAYER' | 'MANAGER',
): CandidateSnapshot {
  const strong = index < 30;
  const rating = strong ? 95 - (index % 12) : 74 - (index % 12);
  const id = `fixture-${position.toLowerCase()}-${index}`;
  return {
    id,
    kind,
    fullName: `Fixture ${position} ${index}`,
    commonName: `${position} ${index}`,
    age: 20 + (index % 15),
    nationality: `Nation ${index % 9}`,
    club: `Club ${index % 17}`,
    league: `League ${index % 5}`,
    positions: [position],
    preferredPosition: position,
    imageUrl: null,
    season: 'TEST',
    appearances: 20,
    starts: 18,
    minutes: 1_600,
    goals: ['ST', 'LW', 'RW', 'AM'].includes(position) ? index % 12 : index % 3,
    assists: ['CM', 'AM', 'LW', 'RW'].includes(position) ? index % 10 : index % 2,
    cleanSheets: position === 'GK' ? index % 11 : 0,
    currentFormRating: rating,
    availabilityRating: 80 + (index % 20),
    competitionStrength: 80,
    lastFive: [rating - 2, rating, rating + 1, rating - 1, rating + 2],
    role: {
      pace: Math.min(100, rating + (index % 7)),
      physical: Math.min(100, rating + (index % 5)),
      technique: Math.min(100, rating + (index % 4)),
      creativity: Math.min(100, rating + (index % 8)),
      defending: ['GK', 'LB', 'CB', 'RB', 'LWB', 'RWB', 'DM'].includes(position) ? rating : 45,
      aerial: ['GK', 'CB', 'ST'].includes(position) ? rating : 60,
      passing: ['DM', 'CM', 'AM'].includes(position) ? rating : Math.max(40, rating - 8),
      finishing: ['ST', 'LW', 'RW', 'AM'].includes(position) ? rating : 35,
      pressing: Math.max(40, rating - 4),
      composure: Math.min(100, rating + 2),
    },
    ...(kind === 'MANAGER'
      ? {
          tactics: {
            possession: rating,
            pressing: Math.max(0, rating - 4),
            transition: Math.min(100, rating + 3),
            lowBlock: Math.max(0, rating - 8),
            highLine: rating,
            directness: Math.max(0, rating - 5),
            widthPreference: Math.min(100, rating + 1),
            buildUpRisk: Math.max(0, rating - 3),
            tacticalFlexibility: rating,
          },
        }
      : {}),
    valuation: {
      valueEUR: 18_000_000 + (rating - 50) * 500_000,
      source: 'fixture estimate',
      sourceUrl: null,
      valuationDate: null,
      retrievedAt: '2026-01-01T00:00:00.000Z',
      confidence: 0.5,
      type: 'game_estimate',
    },
    dataSource: 'fixture',
    dataUpdatedAt: '2026-01-01T00:00:00.000Z',
  };
}

export function fixtureSnapshot(countPerPosition = 42): EngineSnapshot {
  const candidates = [
    ...POSITIONS.flatMap((position) =>
      Array.from({ length: countPerPosition }, (_, index) => candidate(position, index, 'PLAYER')),
    ),
    ...Array.from({ length: countPerPosition }, (_, index) =>
      candidate('MANAGER', index, 'MANAGER'),
    ),
  ];
  return {
    id: 'fixture-snapshot',
    provider: 'fixture',
    createdAt: '2026-01-01T00:00:00.000Z',
    sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
    candidates,
  };
}

export function fixtureMembers(count: number, budgetEUR = 750_000_000): EngineMember[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index + 1}`,
    budgetEUR,
    joinedAt: index,
  }));
}

export function fixtureSettings(update: Partial<RoomSettingsInput> = {}): RoomSettingsInput {
  return roomSettingsSchema.parse({
    revealSeconds: 0,
    auctionTimerSeconds: 5,
    soundEnabled: false,
    ...update,
  });
}
