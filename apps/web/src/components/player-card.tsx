'use client';

import type { PublicLot } from '@gavel-xi/shared';
import { useState } from 'react';
import { formatMoney, initials } from '@/lib/format';

function ImageFallback({ name }: { name: string }) {
  return (
    <div className="card-silhouette" aria-hidden="true">
      <span className="card-silhouette__head" />
      <span className="card-silhouette__body" />
      <b>{initials(name)}</b>
    </div>
  );
}

export function PlayerCard({ lot, phase }: { lot: PublicLot; phase: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const player = lot.candidate;
  const isManager = player.kind === 'MANAGER';
  const marketLabel = isManager
    ? 'MANAGER RESERVE'
    : player.valuation.type === 'market_value'
      ? 'CURRENT MARKET VALUE'
      : player.valuation.type === 'estimated_transfer_value'
        ? 'ESTIMATED TRANSFER VALUE'
        : 'GAVEL XI ESTIMATE';

  return (
    <article
      className={`player-card player-card--${phase.toLowerCase()} ${lot.isReturning ? 'player-card--returning' : ''}`}
      data-testid="player-card"
    >
      <span className="player-card__cut player-card__cut--one" />
      <span className="player-card__cut player-card__cut--two" />
      <div className="player-card__rail">
        <span>LOT {String(lot.sequence).padStart(2, '0')}</span>
        <span>{player.season}</span>
      </div>
      <div className="player-card__meta">
        <div className="position-stamp" data-testid="current-position">
          <strong>{lot.position}</strong>
          <span>POSITION</span>
        </div>
        <div className="identity-stamp">
          <span title={player.nationality}>{player.nationality.slice(0, 2).toUpperCase()}</span>
          <span title={player.club}>{initials(player.club)}</span>
        </div>
      </div>
      <div className="player-card__portrait">
        <div className="portrait-halo" />
        {!imageFailed && player.imageUrl ? (
          // Provider URLs are frozen into the room snapshot; layout has a complete fallback if one expires.
          <img src={player.imageUrl} alt="" onError={() => setImageFailed(true)} />
        ) : (
          <ImageFallback name={player.commonName || player.fullName} />
        )}
        <div className="portrait-fade" />
      </div>
      <div className="player-card__copy">
        <p>
          {player.club} · {player.nationality}
        </p>
        <h2 data-testid="revealed-player-name" title={player.commonName || player.fullName}>
          {player.commonName || player.fullName}
        </h2>
        <div className="player-card__bio" data-testid="player-details">
          <span>{player.age} years</span>
          <span>{player.nationality}</span>
          <span>{player.club}</span>
        </div>
        <div className="player-card__numbers">
          <div>
            <span>{marketLabel}</span>
            <strong>{formatMoney(player.valuation.valueEUR, true)}</strong>
          </div>
          <i />
          <div>
            <span>OPENING BID</span>
            <strong>{formatMoney(lot.openingBidEUR, true)}</strong>
          </div>
        </div>
      </div>
      <div className="player-card__form">
        <span>
          FORM <b>{Math.round(player.currentFormRating)}</b>
        </span>
        <div>
          <i style={{ width: `${Math.max(0, Math.min(100, player.currentFormRating))}%` }} />
        </div>
        <span className="last-five">
          {player.lastFive.slice(0, 5).map((value, index) => (
            <i
              className={value >= 70 ? 'is-win' : value >= 50 ? 'is-draw' : ''}
              key={`${value}-${index}`}
            />
          ))}
        </span>
      </div>
      <details className="player-card__source">
        <summary>DATA PROVENANCE</summary>
        <p>
          {player.dataSource} · Updated {new Date(player.dataUpdatedAt).toLocaleDateString('en-GB')}
        </p>
        <p>
          {player.valuation.source} · Confidence{' '}
          {Math.round(player.valuation.confidence * (player.valuation.confidence <= 1 ? 100 : 1))}%
        </p>
      </details>
    </article>
  );
}
