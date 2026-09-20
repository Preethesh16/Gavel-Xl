'use client';

import type { EvaluationView, RoomView } from '@gavel-xi/shared';
import type { CSSProperties } from 'react';
import { TeamBoard } from './team-check';

/** Presents one director's actual completed squad and authoritative team result. */
export function CeremonyLineup({
  room,
  evaluation,
  memberId,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  memberId: string;
}) {
  const member = room.members.find((candidate) => candidate.id === memberId);
  const result = evaluation.teams.find((team) => team.memberId === memberId);
  if (!member || !result) return null;

  const categories = Object.entries(result.categoryScores);
  const verdict = evaluation.analystReport?.teamVerdicts.find((team) => team.memberId === memberId);

  return (
    <section
      className="ceremony-lineup"
      data-testid="ceremony-lineup"
      data-member-id={memberId}
      aria-label={`${member.name}'s final lineup and ratings`}
      style={{ '--lineup-color': member.color } as CSSProperties}
    >
      <header className="ceremony-lineup__headline">
        <div className="ceremony-lineup__identity">
          <p>
            THE COMPLETE XI <span>FINAL EVALUATION</span>
          </p>
          <h2>{member.name}</h2>
          <span>
            {verdict?.tacticalIdentity ||
              result.strengths.join(' · ') ||
              'Every signing. Every role. The finished team.'}
          </span>
        </div>
        <div className="ceremony-lineup__score" data-testid="ceremony-lineup-score">
          <span>FINAL TEAM RATING</span>
          <strong>
            {result.overallScore.toFixed(1)}
            <small>/100</small>
          </strong>
        </div>
      </header>
      <div className="ceremony-lineup__record">
        <span>
          <b>{room.settings.formation}</b>FORMATION
        </span>
        <span>
          <b data-testid="ceremony-lineup-metric-wins">
            {result.metricWins}
            <small> / {evaluation.metrics.length}</small>
          </b>
          METRIC WINS
        </span>
        <span>
          <b>
            {result.categoryWins}
            <small> / {categories.length}</small>
          </b>
          CATEGORY WINS
        </span>
        <p>
          Player cards: current form
          <br />
          Team ratings: final evaluation
        </p>
      </div>
      <div className="ceremony-lineup__body">
        <TeamBoard key={member.id} room={room} member={member} showRatingLabels />
        <aside className="ceremony-lineup__analysis">
          <div className="ceremony-lineup__departments" data-testid="ceremony-lineup-categories">
            <header>
              <span>THE DEPARTMENT RATINGS</span>
              <b>/100</b>
            </header>
            <div>
              {categories.map(([category, score], index) => (
                <div className="ceremony-lineup__category" key={category}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{category}</h3>
                    <i aria-hidden="true">
                      <b
                        style={
                          {
                            '--department-score': `${Math.max(0, Math.min(100, score))}%`,
                            '--department-delay': `${index * 45}ms`,
                          } as CSSProperties
                        }
                      />
                    </i>
                  </div>
                  <strong>{score.toFixed(1)}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="ceremony-lineup__verdict">
            <p>THE SCOUT'S TAKE</p>
            <h3>{result.strengths[0] || 'The complete team'}</h3>
            <span>
              {verdict?.decisiveEdge ||
                result.strengths.slice(1).join(' · ') ||
                'The team rating combines every department above.'}
            </span>
            <div>
              <b>THE PRESSURE POINT</b>
              <span>{verdict?.concern || result.weakness}</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
