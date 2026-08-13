import type { EvaluationView, RoomView, TeamResultView } from '@gavel-xi/shared';
import { formatMoney, initials } from '@/lib/format';

function PodiumPlace({ room, team }: { room: RoomView; team: TeamResultView }) {
  const member = room.members.find((candidate) => candidate.id === team.memberId);
  return (
    <article
      className={`podium-place podium-place--${team.rank}`}
      style={{ '--member-color': member?.color ?? '#d6ff3f' } as React.CSSProperties}
    >
      <span className="podium-place__rank">#{team.rank}</span>
      <div className="podium-place__avatar">{initials(member?.name ?? 'GX')}</div>
      <p>{team.rank === 1 ? 'GAVEL XI CHAMPION' : team.rank === 2 ? 'RUNNER-UP' : 'THIRD PLACE'}</p>
      <h3>{member?.name ?? 'Director'}</h3>
      <strong>
        {team.overallScore.toFixed(1)}
        <small>/100</small>
      </strong>
      <div className="podium-place__base">
        <span>{team.metricWins} METRIC WINS</span>
        <span>{team.categoryWins} CATEGORY WINS</span>
      </div>
    </article>
  );
}

export function Podium({ room, evaluation }: { room: RoomView; evaluation: EvaluationView }) {
  const rankings = [...evaluation.teams].sort((a, b) => a.rank - b.rank);
  const podiumOrder = [
    rankings.find((team) => team.rank === 2),
    rankings.find((team) => team.rank === 1),
    rankings.find((team) => team.rank === 3),
  ].filter((team): team is TeamResultView => Boolean(team));
  return (
    <section className="podium-view" data-testid="results-podium">
      <header className="podium-heading">
        <p className="eyebrow">THE FINAL VERDICT</p>
        <h1>
          WINDOW <em>CLOSED</em>
        </h1>
        <p>One hundred metrics. Every current-form signal. No hard-coded winner.</p>
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
