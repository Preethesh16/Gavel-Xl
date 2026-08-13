import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import { formatMoney } from '@/lib/format';

export function StatusDock({
  room,
  me,
  maxBid,
}: {
  room: RoomView;
  me: RoomMemberView;
  maxBid: number;
}) {
  const lot = room.currentLot;
  const leader = room.members.find((member) => member.id === lot?.currentLeaderId);
  const eligible = Boolean(lot?.eligibleMemberIds.includes(me.id));
  const passed = Boolean(lot?.passedMemberIds.includes(me.id));
  return (
    <aside className="status-dock" aria-label="Auction essentials" data-testid="status-essentials">
      <div>
        <span>ROOM</span>
        <strong>{room.code}</strong>
      </div>
      <div>
        <span>DIRECTOR</span>
        <strong>{me.name}</strong>
      </div>
      <div>
        <span>MY BUDGET</span>
        <strong data-testid="my-budget">{formatMoney(me.budgetEUR, true)}</strong>
      </div>
      <div>
        <span>FORMATION</span>
        <strong data-testid="current-formation">{room.settings.formation}</strong>
      </div>
      <div>
        <span>CURRENT BID</span>
        <strong data-testid="current-bid">
          {formatMoney(lot?.currentBidEUR ?? lot?.openingBidEUR, true)}
        </strong>
      </div>
      <div>
        <span>LEADER</span>
        <strong data-testid="current-leader" style={leader ? { color: leader.color } : undefined}>
          {leader?.name ?? 'NO BIDS'}
        </strong>
      </div>
      <div>
        <span>MAX SAFE BID</span>
        <strong data-testid="max-legal-bid">{formatMoney(maxBid, true)}</strong>
      </div>
      <div>
        <span>MY STATUS</span>
        <strong className={eligible && !passed ? 'status-good' : ''} data-testid="eligibility">
          {me.isSpectator ? 'SPECTATOR' : passed ? 'PASSED' : eligible ? 'ELIGIBLE' : 'SLOT FILLED'}
        </strong>
      </div>
    </aside>
  );
}
