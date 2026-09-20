'use client';

import type { EvaluationView, RoomView, TeamResultView } from '@gavel-xi/shared';
import { formatMoney, initials } from '@/lib/format';
import { useEffect } from 'react';
import { emitBroadcast, cancelBroadcastNarration } from '@/lib/broadcast-audio';
import { BroadcastAtmosphere, BroadcastStrip, CountUp, TrophySculpture } from './broadcast-kit';

function PodiumPlace({ room, team }: { room: RoomView; team: TeamResultView }) {
  const member = room.members.find((candidate) => candidate.id === team.memberId);
  return (
    <article
      className={`podium-place podium-place--${team.rank}`}
      style={{ '--member-color': member?.color ?? '#f1bf00' } as React.CSSProperties}
    >
      <span className="podium-place__rank">#{team.rank}</span>
      <div className="podium-place__avatar">{initials(member?.name ?? 'GX')}</div>
      <p>{team.rank === 1 ? 'GAVEL XI CHAMPION' : team.rank === 2 ? 'RUNNER-UP' : 'THIRD PLACE'}</p>
      <h3>{member?.name ?? 'Director'}</h3>
      <strong>
        <CountUp value={team.overallScore} />
        <small>/100</small>
      </strong>
      <div className="podium-place__base">
        <span>{team.metricWins} METRIC WINS</span>
        <span>{team.categoryWins} CATEGORY WINS</span>
      </div>
    </article>
  );
}

