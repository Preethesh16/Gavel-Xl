import type { CandidateSnapshot, Position, RoleProfile, RoomSettingsInput } from '@gavel-xi/shared';

export type PositionModel =
  'GK' | 'CB' | 'FB_WB' | 'DM' | 'CM' | 'AM' | 'WINGER' | 'ST' | 'MANAGER';

export const CURRENT_FORM_WEIGHTS = Object.freeze({
  currentPerformance: 0.45,
  availabilityMinutes: 0.15,
  currentRoleImportance: 0.1,
  competitionStrength: 0.1,
  valuationSignal: 0.1,
  lastMatchForm: 0.1,
});

const PERFORMANCE_ROLE_WEIGHTS: Record<
  PositionModel,
  Partial<Record<keyof RoleProfile, number>>
> = {
  GK: { defending: 0.3, composure: 0.25, aerial: 0.2, passing: 0.15, pace: 0.1 },
  CB: { defending: 0.35, aerial: 0.2, physical: 0.15, pace: 0.15, passing: 0.15 },
  FB_WB: {
    defending: 0.23,
    pace: 0.22,
    passing: 0.18,
    technique: 0.14,
    pressing: 0.13,
    creativity: 0.1,
  },
  DM: {
    defending: 0.25,
    passing: 0.22,
    pressing: 0.18,
    composure: 0.15,
    physical: 0.12,
    technique: 0.08,
  },
  CM: {
    passing: 0.25,
    technique: 0.2,
    creativity: 0.17,
    pressing: 0.14,
    composure: 0.14,
    physical: 0.1,
  },
  AM: {
    creativity: 0.27,
    technique: 0.23,
    passing: 0.18,
    finishing: 0.14,
    composure: 0.1,
    pace: 0.08,
  },
  WINGER: {
    pace: 0.24,
    technique: 0.22,
    creativity: 0.18,
    finishing: 0.16,
    pressing: 0.1,
    composure: 0.1,
  },
  ST: {
    finishing: 0.32,
    composure: 0.18,
    aerial: 0.14,
    physical: 0.13,
    pace: 0.13,
    technique: 0.1,
  },
  MANAGER: {
    composure: 0.3,
    creativity: 0.2,
    pressing: 0.15,
    passing: 0.15,
    defending: 0.1,
    technique: 0.1,
  },
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function weightedRole(role: RoleProfile, model: PositionModel): number {
  return Object.entries(PERFORMANCE_ROLE_WEIGHTS[model]).reduce(
    (score, [key, weight]) => score + role[key as keyof RoleProfile] * weight,
    0,
  );
}

export function positionModel(position: Position): PositionModel {
  switch (position) {
    case 'GK':
      return 'GK';
    case 'CB':
      return 'CB';
    case 'LB':
    case 'RB':
    case 'LWB':
    case 'RWB':
      return 'FB_WB';
    case 'DM':
      return 'DM';
    case 'CM':
      return 'CM';
    case 'AM':
      return 'AM';
    case 'LW':
    case 'RW':
      return 'WINGER';
    case 'ST':
      return 'ST';
    case 'MANAGER':
      return 'MANAGER';
  }
}

function valuationSignal(valueEUR: number | null): number {
  if (valueEUR === null || valueEUR <= 0) return 45;
  const minimum = Math.log10(1_000_000);
  const maximum = Math.log10(200_000_000);
  return clamp(((Math.log10(valueEUR) - minimum) / (maximum - minimum)) * 100);
}

export type FormLookback = RoomSettingsInput['formLookback'];

/**
 * Providers expose a season aggregate plus up to five recent match ratings. The
 * ten-match option combines both signals rather than inventing five unavailable
 * match values; providers with no recent-match feed fall back to their season
 * aggregate for every option.
 */
export function formRating(
  candidate: CandidateSnapshot,
  lookback: FormLookback = 'CURRENT_SEASON',
): number {
  if (candidate.lastFive.length === 0 || lookback === 'CURRENT_SEASON') {
    return candidate.currentFormRating;
  }
  const recentFive =
    candidate.lastFive.reduce((sum, value) => sum + value, 0) / candidate.lastFive.length;
  if (lookback === '5_MATCHES') return clamp(recentFive);
  return clamp(recentFive * 0.5 + candidate.currentFormRating * 0.5);
}

/** Position-aware current strength. A CB is never rewarded with a striker's goal model. */
export function scoreCurrentForm(
  candidate: CandidateSnapshot,
  lookback: FormLookback = 'CURRENT_SEASON',
): number {
  const model = positionModel(candidate.preferredPosition);
  const rolePerformance = weightedRole(candidate.role, model);
  const selectedForm = formRating(candidate, lookback);
  const currentPerformance = selectedForm * 0.62 + rolePerformance * 0.38;
  const minutesAvailability = clamp(
    candidate.availabilityRating * 0.7 + Math.min(100, (candidate.minutes / 2_700) * 100) * 0.3,
  );
  const roleImportance = clamp(
    Math.min(100, (candidate.starts / Math.max(1, candidate.appearances)) * 100) * 0.55 +
      rolePerformance * 0.45,
  );
  const score =
    currentPerformance * CURRENT_FORM_WEIGHTS.currentPerformance +
    minutesAvailability * CURRENT_FORM_WEIGHTS.availabilityMinutes +
    roleImportance * CURRENT_FORM_WEIGHTS.currentRoleImportance +
    candidate.competitionStrength * CURRENT_FORM_WEIGHTS.competitionStrength +
    valuationSignal(candidate.valuation.valueEUR) * CURRENT_FORM_WEIGHTS.valuationSignal +
    selectedForm * CURRENT_FORM_WEIGHTS.lastMatchForm;
  return Math.round(clamp(score) * 10) / 10;
}

export function positionPercentiles(
  candidates: CandidateSnapshot[],
  lookback: FormLookback = 'CURRENT_SEASON',
): Map<string, number> {
  const groups = new Map<PositionModel, CandidateSnapshot[]>();
  for (const candidate of candidates) {
    const model = positionModel(candidate.preferredPosition);
    groups.set(model, [...(groups.get(model) ?? []), candidate]);
  }
  const result = new Map<string, number>();
  for (const group of groups.values()) {
    const ranked = [...group].sort(
      (left, right) =>
        scoreCurrentForm(left, lookback) - scoreCurrentForm(right, lookback) ||
        left.id.localeCompare(right.id),
    );
    ranked.forEach((candidate, index) => {
      result.set(
        candidate.id,
        ranked.length === 1 ? 100 : Math.round((index / (ranked.length - 1)) * 100),
      );
    });
  }
  return result;
}
