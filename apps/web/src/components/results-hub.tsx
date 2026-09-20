'use client';

import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import { useCallback, useEffect, useState } from 'react';
import { AnalystReport } from './analyst-report';
import { ResultsCeremony } from './results-ceremony';
import { MetricsExplorer } from './metrics-explorer';
import { Podium } from './podium';
import { Replay } from './replay';
import { ShareResults } from './share-results';
import { TeamBoard } from './team-check';
import { ReplayIcon, ShareIcon, TeamIcon } from './icons';

type ResultTab = 'podium' | 'analysis' | 'teams' | 'metrics' | 'replay' | 'share';

export function ResultsHub({
  room,
  me,
  readOnly = false,
  busyAction = null,
  onRestart,
}: {
  room: RoomView;
  me: RoomMemberView;
  readOnly?: boolean;
  busyAction?: string | null;
  onRestart?: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [tab, setTab] = useState<ResultTab>('podium');
  const [revealComplete, setRevealComplete] = useState(readOnly);
  const [presentationShown, setPresentationShown] = useState(false);
  const [resolved, setResolved] = useState(readOnly);
  const evaluation = room.evaluation;
  const completionKey = `gavel-xi:ceremony:${room.code}:${evaluation?.seed ?? ''}`;
  const completeReveal = useCallback(() => {
    setRevealComplete(true);
    setPresentationShown(true);
    setTab('podium');
    try {
      window.sessionStorage.setItem(completionKey, 'complete');
    } catch {
      /* Storage is optional. */
    }
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'results');
    window.history.replaceState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [completionKey]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    if (
      requested === 'metrics' ||
      requested === 'analysis' ||
      requested === 'replay' ||
      requested === 'share' ||
      requested === 'teams' ||
      requested === 'podium' ||
      requested === 'results'
    ) {
      setTab(requested === 'results' ? 'podium' : requested);
      setRevealComplete(true);
    } else {
      try {
        setRevealComplete(readOnly || window.sessionStorage.getItem(completionKey) === 'complete');
      } catch {
        setRevealComplete(readOnly);
      }
    }
    setResolved(true);
  }, [completionKey, readOnly]);

  if (!evaluation || !resolved) return null;
  const chooseTab = (next: ResultTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next === 'podium' ? 'results' : next);
    window.history.replaceState({}, '', url);
  };

  if (!revealComplete) {
    return (
      <main className="results-hub" data-testid="results-screen">
        <ResultsCeremony room={room} evaluation={evaluation} onComplete={completeReveal} />
      </main>
    );
  }

  return (
    <main className="results-hub" data-testid="results-screen">
      <nav className="results-nav" aria-label="Final result views">
        <button
          className={tab === 'podium' ? 'is-active' : ''}
          data-testid="results-tab-podium"
          type="button"
          onClick={() => chooseTab('podium')}
        >
          <span>01</span> VERDICT
        </button>
        <button
          className={tab === 'analysis' ? 'is-active' : ''}
          data-testid="results-tab-analysis"
          type="button"
          onClick={() => chooseTab('analysis')}
        >
          <span>AI</span> ANALYSIS
        </button>
        <button
          className={tab === 'teams' ? 'is-active' : ''}
          data-testid="results-tab-teams"
          type="button"
          onClick={() => chooseTab('teams')}
        >
          <TeamIcon /> TEAMS
        </button>
        <button
          className={tab === 'metrics' ? 'is-active' : ''}
          data-testid="results-tab-metrics"
          type="button"
          onClick={() => chooseTab('metrics')}
        >
          <span>100</span> METRICS
        </button>
        <button
          className={tab === 'replay' ? 'is-active' : ''}
          data-testid="results-tab-replay"
          type="button"
          onClick={() => chooseTab('replay')}
        >
          <ReplayIcon /> RECAP
        </button>
        <button
          className={tab === 'share' ? 'is-active' : ''}
          data-testid="results-tab-share"
          type="button"
          onClick={() => chooseTab('share')}
        >
          <ShareIcon /> SHARE
        </button>
      </nav>
      <div className="results-hub__body" key={tab}>
        {tab === 'podium' ? (
          <button
            className="ceremony-replay"
            data-testid="replay-ceremony"
            onClick={() => {
              setPresentationShown(true);
              setRevealComplete(false);
              window.scrollTo({ top: 0, behavior: 'instant' });
            }}
          >
            <ReplayIcon /> REPLAY THE FULL SHOW
          </button>
        ) : null}
        {tab === 'podium' ? (
          <Podium room={room} evaluation={evaluation} announce={!presentationShown} />
        ) : null}
        {tab === 'analysis' ? <AnalystReport room={room} evaluation={evaluation} /> : null}
        {tab === 'teams' ? (
          <section className="final-teams" data-testid="results-teams">
            <header className="results-section-heading">
              <div>
                <p className="eyebrow">FINAL LINEUPS</p>
                <h2>THE COMPLETED XIs</h2>
              </div>
              <p>{room.settings.formation} · LOCKED MODEL SNAPSHOT</p>
            </header>
            <div>
              {room.members
                .filter((member) => !member.isSpectator)
                .map((member) => (
                  <TeamBoard
                    key={member.id}
                    room={room}
                    member={member}
                    compact={room.members.length > 3}
                  />
                ))}
            </div>
          </section>
        ) : null}
        {tab === 'metrics' ? <MetricsExplorer room={room} evaluation={evaluation} /> : null}
        {tab === 'replay' ? <Replay room={room} /> : null}
        {tab === 'share' ? <ShareResults room={room} evaluation={evaluation} /> : null}
      </div>
      {!readOnly ? (
        <section className="rematch-panel" data-testid="rematch-panel">
          <div>
            <p className="eyebrow">RUN IT BACK</p>
            <h2>DIFFERENT FORMATION. NEW MARKET. NO EXCUSES.</h2>
            <p>
              {me.isHost
                ? 'Take the same directors back to the lobby, then choose a new formation, budget and auction settings.'
                : 'The host can return this room to the lobby for a new formation and a completely fresh draft.'}
            </p>
          </div>
          {me.isHost && onRestart ? (
            <button
              data-testid="rematch-draft"
              disabled={busyAction !== null}
              type="button"
              onClick={() => void onRestart()}
            >
              {busyAction === 'restart' ? 'RESETTING THE ROOM…' : 'REMATCH / CHANGE SETTINGS'}{' '}
              <span>→</span>
            </button>
          ) : (
            <strong className="rematch-panel__waiting">WAITING FOR THE HOST</strong>
          )}
        </section>
      ) : null}
      <div className="result-personal">
        <span>{readOnly ? 'PUBLIC VERDICT' : 'VIEWING AS'}</span>
        <b>{readOnly ? room.code : me.name}</b>
        <i style={{ background: readOnly ? 'var(--acid)' : me.color }} />
      </div>
    </main>
  );
}
