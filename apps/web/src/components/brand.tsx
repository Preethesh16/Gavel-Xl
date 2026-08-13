import { GavelIcon } from './icons';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'brand brand--compact' : 'brand'} aria-label="Gavel XI">
      <span className="brand__mark">
        <GavelIcon />
      </span>
      <span className="brand__word">
        GAVEL <i>XI</i>
      </span>
    </div>
  );
}
