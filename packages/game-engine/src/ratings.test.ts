import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from './test-fixtures.js';
import {
  CURRENT_FORM_WEIGHTS,
  formRating,
  positionModel,
  positionPercentiles,
  scoreCurrentForm,
} from './ratings.js';

describe('position-aware current-form model', () => {
  it('keeps broad weights explicit and normalized', () => {
    expect(
      Object.values(CURRENT_FORM_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
    ).toBeCloseTo(1);
    expect(positionModel('GK')).toBe('GK');
    expect(positionModel('CB')).toBe('CB');
    expect(positionModel('RW')).toBe('WINGER');
    expect(positionModel('ST')).toBe('ST');
  });

  it('scores every role from zero to one hundred and calculates within-position percentiles', () => {
    const candidates = fixtureSnapshot().candidates;
    expect(
      candidates.every((candidate) => {
        const score = scoreCurrentForm(candidate);
        return score >= 0 && score <= 100;
      }),
    ).toBe(true);
    const percentiles = positionPercentiles(candidates);
    expect(percentiles.size).toBe(candidates.length);
    expect(Math.max(...percentiles.values())).toBe(100);
    expect(Math.min(...percentiles.values())).toBe(0);
  });

  it('values role-specific skills instead of comparing centre-back goals to striker goals', () => {
    const candidates = fixtureSnapshot().candidates;
    const centreBack = structuredClone(
      candidates.find((candidate) => candidate.preferredPosition === 'CB')!,
    );
    const striker = structuredClone(
      candidates.find((candidate) => candidate.preferredPosition === 'ST')!,
    );
    const centreBackBaseline = scoreCurrentForm(centreBack);
    const strikerBaseline = scoreCurrentForm(striker);
    centreBack.role.finishing = 100;
    striker.role.finishing = 100;
    expect(scoreCurrentForm(centreBack) - centreBackBaseline).toBeLessThan(
      scoreCurrentForm(striker) - strikerBaseline,
    );
  });

  it('honors five-match, ten-match, and current-season lookbacks without fabricating data', () => {
    const candidate = structuredClone(fixtureSnapshot().candidates[0]!);
    candidate.currentFormRating = 40;
    candidate.lastFive = [90, 92, 94, 96, 98];

    expect(formRating(candidate, '5_MATCHES')).toBe(94);
    expect(formRating(candidate, '10_MATCHES')).toBe(67);
    expect(formRating(candidate, 'CURRENT_SEASON')).toBe(40);
    expect(scoreCurrentForm(candidate, '5_MATCHES')).toBeGreaterThan(
      scoreCurrentForm(candidate, '10_MATCHES'),
    );
    expect(scoreCurrentForm(candidate, '10_MATCHES')).toBeGreaterThan(
      scoreCurrentForm(candidate, 'CURRENT_SEASON'),
    );

    candidate.lastFive = [];
    expect(formRating(candidate, '5_MATCHES')).toBe(40);
    expect(formRating(candidate, '10_MATCHES')).toBe(40);
  });
});
