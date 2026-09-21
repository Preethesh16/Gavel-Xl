'use client';

import type { EvaluationView, PenaltyKickView, RoomView } from '@gavel-xi/shared';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { cancelBroadcastNarration, emitBroadcast } from '@/lib/broadcast-audio';
import { initials } from '@/lib/format';
import styles from './head-to-head-tape.module.css';

type Match = EvaluationView['headToHead'][number];
const outcomeLabels = { SCORED: 'GOAL', SAVED: 'SAVED', MISSED: 'WIDE' } as const;

function KickTrail({
  kicks,
  visibleCount,
  memberId,
  teamName,
}: {
  kicks: PenaltyKickView[];
  visibleCount: number;
  memberId: string;
  teamName: string;
}) {
  const teamKicks = kicks.filter((kick) => kick.memberId === memberId);
  const visible = kicks.slice(0, visibleCount).filter((kick) => kick.memberId === memberId);
  return (
    <ol className={styles.trail} aria-label={`${teamName} penalties`}>
      {Array.from({ length: Math.max(5, teamKicks.length) }, (_, index) => {
        const kick = visible[index];
        return (
          <li
            key={index}
            className={index >= 5 ? styles.suddenKick : undefined}
            data-outcome={kick?.outcome ?? 'PENDING'}
            title={
              kick ? `${kick.takerName}: ${outcomeLabels[kick.outcome].toLowerCase()}` : undefined
            }
            aria-label={`Kick ${index + 1}: ${kick ? `${kick.takerName}, ${outcomeLabels[kick.outcome].toLowerCase()}` : 'not taken'}`}
          >
            {kick ? kick.outcome === 'SCORED' ? '●' : '×' : <small>{index + 1}</small>}
          </li>
        );
      })}
    </ol>
  );
}

