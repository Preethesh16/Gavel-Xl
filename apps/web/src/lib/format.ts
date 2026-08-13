export const MILLION = 1_000_000;

const compactFormatter = new Intl.NumberFormat('en-GB', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatMoney(value: number | null | undefined, exact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (exact) return `€${Math.round(value / MILLION).toLocaleString('en-GB')}M`;
  return `€${compactFormatter.format(value)}`.replace('bn', 'B').replace('m', 'M');
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds / 1_000);
  return seconds < 10 ? seconds.toFixed(1) : Math.ceil(seconds).toString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
