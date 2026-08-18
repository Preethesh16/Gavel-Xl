'use client';

import type { PublicLot } from '@gavel-xi/shared';
import { memo, useEffect, useState } from 'react';
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

const COUNTRY_CODES: Record<string, string> = {
  Argentina: 'AR',
  Belgium: 'BE',
  Brazil: 'BR',
  Croatia: 'HR',
  Denmark: 'DK',
  England: 'GB',
  France: 'FR',
  Germany: 'DE',
  Italy: 'IT',
  Netherlands: 'NL',
  Nigeria: 'NG',
  Norway: 'NO',
  Poland: 'PL',
  Portugal: 'PT',
  Scotland: 'GB',
  Senegal: 'SN',
  Serbia: 'RS',
  Spain: 'ES',
  Sweden: 'SE',
  Switzerland: 'CH',
  Turkey: 'TR',
  Ukraine: 'UA',
  Uruguay: 'UY',
  Wales: 'GB',
};

function countryFlag(country: string, providedCode?: string | null): string {
  const code = (providedCode || COUNTRY_CODES[country] || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}

export const PlayerCard = memo(function PlayerCard({
  lot,
  phase,
}: {
  lot: PublicLot;
  phase: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [crestFailed, setCrestFailed] = useState(false);
  const player = lot.candidate;
  const isManager = player.kind === 'MANAGER';
  useEffect(() => setImageFailed(false), [player.imageUrl]);
  useEffect(() => setCrestFailed(false), [player.clubImageUrl]);
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
          <span aria-label={`Nationality: ${player.nationality}`} title={player.nationality}>
            {countryFlag(player.nationality, player.nationalityCode)}
          </span>
          <span aria-label={`Club: ${player.club}`} title={player.club}>
            {!crestFailed && player.clubImageUrl ? (
              <img src={player.clubImageUrl} alt="" onError={() => setCrestFailed(true)} />
            ) : (
              initials(player.club)
            )}
          </span>
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
        <p>{isManager ? 'HEAD COACH' : `${lot.position} · LIVE AUCTION CARD`}</p>
        <h2 data-testid="revealed-player-name" title={player.commonName || player.fullName}>
          {player.commonName || player.fullName}
        </h2>
        <div className="player-card__bio" data-testid="player-details">
          <span>{isManager ? 'TACTICAL LEAD' : `${player.age} YEARS`}</span>
          <span>{player.season}</span>
          <span>{player.league}</span>
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
});