function ShootoutReplay({
  room,
  match,
  run,
  onFinish,
  onKick,
}: {
  room: RoomView;
  match: Match;
  run: number;
  onFinish: () => void;
  onKick: (count: number) => void;
}) {
  const shootout = match.penaltyShootout!;
  const [index, setIndex] = useState(0);
  const [landedIndex, setLandedIndex] = useState(-1);
  const landed = landedIndex === index;
  const kick = shootout.kicks[index];
  const takerTeam = room.members.find((member) => member.id === kick?.memberId);
  const winner = room.members.find((member) => member.id === shootout.winnerId);
  const winnerName = winner?.name ?? 'The winning team';

  useEffect(() => {
    let disposed = false;
    let animationDone = false;
    let narrationDone = false;
    const advance = () => {
      if (disposed || !animationDone || !narrationDone) return;
      if (kick) setIndex((current) => current + 1);
      else onFinish();
    };
    const shotTimer = setTimeout(() => {
      if (disposed || !kick) return;
      setLandedIndex(index);
      onKick(index + 1);
      emitBroadcast({
        id: `penalty-impact-${room.code}-${match.homeMemberId}-${match.awayMemberId}-${run}-${index}`,
        cue: kick.outcome === 'SCORED' ? 'category' : 'unsold',
      });
    }, 950);
    const sceneTimer = setTimeout(
      () => {
        animationDone = true;
        advance();
      },
      kick ? 2_300 : 2_600,
    );
    const result = kick
      ? kick.outcome === 'SCORED'
        ? 'Scores!'
        : kick.outcome === 'SAVED'
          ? 'Saved by the keeper!'
          : 'Off target!'
      : '';
    emitBroadcast({
      id: `penalties-${room.code}-${match.homeMemberId}-${match.awayMemberId}-${run}-${index}`,
      cue: kick ? 'reveal' : 'winner',
      message: kick
        ? `${kick.round > 5 ? 'Sudden death. ' : ''}${kick.takerName} for ${takerTeam?.name ?? 'the team'}. ${result}`
        : `${winnerName} win on penalties, ${Math.max(shootout.homeGoals, shootout.awayGoals)} to ${Math.min(shootout.homeGoals, shootout.awayGoals)}!`,
      delayMs: 80,
      onSettled: () => {
        narrationDone = true;
        advance();
      },
    });
    return () => {
      disposed = true;
      clearTimeout(shotTimer);
      clearTimeout(sceneTimer);
      cancelBroadcastNarration();
    };
  }, [
    index,
    kick,
    match.homeMemberId,
    match.awayMemberId,
    onFinish,
    onKick,
    room.code,
    run,
    shootout.homeGoals,
    shootout.awayGoals,
    takerTeam?.name,
    winnerName,
  ]);

  // A replay must never keep narrating in a hidden tab.
  useEffect(() => {
    const hide = () => {
      if (document.hidden) onFinish();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [onFinish]);

  return (
    <div className={styles.replay} data-testid="shootout-replay" data-kick-index={index}>
      <header className={styles.replayHeader}>
        <span>
          {kick
            ? kick.round > 5
              ? 'SUDDEN DEATH'
              : `ROUND ${kick.round} / 5`
            : 'SHOOTOUT DECIDED'}
        </span>
        <button type="button" onClick={onFinish} data-testid="shootout-finish">
          Show result <span aria-hidden="true">↗</span>
        </button>
      </header>
      <div
        key={index}
        className={styles.penaltyScene}
        data-outcome={kick?.outcome ?? 'COMPLETE'}
        data-side={index % 2 ? 'right' : 'left'}
        data-landed={landed || !kick}
        style={
          { '--shootout-color': takerTeam?.color ?? winner?.color ?? '#f1bf00' } as CSSProperties
        }
        aria-hidden="true"
      >
        <div className={styles.stadiumLights} />
        <div className={styles.goal}>
          <div className={styles.net} />
        </div>
        <div className={styles.penaltyArc} />
        {kick ? (
          <>
            <div className={styles.keeper}>
              <i />
              <b />
              <span />
              <span />
            </div>
            <div className={styles.ball}>✦</div>
          </>
        ) : null}
        <strong className={styles.shotWord}>
          {kick ? outcomeLabels[kick.outcome] : 'DECIDED.'}
        </strong>
      </div>
      <div className={styles.shotCaption} role="status" aria-live="polite" aria-atomic="true">
        <span>{kick ? takerTeam?.name : 'WINNER ON PENALTIES'}</span>
        <strong>{kick ? kick.takerName : winnerName}</strong>
        <b>
          {kick
            ? landed
              ? outcomeLabels[kick.outcome]
              : 'STEPS UP…'
            : `${shootout.homeGoals} — ${shootout.awayGoals}`}
        </b>
      </div>
    </div>
  );
}

export function HeadToHeadTape({
  room,
  evaluation,
}: {
  room: RoomView;
  evaluation: EvaluationView;
}) {
  const [active, setActive] = useState<{ key: string; run: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  // Stable setters avoid restarting a shot when its tally updates.
  const finishReplay = useCallback(() => setActive(null), []);
  const showKick = useCallback((count: number) => setVisibleCount(count), []);

  return (
    <section
      className={styles.tape}
      data-testid="head-to-head-tape"
      aria-label="Head-to-head match projections"
    >
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">THE MATCHUPS</p>
          <h3>SETTLE IT ON THE PITCH.</h3>
        </div>
        <p>
          Level at full time? It goes to penalties.
          <br />
          Match simulations are separate from the 100-metric title.
        </p>
      </header>
      {evaluation.headToHead.map((match, index) => {
        const home = room.members.find((member) => member.id === match.homeMemberId);
        const away = room.members.find((member) => member.id === match.awayMemberId);
        const key = `${match.homeMemberId}-${match.awayMemberId}`;
        const shootout = match.penaltyShootout;
        const playing = active?.key === key;
        const visible = playing ? visibleCount : (shootout?.kicks.length ?? 0);
        const lastKick = shootout?.kicks[visible - 1];
        const winner = room.members.find((member) => member.id === shootout?.winnerId);
        const homePenaltyScore = playing ? (lastKick?.homeGoals ?? 0) : shootout?.homeGoals;
        const awayPenaltyScore = playing ? (lastKick?.awayGoals ?? 0) : shootout?.awayGoals;
        return (
          <article
            className={styles.match}
            key={key}
            data-testid="head-to-head-match"
            data-home-id={match.homeMemberId}
            data-away-id={match.awayMemberId}
          >
            <div className={styles.matchMeta}>
              <span>MATCH {String(index + 1).padStart(2, '0')}</span>
              <span>{shootout ? 'DECIDED ON PENALTIES' : 'FULL TIME'}</span>
            </div>
            <div className={styles.scoreboard}>
              <div
                className={styles.team}
                style={{ '--team-color': home?.color ?? '#55edc4' } as CSSProperties}
              >
                <span>{initials(home?.name ?? 'HOME')}</span>
                <h4>{home?.name ?? 'Home'}</h4>
              </div>
              <div className={styles.fullTime}>
                <b>
                  {match.homeGoals}
                  <i>:</i>
                  {match.awayGoals}
                </b>
                <small>FULL TIME</small>
              </div>
              <div
                className={`${styles.team} ${styles.away}`}
                style={{ '--team-color': away?.color ?? '#f1bf00' } as CSSProperties}
              >
                <span>{initials(away?.name ?? 'AWAY')}</span>
                <h4>{away?.name ?? 'Away'}</h4>
              </div>
            </div>
            {shootout ? (
              <>
                <div className={styles.penalties}>
                  <div>
                    <strong data-testid="home-penalty-score">{homePenaltyScore}</strong>
                    <KickTrail
                      kicks={shootout.kicks}
                      visibleCount={visible}
                      memberId={match.homeMemberId}
                      teamName={home?.name ?? 'Home'}
                    />
                  </div>
                  <span>PENALTIES</span>
                  <div>
                    <strong data-testid="away-penalty-score">{awayPenaltyScore}</strong>
                    <KickTrail
                      kicks={shootout.kicks}
                      visibleCount={visible}
                      memberId={match.awayMemberId}
                      teamName={away?.name ?? 'Away'}
                    />
                  </div>
                </div>
                <div className={styles.decision}>
                  <p
                    data-testid="shootout-winner"
                    data-winner-id={playing ? undefined : shootout.winnerId}
                  >
                    {playing ? (
                      'The shootout is live.'
                    ) : (
                      <>
                        <b>{winner?.name ?? 'Winner'}</b> win on penalties
                        {shootout.suddenDeath ? ' · sudden death' : ''}.
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    data-testid="watch-shootout"
                    data-pause-ceremony
                    aria-expanded={playing}
                    onClick={() => {
                      setVisibleCount(0);
                      setActive({ key, run: Date.now() });
                    }}
                  >
                    <span aria-hidden="true">▶</span> {playing ? 'Restart' : 'Watch shootout'}
                  </button>
                </div>
                {playing ? (
                  <ShootoutReplay
                    key={active.run}
                    room={room}
                    match={match}
                    run={active.run}
                    onFinish={finishReplay}
                    onKick={showKick}
                  />
                ) : null}
                {shootout.resolution === 'CONDITIONED_SUDDEN_DEATH' ? (
                  <p className={styles.explanation}>
                    An extended shootout was settled by a simulated decisive pair.
                  </p>
                ) : null}
              </>
            ) : match.homeGoals === match.awayGoals ? (
              <p className={styles.legacyDraw}>Draw · This saved match has no penalty shootout.</p>
            ) : null}
            <p className={styles.explanation}>{match.explanation}</p>
          </article>
        );
      })}
    </section>
  );
}
