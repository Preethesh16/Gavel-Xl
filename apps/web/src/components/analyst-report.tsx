'use client';

import type { EvaluationView, RoomView, TeamResultView } from '@gavel-xi/shared';
import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';

const REVEAL_INTERVAL_MS = 620;

function memberName(room: RoomView, memberId: string): string {
  return room.members.find(({ id }) => id === memberId)?.name ?? 'Director';
}

function memberColor(room: RoomView, memberId: string): string {
  return room.members.find(({ id }) => id === memberId)?.color ?? '#f1bf00';
}

function CategoryScoreBars({
  room,
  teams,
  category,
  animate = true,
}: {
  room: RoomView;
  teams: TeamResultView[];
  category: string;
  animate?: boolean;
}) {
  const ranked = [...teams].sort(
    (left, right) => (right.categoryScores[category] ?? 0) - (left.categoryScores[category] ?? 0),
  );
  return (
    <div className={`category-score-bars ${animate ? 'is-animated' : ''}`}>
      {ranked.map((team, index) => {
        const score = team.categoryScores[category] ?? 0;
        return (
          <div className={index === 0 ? 'is-winner' : ''} key={team.memberId}>
            <span>{memberName(room, team.memberId)}</span>
            <i>
              <b
                style={
                  {
                    '--score-width': `${Math.max(0, Math.min(100, score))}%`,
                    '--score-color': memberColor(room, team.memberId),
                    '--score-delay': `${index * 90}ms`,
                  } as React.CSSProperties
                }
              />
            </i>
            <strong>{score.toFixed(1)}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function VerdictReveal({
  room,
  evaluation,
  onComplete,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  onComplete: () => void;
}) {
  const categories = useMemo(
    () => Object.keys(evaluation.teams[0]?.categoryScores ?? {}),
    [evaluation.teams],
  );
  const [visible, setVisible] = useState(
    process.env.NEXT_PUBLIC_E2E === 'true' ? categories.length : 0,
  );

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E === 'true') {
      onComplete();
      return;
    }
    if (visible >= categories.length) {
      const unlock = window.setTimeout(onComplete, 950);
      return () => window.clearTimeout(unlock);
    }
    const timer = window.setTimeout(() => setVisible((count) => count + 1), REVEAL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [categories.length, onComplete, visible]);

  return (
    <section className="verdict-reveal" data-testid="verdict-reveal">
      <header>
        <p className="eyebrow">THE NUMBERS ARE LOCKED</p>
        <h1>
          TEN ROUNDS.
          <br />
          <em>ONE VERDICT.</em>
        </h1>
        <p>Category leaders arrive one by one. The champion stays sealed until the board closes.</p>
      </header>
      <div className="verdict-reveal__status">
        <span>{String(Math.min(visible, categories.length)).padStart(2, '0')}</span>
        <i>
          <b
            style={{ width: `${categories.length ? (visible / categories.length) * 100 : 100}%` }}
          />
        </i>
        <strong>{String(categories.length).padStart(2, '0')} ROUNDS</strong>
      </div>
      <div className="verdict-rounds" aria-live="polite">
        {categories.slice(0, visible).map((category, index) => {
          const scores = evaluation.teams.map((team) => team.categoryScores[category] ?? 0);
          const best = Math.max(...scores);
          const winners = evaluation.teams.filter(
            (team) => (team.categoryScores[category] ?? 0) === best,
          );
          return (
            <article key={category} style={{ '--round-index': index } as React.CSSProperties}>
              <div>
                <span>
                  {String(index * 10 + 1).padStart(2, '0')}–{(index + 1) * 10}
                </span>
                <h2>{category}</h2>
                <p>{winners.map(({ memberId }) => memberName(room, memberId)).join(' & ')} LEADS</p>
              </div>
              <CategoryScoreBars room={room} teams={evaluation.teams} category={category} />
            </article>
          );
        })}
      </div>
      <button
        className="verdict-skip"
        type="button"
        onClick={() => {
          setVisible(categories.length);
          onComplete();
        }}
      >
        REVEAL THE FINAL VERDICT →
      </button>
    </section>
  );
}

export function AnalystReport({
  room,
  evaluation,
}: {
  room: RoomView;
  evaluation: EvaluationView;
}) {
  const report = evaluation.analystReport;
  const rankings = [...evaluation.teams].sort((left, right) => left.rank - right.rank);
  const categories = Object.keys(rankings[0]?.categoryScores ?? {});
  const reportByCategory = new Map(
    report?.categoryVerdicts.map((category) => [category.category, category]) ?? [],
  );
  const reportByTeam = new Map(
    report?.teamVerdicts.map((verdict) => [verdict.memberId, verdict]) ?? [],
  );

  return (
    <section className="analyst-report" data-testid="analyst-report">
      <header className="analyst-report__lead">
        <div>
          <p className="eyebrow">
            {report?.source === 'groq' ? 'GROQ ANALYST DESK' : 'ENGINE ANALYST DESK'}
          </p>
          <h2>{report?.headline ?? 'THE COMPLETE FOOTBALL VERDICT'}</h2>
        </div>
        <p>
          {report?.opening ??
            'The scores below were locked by the 100-metric model. This breakdown shows exactly where each XI won, where it lost ground, and why the final table finished this way.'}
        </p>
      </header>

      <div className="analyst-category-list">
        {categories.map((category, categoryIndex) => {
          const metrics = evaluation.metrics.filter((metric) => metric.category === category);
          const verdict = reportByCategory.get(category);
          const best = Math.max(
            ...evaluation.teams.map((team) => team.categoryScores[category] ?? 0),
          );
          const winners = evaluation.teams.filter(
            (team) => (team.categoryScores[category] ?? 0) === best,
          );
          return (
            <article className="analyst-category" key={category}>
              <header>
                <span>
                  {String(categoryIndex * 10 + 1).padStart(2, '0')}–{(categoryIndex + 1) * 10}
                </span>
                <div>
                  <p>CATEGORY {String(categoryIndex + 1).padStart(2, '0')}</p>
                  <h3>{category}</h3>
                </div>
                <strong>
                  {winners.map(({ memberId }) => memberName(room, memberId)).join(' & ')}
                </strong>
              </header>
              <div className="analyst-category__body">
                <div className="metric-winner-table">
                  {metrics.map((metric) => (
                    <div key={metric.index}>
                      <span>{String(metric.index).padStart(3, '0')}</span>
                      <p>{metric.metric}</p>
                      <b>{metric.winnerIds.map((id) => memberName(room, id)).join(' & ')}</b>
                      <em>{Math.max(...Object.values(metric.scores)).toFixed(1)}</em>
                    </div>
                  ))}
                </div>
                <aside>
                  <CategoryScoreBars room={room} teams={evaluation.teams} category={category} />
                  <p>
                    {verdict?.summary ??
                      `${winners.map(({ memberId }) => memberName(room, memberId)).join(' and ')} owns the category on the locked model, with the strongest combined profile across these ten tests.`}
                  </p>
                </aside>
              </div>
            </article>
          );
        })}
      </div>

      <section className="team-deep-dives">
        <header>
          <p className="eyebrow">SQUAD-BY-SQUAD</p>
          <h2>THE TACTICAL DEEP DIVE</h2>
        </header>
        {rankings.map((team) => {
          const verdict = reportByTeam.get(team.memberId);
          const squad = room.squads.filter(({ memberId }) => memberId === team.memberId);
          return (
            <article key={team.memberId}>
              <header
                style={
                  { '--member-color': memberColor(room, team.memberId) } as React.CSSProperties
                }
              >
                <span>#{team.rank}</span>
                <div>
                  <p>{team.rank === 1 ? 'DRAFT CHAMPION' : `FINAL RANK ${team.rank}`}</p>
                  <h3>{memberName(room, team.memberId)}</h3>
                </div>
                <strong>
                  {team.overallScore.toFixed(1)}
                  <small>/100</small>
                </strong>
              </header>
              <div className="team-deep-dive__body">
                <div className="squad-sheet">
                  {squad.map((entry) => (
                    <div key={entry.id}>
                      <span>{entry.candidate.preferredPosition}</span>
                      <b>{entry.candidate.commonName || entry.candidate.fullName}</b>
                      <small>{formatMoney(entry.purchasePriceEUR, true)}</small>
                    </div>
                  ))}
                </div>
                <div className="team-verdict-copy">
                  <p>
                    {verdict?.verdict ??
                      `${memberName(room, team.memberId)} finishes with ${team.metricWins} metric wins and a clear identity built around ${team.strengths.join(' and ')}.`}
                  </p>
                  <dl>
                    <div>
                      <dt>IDENTITY</dt>
                      <dd>{verdict?.tacticalIdentity ?? team.strengths[0]}</dd>
                    </div>
                    <div>
                      <dt>DECISIVE EDGE</dt>
                      <dd>{verdict?.decisiveEdge ?? team.strengths[1]}</dd>
                    </div>
                    <div>
                      <dt>THE CONCERN</dt>
                      <dd>{verdict?.concern ?? team.weakness}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="analyst-final-word">
        <p className="eyebrow">WHY THE WINNER WON</p>
        <h2>{memberName(room, rankings[0]?.memberId ?? '')}</h2>
        <strong>{rankings[0]?.overallScore.toFixed(1)} / 100</strong>
        <p>
          {report?.finalWhy ??
            `${memberName(room, rankings[0]?.memberId ?? '')} finished first because the XI produced the best aggregate result across all 100 locked metrics, pairing its strongest categories with fewer costly weaknesses than the chasing teams.`}
        </p>
        <blockquote>
          {report?.closingLine ??
            'The auction is over. The football argument has only just started.'}
        </blockquote>
      </section>
    </section>
  );
}
