'use client';

import type { RoomView } from '@gavel-xi/shared';
import { useEffect, useState } from 'react';
import type { AuctionMoment } from '@/hooks/use-gavel-room';
import { formatMoney } from '@/lib/format';

export function AuctionOutcome({ moment, room }: { moment: AuctionMoment | null; room: RoomView }) {
  const [visibleId, setVisibleId] = useState<number | null>(null);

  useEffect(() => {
    if (!moment || !['sold', 'unsold', 'forced'].includes(moment.kind)) return;
    setVisibleId(moment.id);
    const duration = process.env.NEXT_PUBLIC_E2E === 'true' ? 300 : 3_200;
    const timer = window.setTimeout(
      () => setVisibleId((current) => (current === moment.id ? null : current)),
      duration,
    );
    return () => window.clearTimeout(timer);
  }, [moment]);

  if (!moment || visibleId !== moment.id || !['sold', 'unsold', 'forced'].includes(moment.kind))
    return null;
  const lot = moment.lot ?? room.currentLot;
  const member =
    room.members.find((candidate) => candidate.id === moment.memberId) ??
    room.members.find((candidate) => candidate.id === lot?.currentLeaderId);
  const name = lot?.candidate.commonName ?? lot?.candidate.fullName ?? '';
  return (
    <div
      className={`auction-outcome auction-outcome--${moment.kind}`}
      role="status"
      aria-live="assertive"
      data-testid={`${moment.kind}-animation`}
    >
      <div className="outcome-rays" />
      <span className="outcome-kicker">
        {moment.kind === 'forced'
          ? 'ONLY ONE DIRECTOR LEFT'
          : moment.kind === 'unsold'
            ? 'NO TAKERS'
            : 'GAVEL DOWN'}
      </span>
      <h2>{moment.kind === 'forced' ? 'FORCED DEAL' : moment.title}</h2>
      <strong>{name}</strong>
      {member ? (
        <p>
          {moment.kind === 'forced' ? 'ALLOCATED TO' : 'TO'}{' '}
          <b style={{ color: member.color }}>{member.name}</b>
        </p>
      ) : null}
      {moment.amountEUR !== undefined ? <em>{formatMoney(moment.amountEUR, true)}</em> : null}
      <small>
        {moment.kind === 'forced'
          ? 'NO MORE RUNNING. THIS ONE’S YOURS.'
          : moment.kind === 'unsold'
            ? 'MOVED TO THE UNSOLD VAULT'
            : 'DEAL COMPLETE'}
      </small>
    </div>
  );
}
