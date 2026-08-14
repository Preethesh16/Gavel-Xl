'use client';

import type { EvaluationView, RoomView } from '@gavel-xi/shared';
import { useState } from 'react';
import { formatMoney, initials } from '@/lib/format';
import { CheckIcon, ShareIcon } from './icons';

export function ShareResults({ room, evaluation }: { room: RoomView; evaluation: EvaluationView }) {
  const [copied, setCopied] = useState(false);
  const rankings = [...evaluation.teams].sort((a, b) => a.rank - b.rank);
  const championResult = rankings[0];
  const champion = room.members.find((member) => member.id === championResult?.memberId);
  const bestBargain = evaluation.awards.find((award) =>
    award.title.toLowerCase().includes('bargain'),
  );
  const overpay = evaluation.awards.find((award) => award.title.toLowerCase().includes('overpay'));
  const shareText = `${champion?.name ?? 'A director'} won ${room.title} on GAVEL XI with ${championResult?.overallScore.toFixed(1) ?? '—'}/100. Room ${room.code}.`;
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/results/${room.code}` : '';

  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({
          title: `${room.title} — Gavel XI`,
          text: shareText,
          url: shareUrl,
        });
      else await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      setCopied(true);
      window.setTimeout(
        () => setCopied(false),
        process.env.NEXT_PUBLIC_E2E === 'true' ? 150 : 2_000,
      );
    } catch {
      // Cancelling the operating-system share sheet is not an error state.
    }
  };

  return (
    <section className="share-results" data-testid="share-screen">
      <header className="results-section-heading">
        <div>
          <p className="eyebrow">SCREENSHOT READY</p>
          <h2>SHARE THE VERDICT</h2>
        </div>
        <button
          className="share-action"
          data-testid="share-results"
          type="button"
          onClick={() => void share()}
        >
          {copied ? <CheckIcon /> : <ShareIcon />}
          {copied ? 'COPIED' : 'SHARE RESULT'}
        </button>
      </header>
      <article className="share-card" data-testid="share-card">
        <div className="share-card__grain" />
        <header>
          <span className="share-card__brand">
            GAVEL <i>XI</i>
          </span>
          <span>FINAL VERDICT · {room.code}</span>
        </header>
        <div className="share-card__champion">
          <p>GAVEL XI CHAMPION</p>
          <span style={{ background: champion?.color }}>{initials(champion?.name ?? 'GX')}</span>
          <h3>{champion?.name ?? 'Awaiting verdict'}</h3>
          <strong>
            {championResult?.overallScore.toFixed(1) ?? '—'}
            <small>/100</small>
          </strong>
          <em>
            {room.settings.formation} · {formatMoney(championResult?.spentEUR, true)} SPENT
          </em>
        </div>
        <ol>
          {rankings.map((team) => {
            const member = room.members.find((candidate) => candidate.id === team.memberId);
            return (
              <li key={team.memberId}>
                <span>#{team.rank}</span>
                <b>{member?.name}</b>
                <i style={{ width: `${team.overallScore}%`, background: member?.color }} />
                <strong>{team.overallScore.toFixed(1)}</strong>
              </li>
            );
          })}
        </ol>
        <div className="share-card__awards">
          <div>
            <span>BEST BARGAIN</span>
            <b>{room.members.find((member) => member.id === bestBargain?.memberId)?.name ?? '—'}</b>
            <small>{bestBargain?.detail ?? 'Calculated from form and price'}</small>
          </div>
          <div>
            <span>BIGGEST GAMBLE</span>
            <b>{room.members.find((member) => member.id === overpay?.memberId)?.name ?? '—'}</b>
            <small>{overpay?.detail ?? 'Calculated from market premium'}</small>
          </div>
        </div>
        <footer>
          <span>BUILD THE XI. BREAK THE BANK.</span>
          <span>100 METRICS · LOCKED MODEL</span>
        </footer>
      </article>
      <p className="share-results__hint">
        The card is designed to fit a phone screenshot cleanly. Player imagery is intentionally
        excluded from the share artifact.
      </p>
    </section>
  );
}
