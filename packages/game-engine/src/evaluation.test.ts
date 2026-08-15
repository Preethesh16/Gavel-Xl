import type { EvaluationView, Position, SquadEntryView } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import { COVER_STAR_BONUS, COVER_TEAM_BONUS, evaluateGame } from './evaluation.js';
import { METRIC_CATEGORIES, METRIC_NAMES } from './metrics.js';
import { fixtureSnapshot } from './test-fixtures.js';

function squads(): SquadEntryView[] {
  const candidates = fixtureSnapshot().candidates;
  return ['alpha', 'beta'].flatMap((memberId, memberIndex) =>
    candidates.slice(memberIndex * 12, memberIndex * 12 + 12).map((candidate, index) => ({
      id: `${memberId}-${index}`,
      memberId,
      slotId: `slot-${index}`,
      cycleId: `cycle-${index}`,
      candidate,
      purchasePriceEUR: 10_000_000 + index * 1_000_000,
      marketValueEUR: candidate.valuation.valueEUR,
      acquisition: 'AUCTION' as const,
      acquiredAt: index,
    })),
  );
}

const XI_SHAPE = [
  ['gk-1', 'GK', 0],
  ['lb-1', 'LB', 0],
  ['cb-1', 'CB', 0],
  ['cb-2', 'CB', 1],
  ['rb-1', 'RB', 0],
  ['dm-1', 'DM', 0],
  ['dm-2', 'DM', 1],
  ['am-1', 'AM', 0],
  ['lw-1', 'LW', 0],
  ['st-1', 'ST', 0],
  ['rw-1', 'RW', 0],
  ['manager-1', 'MANAGER', 0],
] as const satisfies ReadonlyArray<readonly [string, Position, number]>;

function semanticSquads(): SquadEntryView[] {
  const candidates = fixtureSnapshot().candidates;
  return ['alpha', 'beta'].flatMap((memberId, memberIndex) =>
    XI_SHAPE.map(([slotId, position, positionIndex], entryIndex) => {
      const matching = candidates.filter((candidate) => candidate.preferredPosition === position);
      const candidate = structuredClone(matching[memberIndex * 2 + positionIndex]!);
      return {
        id: `${memberId}-${slotId}`,
        memberId,
        slotId,
        cycleId: `cycle-${entryIndex}`,
        candidate,
        purchasePriceEUR: 10_000_000 + entryIndex * 1_000_000,
        marketValueEUR: candidate.valuation.valueEUR,
        acquisition: 'AUCTION' as const,
        acquiredAt: entryIndex,
      };
    }),
  );
}

function evaluate(
  entries: SquadEntryView[],
  formLookback: '5_MATCHES' | '10_MATCHES' | 'CURRENT_SEASON' = 'CURRENT_SEASON',
): EvaluationView {
  return evaluateGame({
    memberIds: ['alpha', 'beta'],
    squads: entries,
    initialBudgets: { alpha: 750_000_000, beta: 750_000_000 },
    seed: 'semantic-evaluation',
    seedCommitment: 'semantic-commitment',
    formLookback,
  });
}

function score(evaluation: EvaluationView, metric: string, memberId = 'alpha'): number {
  return evaluation.metrics.find((entry) => entry.metric === metric)!.scores[memberId]!;
}

