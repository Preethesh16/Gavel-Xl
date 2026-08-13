import type { CandidateSnapshot, RoomMemberView, SquadEntryView } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import { buildLineup, FORMATION_PITCHES } from './formations';
import { formatClock, formatMoney } from './format';

const candidate: CandidateSnapshot = {
  id: 'candidate-1',
  kind: 'PLAYER',
  fullName: 'Test Centre Back',
  commonName: 'Test CB',
  age: 25,
  nationality: 'England',
  club: 'Development FC',
  league: 'Test League',
  positions: ['CB'],
  preferredPosition: 'CB',
  imageUrl: null,
  season: '2026/27',
  appearances: 12,
  starts: 12,
  minutes: 1_080,
  goals: 0,
  assists: 0,
  cleanSheets: 5,
  currentFormRating: 80,
  availabilityRating: 95,
  competitionStrength: 80,
  lastFive: [75, 82, 77, 88, 80],
  role: {
    pace: 70,
    physical: 85,
    technique: 75,
    creativity: 60,
    defending: 90,
    aerial: 86,
    passing: 78,
    finishing: 35,
    pressing: 79,
    composure: 84,
  },
  valuation: {
    valueEUR: 60_000_000,
    source: 'fixture',
    sourceUrl: null,
    valuationDate: null,
    retrievedAt: '2026-08-13T00:00:00.000Z',
    confidence: 1,
    type: 'game_estimate',
  },
  dataSource: 'fixture',
  dataUpdatedAt: '2026-08-13T00:00:00.000Z',
};

const member: RoomMemberView = {
  id: 'member-1',
  name: 'Director',
  avatar: 'shield',
  color: '#d6ff3f',
  isHost: true,
  isReady: true,
  isConnected: true,
  isSpectator: false,
  joinedAt: 1,
  budgetEUR: 700_000_000,
  spentEUR: 50_000_000,
  emergencyAllocations: 0,
  filledSlots: 1,
  totalSlots: 12,
};

describe('formation presentation data', () => {
  it('renders eleven valid and uniquely identified pitch slots for every supported formation', () => {
    expect(Object.keys(FORMATION_PITCHES)).toHaveLength(7);
    for (const slots of Object.values(FORMATION_PITCHES)) {
      expect(slots).toHaveLength(11);
      expect(new Set(slots.map((slot) => slot.id)).size).toBe(11);
      for (const slot of slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.x).toBeLessThanOrEqual(100);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never paints one squad entry into two repeated formation slots', () => {
    const entry: SquadEntryView = {
      id: 'entry-1',
      memberId: member.id,
      slotId: 'LCB',
      cycleId: 'cb-cycle-a',
      candidate,
      purchasePriceEUR: 50_000_000,
      marketValueEUR: 60_000_000,
      acquisition: 'AUCTION',
      acquiredAt: 1,
    };
    const lineup = buildLineup('4-2-1-3', member, [entry]);
    expect(lineup.filter((slot) => slot.entry?.id === entry.id)).toHaveLength(1);
    expect(lineup.find((slot) => slot.slot.id === 'LCB')?.entry?.id).toBe(entry.id);
  });
});

describe('auction display formatting', () => {
  it('handles null, compact money, exact millions and negative clocks safely', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(750_000_000, true)).toBe('€750M');
    expect(formatMoney(1_000_000_000)).toBe('€1B');
    expect(formatClock(-500)).toBe('0.0');
    expect(formatClock(9_250)).toBe('9.3');
  });
});
