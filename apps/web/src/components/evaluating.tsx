'use client';

import type { RoomView } from '@gavel-xi/shared';
import { useEffect, useState } from 'react';

const STEPS = [
  'Squad structure',
  'Player profiles',
  'Manager fit',
  'Auction efficiency',
  '100-match model',
];

export function Evaluating({ room }: { room: RoomView }) {
  const populated = room.evaluation?.metrics.length ?? 0;
  const [simulatedProgress, setSimulatedProgress] = useState(room.phase === 'FINALIZING' ? 8 : 58);
  useEffect(() => {
    if (populated) return;
    const timer = window.setInterval(
      () => setSimulatedProgress((current) => Math.min(94, current + (current < 55 ? 7 : 2))),
      process.env.NEXT_PUBLIC_E2E === 'true' ? 20 : 480,
    );
    return () => window.clearInterval(timer);
  }, [populated]);
  const progress = populated ? Math.min(100, populated) : simulatedProgress;
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
      <div className="evaluating__ticker" aria-live="polite">
        <span>{STEPS[Math.min(STEPS.length - 1, Math.floor(progress / 20))]}</span>
        <strong>{progress < 95 ? 'ANALYSIS IN PROGRESS' : 'LOCKING THE VERDICT'}</strong>
      </div>
      <p className="evaluating__note">Numbers decide the table. Groq explains the football.</p>
    </main>
  );
}
