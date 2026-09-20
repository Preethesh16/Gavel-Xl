import type { EvaluationView, MetricScoreView, TeamResultView } from '@gavel-xi/shared';

export type CeremonyChapter = 'comparison' | 'analysis' | 'verdict' | 'lineup';
export type CeremonyStep =
  | { phase: 'category'; chapter: 'comparison'; category: string; count: number }
  | { phase: 'metric'; chapter: 'comparison'; metric: MetricScoreView }
  | { phase: 'analysis'; chapter: 'analysis'; team: TeamResultView }
  | { phase: 'verdict'; chapter: 'verdict' }
  | { phase: 'lineup'; chapter: 'lineup'; team: TeamResultView };

/** Every locked metric appears exactly once; presentation never recomputes the verdict. */
export function buildCeremonySteps(
  evaluation: EvaluationView,
  directorIds: string[] = [],
): CeremonyStep[] {
  const metrics = [...evaluation.metrics].sort((a, b) => a.index - b.index);
  const categories = [...new Set(metrics.map((metric) => metric.category))];
  const steps: CeremonyStep[] = [];
  for (const category of categories) {
    const categoryMetrics = metrics.filter((metric) => metric.category === category);
    steps.push({
      phase: 'category',
      chapter: 'comparison',
      category,
      count: categoryMetrics.length,
    });
    steps.push(
      ...categoryMetrics.map((metric): CeremonyStep => ({
        phase: 'metric',
        chapter: 'comparison',
        metric,
      })),
    );
  }
  // Keep the original director order for analysis. Ranking is revealed only at the verdict.
  steps.push(
    ...[...evaluation.teams]
      .sort((a, b) => {
        const aIndex = directorIds.indexOf(a.memberId);
        const bIndex = directorIds.indexOf(b.memberId);
        return (
          (aIndex < 0 ? directorIds.length : aIndex) - (bIndex < 0 ? directorIds.length : bIndex)
        );
      })
      .map((team): CeremonyStep => ({
        phase: 'analysis',
        chapter: 'analysis',
        team,
      })),
  );
  steps.push({ phase: 'verdict', chapter: 'verdict' });
  steps.push(
    ...[...evaluation.teams]
      .sort((a, b) => a.rank - b.rank)
      .map((team): CeremonyStep => ({ phase: 'lineup', chapter: 'lineup', team })),
  );
  return steps;
}

export function nextCeremonyChapter(steps: CeremonyStep[], index: number): number {
  const chapter = steps[index]?.chapter;
  const next = steps.findIndex((step, candidate) => candidate > index && step.chapter !== chapter);
  return next < 0 ? steps.length : next;
}

export function ceremonyDuration(step: CeremonyStep): number {
  switch (step.phase) {
    case 'category':
      return 4200;
    case 'metric':
      return 5200;
    case 'analysis':
      return 12000;
    case 'verdict':
      return 11000;
    case 'lineup':
      return 12000;
  }
}
