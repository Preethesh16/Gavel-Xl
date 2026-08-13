export const METRIC_CATEGORIES = [
  'ATTACK',
  'MIDFIELD',
  'DEFENCE',
  'GOALKEEPING',
  'MANAGER & TACTICS',
  'TECHNICAL',
  'PHYSICAL',
  'MENTALITY',
  'CHEMISTRY & BALANCE',
  'MATCH SITUATIONS',
] as const;

export function categoryTone(category: string): string {
  const index = METRIC_CATEGORIES.findIndex((candidate) => candidate === category.toUpperCase());
  return `tone-${Math.max(0, index) % 5}`;
}
