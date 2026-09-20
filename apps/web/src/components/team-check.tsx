'use client';

import type { RoomMemberView, RoomView, SquadEntryView } from '@gavel-xi/shared';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { buildLineup } from '@/lib/formations';
import { formatMoney, initials } from '@/lib/format';
import { ArrowIcon, CloseIcon, CrownIcon } from './icons';

function SquadPortrait({ entry, className = '' }: { entry: SquadEntryView; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { candidate } = entry;
  const name = candidate.commonName || candidate.fullName;
  return (
    <span className={`tactical-portrait ${className}`}>
      {candidate.imageUrl && failedUrl !== candidate.imageUrl ? (
        // Provider portraits are frozen external URLs, so no image proxy is required.
        <img
          src={candidate.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(candidate.imageUrl)}
        />
      ) : (
        <span className="tactical-portrait__fallback" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

function PitchPlayer({
  entry,
  slotId,
  label,
  x,
  y,
  order,
  selected,
  showRatingLabel,
  onSelect,
}: {
  entry: SquadEntryView | null;
  slotId: string;
  label: string;
  x: number;
  y: number;
  order: number;
  selected: boolean;
  showRatingLabel: boolean;
  onSelect: () => void;
}) {
  const name = entry ? entry.candidate.commonName || entry.candidate.fullName : 'SIGNING NEEDED';
  return (
    <button
      className={`tactical-player ${entry ? 'tactical-player--signed' : 'tactical-player--vacant'} ${selected ? 'is-selected' : ''}`}
      style={{ left: `${x}%`, top: `${y}%`, '--arrival': `${order * 55}ms` } as CSSProperties}
      type="button"
      data-testid={`pitch-player-${slotId}`}
      data-occupied={Boolean(entry)}
      aria-label={`${label}: ${name}. View details`}
      aria-pressed={selected}
      onClick={onSelect}
      title={`${label} · ${name}`}
    >
      <span className="tactical-player__card">
        {entry ? (
          <SquadPortrait entry={entry} />
        ) : (
          <span className="tactical-player__cross" aria-hidden="true">
            +
          </span>
        )}
        <span className="tactical-player__position">{label}</span>
        {entry ? (
          <span
            className="tactical-player__rating"
            title={`Current form: ${Math.round(entry.candidate.currentFormRating)} out of 100`}
          >
            {showRatingLabel ? <small>FORM</small> : null}
            {Math.round(entry.candidate.currentFormRating)}
          </span>
        ) : null}
      </span>
      <span className="tactical-player__name">{entry ? name : label}</span>
    </button>
  );
}

function TeamBoard({
  room,
  member,
  compact = false,
  showRatingLabels = false,
}: {
  room: RoomView;
  member: RoomMemberView;
  compact?: boolean;
  showRatingLabels?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = room.squads.filter((entry) => entry.memberId === member.id);
  const manager = entries.find((entry) => entry.candidate.kind === 'MANAGER');
  const lineup = buildLineup(room.settings.formation, member, entries);
  const selectedSlot =
    lineup.find(({ slot }) => slot.id === selectedId) ??
    lineup.find(({ entry }) => entry) ??
    lineup.find(({ slot }) => slot.position === 'ST') ??
    lineup[0];
  const selectedEntry = selectedId === 'manager' ? manager : selectedSlot?.entry;
  const selectedLabel = selectedId === 'manager' ? 'MANAGER' : selectedSlot?.slot.label;
  const value = entries.reduce((total, entry) => total + (entry.marketValueEUR ?? 0), 0);
  const spent = entries.reduce((total, entry) => total + entry.purchasePriceEUR, 0);
  const completion = member.totalSlots
    ? Math.min(100, (member.filledSlots / member.totalSlots) * 100)
    : 0;
  const name = selectedEntry
    ? selectedEntry.candidate.commonName || selectedEntry.candidate.fullName
    : '';
  const candidate = selectedEntry?.candidate;
  const metrics =
    candidate?.kind === 'MANAGER'
      ? ([
          ['POSSESSION', candidate.tactics?.possession ?? 0],
          ['PRESSING', candidate.tactics?.pressing ?? 0],
          ['FLEXIBILITY', candidate.tactics?.tacticalFlexibility ?? 0],
        ] as const)
      : candidate?.preferredPosition === 'GK'
        ? ([
            ['DEFENDING', candidate.role.defending],
            ['AERIAL', candidate.role.aerial],
            ['COMPOSURE', candidate.role.composure],
          ] as const)
        : candidate
          ? ([
              ['TECHNIQUE', candidate.role.technique],
              ['PASSING', candidate.role.passing],
              ['PHYSICAL', candidate.role.physical],
            ] as const)
          : [];

  return (
    <article
      className={`team-board tactical-board ${compact ? 'tactical-board--compact' : ''}`}
      data-testid={`team-board-${member.id}`}
      style={{ '--director-color': member.color } as CSSProperties}
    >
      <header className="tactical-board__header">
        <span className="tactical-board__crest">{initials(member.name)}</span>
        <div>
          <p>{member.isHost ? 'HOST · ' : ''}SPORTING DIRECTOR</p>
          <h3>{member.name}</h3>
        </div>
        <span
          className="tactical-board__completion"
          aria-label={`${member.filledSlots} of ${member.totalSlots} signings complete`}
        >
          <strong>
            {member.filledSlots}
            <small> / {member.totalSlots}</small>
          </strong>
          <span>SQUAD BUILT</span>
        </span>
      </header>
      <div className="tactical-board__progress" aria-hidden="true">
        <span style={{ width: `${completion}%` }} />
      </div>
      <div className="tactical-board__stage">
        <div className="tactical-board__stadium">
          <div className="tactical-board__matchline">
            <span>
              <i /> TACTICAL FEED
            </span>
            <strong>{room.settings.formation}</strong>
            <span>XI / ON THE PITCH</span>
          </div>
          <div
            className="tactical-pitch"
            aria-label={`${member.name}'s ${room.settings.formation} formation`}
          >
            <div className="tactical-pitch__scan" aria-hidden="true" />
            <svg
              className="tactical-pitch__markings"
              viewBox="0 0 100 120"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect x="5" y="5" width="90" height="110" rx="1" />
              <path d="M5 60H95 M29 5V22H71V5 M29 115V98H71V115 M39 5V12H61V5 M39 115V108H61V115" />
              <circle cx="50" cy="60" r="12" />
              <circle cx="50" cy="60" r="0.6" className="tactical-pitch__spot" />
              <path d="M40 22Q50 33 60 22 M40 98Q50 87 60 98" />
            </svg>
            <span className="tactical-pitch__watermark" aria-hidden="true">
              GAVEL
              <br />
              XI
            </span>
            {lineup.map(({ slot, entry }, index) => (
              <PitchPlayer
                key={`${slot.id}:${entry?.id ?? 'empty'}`}
                entry={entry}
                slotId={slot.id}
                label={slot.label}
                x={slot.x}
                y={slot.y}
                order={index}
                selected={selectedId !== 'manager' && selectedSlot?.slot.id === slot.id}
                showRatingLabel={showRatingLabels}
                onSelect={() => setSelectedId(slot.id)}
              />
            ))}
          </div>
          <div className="tactical-board__pitch-caption">
            <span>↑ ATTACKING DIRECTION</span>
            <span>TAP A PLAYER TO INSPECT</span>
          </div>
        </div>
        <aside className="tactical-board__intel">
          <button
            className={`tactical-manager ${selectedId === 'manager' ? 'is-selected' : ''}`}
            type="button"
            onClick={() => setSelectedId('manager')}
            aria-pressed={selectedId === 'manager'}
            data-testid="pitch-manager"
          >
            {manager ? (
              <SquadPortrait entry={manager} />
            ) : (
              <span className="tactical-manager__vacant">
                <CrownIcon />
              </span>
            )}
            <span className="tactical-manager__copy">
              <small>THE TOUCHLINE · MANAGER</small>
              <b>
                {manager
                  ? manager.candidate.commonName || manager.candidate.fullName
                  : 'Your mastermind awaits'}
              </b>
              <span>
                {manager ? manager.candidate.club : 'Complete the final piece of your XI'}
              </span>
            </span>
            <ArrowIcon />
          </button>
          <div
            className="tactical-dossier"
            key={selectedEntry?.id ?? selectedLabel}
            data-testid="pitch-player-detail"
            aria-live="polite"
          >
            <div className="tactical-dossier__eyebrow">
              <span>PLAYER INTELLIGENCE</span>
              <b>{selectedLabel}</b>
            </div>
            {selectedEntry ? (
              <>
                <div className="tactical-dossier__identity">
                  <SquadPortrait entry={selectedEntry} />
                  <div>
                    <span>{candidate?.club}</span>
                    <h4>{name}</h4>
                    <p>
                      {candidate?.nationality} · {candidate?.age} years
                    </p>
                  </div>
                  <b className="tactical-dossier__form">
                    {Math.round(candidate?.currentFormRating ?? 0)}
                    <small>FORM</small>
                  </b>
                </div>
                <div className="tactical-dossier__metrics">
                  {metrics.map(([label, score]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <i>
                        <b
                          style={
                            { '--score': `${Math.max(0, Math.min(100, score))}%` } as CSSProperties
                          }
                        />
                      </i>
                      <strong>{Math.round(score)}</strong>
                    </div>
                  ))}
                </div>
                <div className="tactical-dossier__deal">
                  <span>
                    SIGNED FOR <b>{formatMoney(selectedEntry.purchasePriceEUR, true)}</b>
                  </span>
                  <span>
                    MARKET VALUE{' '}
                    <b>
                      {selectedEntry.marketValueEUR === null
                        ? '—'
                        : formatMoney(selectedEntry.marketValueEUR, true)}
                    </b>
                  </span>
                </div>
              </>
            ) : (
              <div className="tactical-dossier__empty">
                <span aria-hidden="true">+</span>
                <div>
                  <h4>{selectedLabel} signing needed</h4>
                  <p>A new arrival will light up this position. Keep your next move ready.</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
      <footer className="tactical-board__finances">
        <div>
          <span>REMAINING</span>
          <b>{formatMoney(member.budgetEUR, true)}</b>
        </div>
        <div>
          <span>SPENT</span>
          <b>{formatMoney(spent, true)}</b>
        </div>
        <div>
          <span>SQUAD VALUE</span>
          <b>{formatMoney(value, true)}</b>
        </div>
        <div>
          <span>AVG. DEAL</span>
          <b>{formatMoney(entries.length ? spent / entries.length : 0, true)}</b>
        </div>
      </footer>
    </article>
  );
}

interface TeamCheckProps {
  room: RoomView;
  me: RoomMemberView;
  onClose: () => void;
  onBroadcast: () => Promise<{ ok: boolean }>;
}

export function TeamCheck({ room, me, onClose, onBroadcast }: TeamCheckProps) {
  const [scope, setScope] = useState<'MY' | 'ALL'>('MY');
  const [activeDirector, setActiveDirector] = useState(0);
  const directors = useMemo(
    () => room.members.filter((member) => !member.isSpectator),
    [room.members],
  );
  const shown = scope === 'MY' ? [me] : directors;
  const activeMember = shown[Math.min(activeDirector, Math.max(0, shown.length - 1))] ?? me;

  useEffect(() => {
    setActiveDirector(0);
  }, [scope]);

  const selectDirector = (index: number) => {
    if (shown.length === 0) return;
    setActiveDirector((index + shown.length) % shown.length);
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="team-check"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-check-title"
        data-testid="team-check-modal"
      >
        <header className="team-check__header">
          <div>
            <p className="eyebrow">LIVE TACTICAL VIEW</p>
            <h2 id="team-check-title">PREVIEW TEAM</h2>
          </div>
          <button
            className="icon-button"
            data-testid="team-check-close"
            type="button"
            onClick={onClose}
            aria-label="Close team preview"
          >
            <CloseIcon />
          </button>
        </header>
        <nav className="segmented-tabs" aria-label="Team scope">
          <button
            className={scope === 'MY' ? 'is-active' : ''}
            data-testid="team-check-mine"
            type="button"
            onClick={() => setScope('MY')}
          >
            MY TEAM
          </button>
          <button
            className={scope === 'ALL' ? 'is-active' : ''}
            data-testid="team-check-all"
            type="button"
            onClick={() => setScope('ALL')}
          >
            ALL TEAMS
          </button>
        </nav>
        {scope === 'ALL' && shown.length > 1 ? (
          <div className="team-director-switcher" data-testid="team-director-switcher">
            <button
              aria-label="Previous director"
              data-testid="team-director-previous"
              type="button"
              onClick={() => selectDirector(activeDirector - 1)}
            >
              <ArrowIcon />
            </button>
            <div>
              <span>
                DIRECTOR {activeDirector + 1} / {shown.length}
              </span>
              <strong data-testid="team-director-current">{activeMember.name}</strong>
            </div>
            <button
              aria-label="Next director"
              data-testid="team-director-next"
              type="button"
              onClick={() => selectDirector(activeDirector + 1)}
            >
              <ArrowIcon />
            </button>
          </div>
        ) : null}
        <div className="team-check__boards">
          <TeamBoard key={activeMember.id} room={room} member={activeMember} />
        </div>
        {me.isHost && room.phase === 'CHECKPOINT' ? (
          <button
            className="broadcast-button"
            data-testid="checkpoint-broadcast-team-check"
            type="button"
            onClick={() => void onBroadcast()}
          >
            <CrownIcon /> CONTINUE AUCTION
          </button>
        ) : null}
      </section>
    </div>
  );
}

export { TeamBoard };
