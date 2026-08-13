'use client';

import type { ConnectionState } from '@/hooks/use-gavel-room';
import { CloseIcon, SignalIcon } from './icons';

export function LoadingRoom() {
  return (
    <main className="boot-screen" data-testid="session-loading">
      <div className="stadium-lines" />
      <div className="boot-gavel" aria-hidden="true">
        <span />
        <span />
      </div>
      <p className="eyebrow">ENTERING THE WAR ROOM</p>
      <h1>Restoring your seat.</h1>
      <div className="loading-track">
        <span />
      </div>
    </main>
  );
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  return (
    <div
      className={`connection-pill connection-pill--${state}`}
      data-testid="connection-status"
      role="status"
    >
      <SignalIcon />
      <span>
        {state === 'online'
          ? 'LIVE'
          : state === 'connecting'
            ? 'CONNECTING'
            : state === 'reconnecting'
              ? 'REJOINING'
              : 'OFFLINE'}
      </span>
    </div>
  );
}

export function Toasts({
  error,
  notice,
  onClear,
}: {
  error: string | null;
  notice: string | null;
  onClear: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div
      className={`toast ${error ? 'toast--error' : ''}`}
      role={error ? 'alert' : 'status'}
      data-testid={error ? 'error-toast' : 'notice-toast'}
    >
      <span className="toast__line" />
      <p>{error ?? notice}</p>
      {error ? (
        <button type="button" aria-label="Dismiss" onClick={onClear}>
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}
