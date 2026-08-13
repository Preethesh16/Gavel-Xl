'use client';

import { useEffect } from 'react';
import { Brand } from '@/components/brand';
import { ReplayIcon } from '@/components/icons';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Gavel XI render boundary', error);
  }, [error]);

  return (
    <main className="fatal-screen" data-testid="fatal-error">
      <div className="stadium-lines" />
      <Brand />
      <p className="eyebrow">VAR CHECK COMPLETE</p>
      <h1>
        PLAY
        <br />
        <em>INTERRUPTED.</em>
      </h1>
      <p>
        The room state is safe. Re-enter this screen to restore the latest authoritative snapshot.
      </p>
      <button type="button" data-testid="fatal-error-retry" onClick={reset}>
        <ReplayIcon /> RETRY CONNECTION
      </button>
      {error.digest ? <small>REFERENCE {error.digest}</small> : null}
    </main>
  );
}
