'use client';

import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import { useEffect, useState } from 'react';
import { MetricsExplorer } from './metrics-explorer';
import { Podium } from './podium';
import { Replay } from './replay';
import { ShareResults } from './share-results';
import { TeamBoard } from './team-check';
import { ReplayIcon, ShareIcon, TeamIcon } from './icons';

type ResultTab = 'podium' | 'teams' | 'metrics' | 'replay' | 'share';

export function ResultsHub({
  room,
  me,
  readOnly = false,
}: {
  room: RoomView;
  me: RoomMemberView;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<ResultTab>('podium');
  const evaluation = room.evaluation;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    if (
      requested === 'metrics' ||
      requested === 'replay' ||
      requested === 'share' ||
      requested === 'teams' ||
      requested === 'podium'
    )
      setTab(requested);
  }, []);

  if (!evaluation) return null;
  const chooseTab = (next: ResultTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next === 'podium' ? 'results' : next);
    window.history.replaceState({}, '', url);
  };

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
      <div className="results-hub__body">
        {tab === 'podium' ? <Podium room={room} evaluation={evaluation} /> : null}
        {tab === 'teams' ? (
          <section className="final-teams" data-testid="results-teams">
            <header className="results-section-heading">
              <div>
                <p className="eyebrow">FINAL LINEUPS</p>
                <h2>THE COMPLETED XIs</h2>
              </div>
              <p>{room.settings.formation} · CURRENT-FORM SNAPSHOT</p>
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
      <div className="result-personal">
        <span>{readOnly ? 'PUBLIC VERDICT' : 'VIEWING AS'}</span>
        <b>{readOnly ? room.code : me.name}</b>
        <i style={{ background: readOnly ? 'var(--acid)' : me.color }} />
      </div>
    </main>
  );
}
