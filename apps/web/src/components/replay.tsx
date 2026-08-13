import type { RoomView } from '@gavel-xi/shared';
import { formatMoney } from '@/lib/format';
import { ReplayIcon } from './icons';

export function Replay({ room }: { room: RoomView }) {
  const events = [...room.replay].sort((a, b) => a.sequence - b.sequence || a.at - b.at);
  return (
    <section className="replay" data-testid="replay-screen">
      <header className="results-section-heading">
        <div>
          <p className="eyebrow">EVERY RAISED PADDLE</p>
          <h2>AUCTION RECAP</h2>
        </div>
        <div className="metric-count">
          <strong>{events.length}</strong>
          <span>
            MARKET
            <br />
            EVENTS
          </span>
        </div>
      </header>
      <div className="replay-seed">
        <span>FAIRNESS PROOF</span>
        <p>
          Seed commitment <code>{room.seedCommitment ?? 'Pending reveal'}</code>
        </p>
        <p>
          Revealed seed <code>{room.seed ?? 'Revealed after completion'}</code>
        </p>
      </div>
      <ol className="replay-timeline" data-testid="replay-timeline">
        {events.map((event, index) => {
          const member = room.members.find((candidate) => candidate.id === event.memberId);
          return (
            <li
              className={`replay-event replay-event--${event.type.toLowerCase().replaceAll('_', '-')}`}
              data-testid={`replay-event-${index + 1}`}
              key={event.id}
            >
              <span className="replay-event__line">
                <i />
              </span>
              <span className="replay-event__sequence">
                {String(event.sequence).padStart(3, '0')}
              </span>
              <div>
                <small>
                  {new Date(event.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}{' '}
                  · {event.type.replaceAll('_', ' ')}
                </small>
                <h3>{event.title}</h3>
                <p>{event.detail}</p>
              </div>
              {member ? <strong style={{ color: member.color }}>{member.name}</strong> : null}
              {event.amountEUR !== undefined ? <em>{formatMoney(event.amountEUR, true)}</em> : null}
            </li>
          );
        })}
      </ol>
      {!events.length ? (
        <div className="empty-results">
          <ReplayIcon />
          <h3>THE TAPE IS PROCESSING</h3>
          <p>Completed lots will appear here in sequence.</p>
        </div>
      ) : null}
    </section>
  );
}
