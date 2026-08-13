import type { RoomView } from '@gavel-xi/shared';

const STEPS = [
  'Squad structure',
  'Current form',
  'Manager fit',
  'Auction efficiency',
  '100-match model',
];

export function Evaluating({ room }: { room: RoomView }) {
  const populated = room.evaluation?.metrics.length ?? 0;
  const progress = populated ? Math.min(100, populated) : room.phase === 'FINALIZING' ? 12 : 64;
  return (
    <main className="evaluating" data-testid="evaluation-loading">
      <div className="stadium-lines" />
      <div className="evaluation-glow" />
      <p className="eyebrow">THE AUCTION IS CLOSED</p>
      <h1>
        SCOUTING MODEL
        <br />
        <em>RUNNING</em>
      </h1>
      <div className="metric-wheel" aria-hidden="true">
        <span>100</span>
        <small>METRICS</small>
        {Array.from({ length: 20 }, (_, index) => (
          <i key={index} style={{ transform: `rotate(${index * 18}deg)` }} />
        ))}
      </div>
      <div
        className="evaluation-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div>
          <span style={{ width: `${progress}%` }} />
        </div>
        <b>{progress}%</b>
      </div>
      <ol>
        {STEPS.map((step, index) => (
          <li className={index * 20 <= progress ? 'is-complete' : ''} key={step}>
            <span>{index * 20 <= progress ? '✓' : String(index + 1).padStart(2, '0')}</span>
            {step}
          </li>
        ))}
      </ol>
      <p className="evaluating__note">Numbers decide the table. Narrative only explains it.</p>
    </main>
  );
}