describe('100-metric evaluation', () => {
  it('keeps the immutable ten-by-ten metric contract', () => {
    expect(METRIC_CATEGORIES).toHaveLength(10);
    expect(METRIC_CATEGORIES.every(({ metrics }) => metrics.length === 10)).toBe(true);
    expect(METRIC_NAMES).toHaveLength(100);
    expect(new Set(METRIC_NAMES.map(({ metric }) => metric)).size).toBe(100);
  });

  it('produces dynamic rankings, category scores, awards and numerical match predictions', () => {
    const evaluation = evaluateGame({
      memberIds: ['alpha', 'beta'],
      squads: squads(),
      initialBudgets: { alpha: 750_000_000, beta: 750_000_000 },
      seed: 'evaluation',
      seedCommitment: 'commitment',
      formLookback: 'CURRENT_SEASON',
    });
    expect(evaluation.metrics).toHaveLength(100);
    expect(evaluation.teams.map(({ rank }) => rank)).toEqual([1, 2]);
    expect(evaluation.teams.every((team) => Object.keys(team.categoryScores).length === 10)).toBe(
      true,
    );
    expect(evaluation.awards.length).toBeGreaterThanOrEqual(12);
    expect(evaluation.headToHead).toHaveLength(1);
    expect(evaluation.headToHead[0]?.homeGoals).toBeGreaterThanOrEqual(0);
    expect(evaluation.teams[0]?.leaguePoints).toBeGreaterThanOrEqual(20);
  });

  it('applies transparent cover-star and cover-team bonuses to the final score', () => {
    const baselineEntries = semanticSquads();
    const baseline = evaluate(baselineEntries);
    const boostedEntries = structuredClone(baselineEntries);
    const yamal = boostedEntries.find(
      ({ memberId, slotId }) => memberId === 'alpha' && slotId === 'rw-1',
    )!;
    yamal.candidate.fullName = 'Lamine Yamal Nasraoui Ebana';
    yamal.candidate.commonName = 'Lamine Yamal';
    yamal.candidate.nationality = 'Spain';
    const spanishTeammate = boostedEntries.find(
      ({ memberId, slotId }) => memberId === 'alpha' && slotId === 'dm-1',
    )!;
    spanishTeammate.candidate.nationality = 'Spain';
    const boosted = evaluate(boostedEntries);
    const baselineScore = baseline.teams.find(({ memberId }) => memberId === 'alpha')!.overallScore;
    const boostedScore = boosted.teams.find(({ memberId }) => memberId === 'alpha')!.overallScore;

    expect(boostedScore).toBeCloseTo(baselineScore + COVER_STAR_BONUS + COVER_TEAM_BONUS, 1);
    expect(boosted.awards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Cover Star Boost', memberId: 'alpha' }),
        expect.objectContaining({ title: 'Cover Team Boost', memberId: 'alpha' }),
      ]),
    );
  });

  it('uses goalkeeper signals for shot stopping without leaking them into finishing', () => {
    const baselineSquads = semanticSquads();
    const changedSquads = structuredClone(baselineSquads);
    const goalkeeper = changedSquads.find(
      ({ memberId, slotId }) => memberId === 'alpha' && slotId === 'gk-1',
    )!;
    goalkeeper.candidate.role.defending = 0;
    const baseline = evaluate(baselineSquads);
    const changed = evaluate(changedSquads);

    expect(score(changed, 'Shot stopping')).toBeLessThan(score(baseline, 'Shot stopping'));
    expect(score(changed, 'Finishing')).toBe(score(baseline, 'Finishing'));
  });

  it('makes an LW signal affect left-wing threat more than right-wing threat', () => {
    const baselineSquads = semanticSquads();
    const changedSquads = structuredClone(baselineSquads);
    const leftWinger = changedSquads.find(
      ({ memberId, slotId }) => memberId === 'alpha' && slotId === 'lw-1',
    )!;
    leftWinger.candidate.currentFormRating = 0;
    leftWinger.candidate.assists = 0;
    leftWinger.candidate.role.pace = 0;
    leftWinger.candidate.role.technique = 0;
    leftWinger.candidate.role.creativity = 0;
    const baseline = evaluate(baselineSquads);
    const changed = evaluate(changedSquads);
    const leftDelta = Math.abs(
      score(changed, 'Left-wing threat') - score(baseline, 'Left-wing threat'),
    );
    const rightDelta = Math.abs(
      score(changed, 'Right-wing threat') - score(baseline, 'Right-wing threat'),
    );

    expect(leftDelta).toBeGreaterThan(rightDelta);
    expect(rightDelta).toBe(0);
  });

  it('keeps every explicit metric deterministic and within the 0-100 contract', () => {
    const entries = semanticSquads();
    const first = evaluate(entries);
    const second = evaluate(structuredClone(entries));

    expect(second).toEqual(first);
    expect(
      first.metrics
        .flatMap(({ scores }) => Object.values(scores))
        .every((metricScore) => metricScore >= 0 && metricScore <= 100),
    ).toBe(true);
  });

  it('applies the configured form window to final metric scores', () => {
    const entries = semanticSquads();
    const leftWinger = entries.find(
      ({ memberId, slotId }) => memberId === 'alpha' && slotId === 'lw-1',
    )!;
    leftWinger.candidate.currentFormRating = 20;
    leftWinger.candidate.lastFive = [100, 100, 100, 100, 100];

    const recent = evaluate(entries, '5_MATCHES');
    const season = evaluate(entries, 'CURRENT_SEASON');

    expect(score(recent, 'Left-wing threat')).toBeGreaterThan(score(season, 'Left-wing threat'));
    expect(score(recent, 'Right-wing threat')).toBe(score(season, 'Right-wing threat'));
  });
});
