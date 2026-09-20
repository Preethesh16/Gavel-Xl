import { describe, expect, it } from 'vitest';
import type { EvaluationView, TeamResultView } from '@gavel-xi/shared';
import { buildCeremonySteps, nextCeremonyChapter } from './results-ceremony';

const teams = ['a', 'b', 'c'].map(
  (memberId, index) => ({ memberId, rank: 3 - index }) as TeamResultView,
);
const evaluation = {
  metrics: Array.from({ length: 100 }, (_, i) => ({
    index: i + 1,
    category: `Category ${Math.floor(i / 10)}`,
    metric: `Metric ${i + 1}`,
    scores: { a: 80, b: 80, c: 70 },
    winnerIds: ['a', 'b'],
  })).reverse(),
  teams,
  awards: [],
  headToHead: [],
  seed: 'test',
  seedCommitment: 'test',
} as EvaluationView;

describe('post-auction ceremony sequence', () => {
  it('compares every metric once, preserving authoritative scores and joint leaders', () => {
    const steps = buildCeremonySteps(evaluation);
    const metrics = steps.filter((step) => step.phase === 'metric').map((step) => step.metric);
    expect(metrics.map((metric) => metric.index)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect(metrics.every((metric) => evaluation.metrics.includes(metric))).toBe(true);
    expect(metrics[0]?.winnerIds).toEqual(['a', 'b']);
    expect(steps.filter((step) => step.phase === 'category')).toHaveLength(10);
  });
  it('holds the verdict until comparisons and every analysis are finished, then tours every lineup', () => {
    const steps = buildCeremonySteps(evaluation);
    expect(steps.slice(110).map((step) => step.phase)).toEqual([
      'analysis',
      'analysis',
      'analysis',
      'verdict',
      'lineup',
      'lineup',
      'lineup',
    ]);
    expect(
      steps.filter((step) => step.phase === 'analysis').map((step) => step.team.memberId),
    ).toEqual(['a', 'b', 'c']);
    expect(
      steps.filter((step) => step.phase === 'lineup').map((step) => step.team.memberId),
    ).toEqual(['c', 'b', 'a']);
    expect(nextCeremonyChapter(steps, 0)).toBe(110);
    expect(nextCeremonyChapter(steps, 70)).toBe(110);
    expect(nextCeremonyChapter(steps, 110)).toBe(113);
    expect(nextCeremonyChapter(steps, 113)).toBe(114);
    expect(nextCeremonyChapter(steps, 116)).toBe(117);
  });
  it('uses director order for analysis even when the server returns winner-first rankings', () => {
    const steps = buildCeremonySteps({ ...evaluation, teams: [...teams].reverse() }, [
      'a',
      'b',
      'c',
    ]);
    expect(
      steps.filter((step) => step.phase === 'analysis').map((step) => step.team.memberId),
    ).toEqual(['a', 'b', 'c']);
  });
  it('handles an empty result without constructing invalid metric or team slides', () => {
    expect(buildCeremonySteps({ ...evaluation, metrics: [], teams: [] })).toEqual([
      { phase: 'verdict', chapter: 'verdict' },
    ]);
  });
});