export function Podium({
  room,
  evaluation,
  announce = true,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  announce?: boolean;
}) {
  const rankings = [...evaluation.teams].sort((a, b) => a.rank - b.rank);
  const podiumOrder = [
    rankings.find((team) => team.rank === 2),
    rankings.find((team) => team.rank === 1),
    rankings.find((team) => team.rank === 3),
  ].filter((team): team is TeamResultView => Boolean(team));
  const champion = rankings[0];
  const championMember = room.members.find(({ id }) => id === champion?.memberId);
  useEffect(() => {
    if (!announce || !champion || !championMember) return;
    emitBroadcast({
      id: `winner-${room.code}-${evaluation.seed}`,
      cue: 'winner',
      message: `The verdict is in. ${championMember.name} wins the Gavel eleven championship! ${champion.overallScore.toFixed(1)} points. What a draft.`,
      delayMs: 800,
    });
    return cancelBroadcastNarration;
  }, [
    announce,
    champion?.memberId,
    champion?.overallScore,
    championMember?.name,
    evaluation.seed,
    room.code,
  ]);
  return (
    <section className="podium-view broadcast-finale" data-testid="results-podium">
      <div className="champion-stage broadcast-scene">
        <BroadcastAtmosphere celebration />
        <BroadcastStrip label="FULL TIME" detail="The window is closed. A champion is crowned." />
        <div className="champion-stage__content">
          <div className="champion-stage__copy">
            <p className="eyebrow">GAVEL XI / DRAFT CHAMPION</p>
            <h1>
              BUILT TO
              <br />
              <em>CONQUER.</em>
            </h1>
            <div className="champion-identity">
              <span style={{ background: championMember?.color }}>
                {initials(championMember?.name ?? 'GX')}
              </span>
              <h2>{championMember?.name ?? 'Champion'}</h2>
              <b>01</b>
            </div>
            <p className="champion-stage__verdict">
              {evaluation.analystReport?.finalWhy ?? champion?.strengths.join(' · ')}
            </p>
          </div>
          <div className="champion-stage__trophy">
            <TrophySculpture />
            <div className="champion-score">
              <CountUp value={champion?.overallScore ?? 0} />
              <span>OVERALL / 100</span>
            </div>
          </div>
        </div>
        <div className="champion-ribbon">
          <span>THE WINNING FORMULA</span>
          <b>
            {champion?.metricWins ?? 0} <small>METRIC WINS</small>
          </b>
          <b>
            {champion?.categoryWins ?? 0} <small>CATEGORIES WON</small>
          </b>
          <b>
            {room.settings.formation} <small>FORMATION</small>
          </b>
        </div>
      </div>
      <header className="broadcast-section-heading">
        <span>01 / THE FINAL TABLE</span>
        <h2>RESPECT THE RANKING.</h2>
      </header>
      <div className="podium-stage">
        {podiumOrder.map((team) => (
          <PodiumPlace room={room} team={team} key={team.memberId} />
        ))}
      </div>
      {rankings.length > 3 ? (
        <div className="rankings-rest">
          {rankings.slice(3).map((team) => {
            const member = room.members.find((candidate) => candidate.id === team.memberId);
            return (
              <article key={team.memberId}>
                <span>#{team.rank}</span>
                <b>{member?.name}</b>
                <i style={{ width: `${team.overallScore}%`, background: member?.color }} />
                <strong>{team.overallScore.toFixed(1)}</strong>
              </article>
            );
          })}
        </div>
      ) : null}
      <section className="award-grid" data-testid="results-awards">
        {evaluation.awards.map((award, index) => {
          const member = room.members.find((candidate) => candidate.id === award.memberId);
          return (
            <article key={`${award.title}-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{award.title}</p>
              <h3 style={{ color: member?.color }}>{member?.name ?? '—'}</h3>
              <small>{award.detail}</small>
            </article>
          );
        })}
      </section>
      <section className="predictions" data-testid="results-predictions">
        <header>
          <p className="eyebrow">MODEL PROJECTIONS</p>
          <h2>WHAT HAPPENS ON THE PITCH?</h2>
        </header>
        <div className="prediction-cards">
          {rankings.map((team) => {
            const member = room.members.find((candidate) => candidate.id === team.memberId);
            return (
              <article key={team.memberId}>
                <span style={{ background: member?.color }}>{initials(member?.name ?? '')}</span>
                <h3>{member?.name}</h3>
                <div>
                  <small>38-MATCH LEAGUE</small>
                  <b>{team.leaguePoints} PTS</b>
                </div>
                <div>
                  <small>KNOCKOUT</small>
                  <b>{team.knockoutRating.toFixed(1)}</b>
                </div>
                <div>
                  <small>ONE-MATCH FINAL</small>
                  <b>{team.finalRating.toFixed(1)}</b>
                </div>
                <p>
                  <strong>STRENGTH</strong> {team.strengths[0] ?? 'Balance'}
                </p>
                <p>
                  <strong>WATCH</strong> {team.weakness}
                </p>
              </article>
            );
          })}
        </div>
        <div className="head-to-head">
          <h3>HEAD-TO-HEAD TAPE</h3>
          {evaluation.headToHead.map((match, index) => {
            const home = room.members.find((member) => member.id === match.homeMemberId);
            const away = room.members.find((member) => member.id === match.awayMemberId);
            return (
              <article key={`${match.homeMemberId}-${match.awayMemberId}-${index}`}>
                <div>
                  <span>{home?.name}</span>
                  <strong>{match.homeGoals}</strong>
                  <i>—</i>
                  <strong>{match.awayGoals}</strong>
                  <span>{away?.name}</span>
                </div>
                <p>{match.explanation}</p>
              </article>
            );
          })}
        </div>
      </section>
      <section className="financial-table">
        <header>
          <span>DIRECTOR</span>
          <span>SPENT</span>
          <span>REMAINING</span>
          <span>VALUE</span>
          <span>EFFICIENCY</span>
        </header>
        {rankings.map((team) => {
          const member = room.members.find((candidate) => candidate.id === team.memberId);
          return (
            <article key={team.memberId}>
              <b>{member?.name}</b>
              <span>{formatMoney(team.spentEUR, true)}</span>
              <span>{formatMoney(team.remainingEUR, true)}</span>
              <span>{formatMoney(team.squadMarketValueEUR, true)}</span>
              <strong>{team.auctionEfficiency.toFixed(2)}×</strong>
            </article>
          );
        })}
      </section>
    </section>
  );
}
