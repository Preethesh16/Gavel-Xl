'use client';

import type { RoomMemberView, RoomSettingsInput, RoomView } from '@gavel-xi/shared';
import { useMemo, useState } from 'react';
import { MILLION, formatMoney } from '@/lib/format';
import { ArrowIcon, CrownIcon, EyeIcon } from './icons';

const FORMATIONS: RoomSettingsInput['formation'][] = [
  '4-2-1-3',
  '4-3-3',
  '4-2-3-1',
  '4-4-2',
  '3-4-2-1',
  '3-5-2',
  '5-2-1-2',
];
const BUDGETS = [500, 600, 750, 1_000] as const;
const AVATAR_SYMBOLS: Record<string, string> = {
  shield: '◇',
  bolt: 'ϟ',
  crown: '♜',
  star: '✦',
  target: '⊙',
  wave: '≋',
};

interface LobbyProps {
  room: RoomView;
  me: RoomMemberView;
  busyAction: string | null;
  onReady: (ready: boolean) => Promise<{ ok: boolean }>;
  onSettings: (settings: Partial<RoomSettingsInput>) => Promise<{ ok: boolean }>;
  onStart: () => Promise<{ ok: boolean }>;
  onLeave: () => Promise<void>;
  onCopyInvite: () => void;
}

function Participant({ member, index }: { member: RoomMemberView; index: number }) {
  return (
    <li
      className={`participant ${member.isReady ? 'participant--ready' : ''} ${!member.isConnected ? 'participant--offline' : ''}`}
      data-testid={`participant-${index + 1}`}
    >
      <span className="participant__number">{String(index + 1).padStart(2, '0')}</span>
      <span
        className="participant__avatar"
        style={{ '--member-color': member.color } as React.CSSProperties}
      >
        {AVATAR_SYMBOLS[member.avatar] ?? '◇'}
      </span>
      <span className="participant__name">
        <b>{member.name}</b>
        <small>
          {member.isSpectator ? 'SPECTATOR' : member.isHost ? 'ROOM HOST' : 'SPORTING DIRECTOR'}
        </small>
      </span>
      {member.isHost ? <CrownIcon className="participant__crown" /> : null}
      {member.isSpectator ? (
        <span className="participant__state">
          <EyeIcon /> WATCHING
        </span>
      ) : (
        <span
          className={`participant__state ${member.isReady ? 'is-ready' : ''}`}
          data-testid={`participant-ready-${index + 1}`}
        >
          <i /> {member.isReady ? 'READY' : member.isConnected ? 'NOT READY' : 'RECONNECTING'}
        </span>
      )}
    </li>
  );
}

export function Lobby({
  room,
  me,
  busyAction,
  onReady,
  onSettings,
  onStart,
  onLeave,
  onCopyInvite,
}: LobbyProps) {
  const [customBudget, setCustomBudget] = useState(Math.round(room.settings.budgetEUR / MILLION));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activeMembers = useMemo(
    () => room.members.filter((member) => !member.isSpectator),
    [room.members],
  );
  const connected = activeMembers.filter((member) => member.isConnected).length;
  const ready = activeMembers.filter((member) => member.isReady).length;
  const everyoneReady =
    activeMembers.length >= 2 &&
    activeMembers.every((member) => member.isReady || (member.id === me.id && member.isHost));
  const preparing = room.phase !== 'LOBBY' && room.phase !== 'READY';

  const commitCustomBudget = () => {
    const safe = Math.max(100, Math.min(5_000, Math.round(customBudget)));
    setCustomBudget(safe);
    void onSettings({ budgetEUR: safe * MILLION });
  };

  return (
    <main className="lobby" data-testid="lobby-screen">
      <div className="stadium-lines" />
      <div className="lobby__flare" />
      <section className="lobby__heading">
        <div>
          <p className="eyebrow">
            <span>LOBBY</span> TRANSFER CONTROL
          </p>
          <h1>THE WAR ROOM</h1>
          <p>
            {preparing
              ? 'Scouts are locking the live data snapshot.'
              : 'Directors are taking their seats. Set the rules, then open the market.'}
          </p>
        </div>
        <div className="room-ticket">
          <span>ROOM CODE</span>
          <strong data-testid="lobby-room-code">{room.code}</strong>
          <button data-testid="copy-invite" type="button" onClick={onCopyInvite}>
            COPY INVITE
          </button>
        </div>
      </section>

      <div className="lobby__grid">
        <section className="lobby-panel directors-panel">
          <header className="panel-heading">
            <div>
              <span className="panel-heading__index">01</span>
              <div>
                <p>CONNECTED</p>
                <h2>SPORTING DIRECTORS</h2>
              </div>
            </div>
            <strong data-testid="participant-count">
              {connected}
              <small> / {activeMembers.length || 8}</small>
            </strong>
          </header>
          <ol className="participant-list" data-testid="participant-list">
            {room.members.map((member, index) => (
              <Participant key={member.id} member={member} index={index} />
            ))}
            {room.members.length < 2 ? (
              <li className="participant participant--waiting" data-testid="waiting-for-player">
                <span className="participant__number">02</span>
                <span className="waiting-pulse">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <b>WAITING FOR A RIVAL</b>
                  <small>SHARE THE SIX-CHARACTER CODE</small>
                </span>
              </li>
            ) : null}
          </ol>
          <div className="directors-panel__footer">
            <span>
              <i className="status-dot" /> {connected} CONNECTED
            </span>
            <span>{ready} READY</span>
            <span>{room.members.filter((member) => member.isSpectator).length} WATCHING</span>
          </div>
        </section>

        <section
          className={`lobby-panel settings-panel ${settingsOpen ? 'settings-panel--open' : ''}`}
        >
          <button
            className="settings-mobile-toggle"
            type="button"
            data-testid="settings-toggle"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <span>
              <small>02</small> MATCH SETTINGS
            </span>
            <b>
              {room.settings.formation} · {formatMoney(room.settings.budgetEUR, true)}
            </b>
          </button>
          <header className="panel-heading settings-panel__heading">
            <div>
              <span className="panel-heading__index">02</span>
              <div>
                <p>{me.isHost ? 'HOST CONTROL' : 'LOCKED BY HOST'}</p>
                <h2>MATCH SETTINGS</h2>
              </div>
            </div>
            <span className="settings-lock">{me.isHost ? 'EDITABLE' : 'VIEW ONLY'}</span>
          </header>
          <div className="settings-panel__body" aria-disabled={!me.isHost}>
            <label className="setting-block">
              <span>FORMATION</span>
              <select
                data-testid="settings-formation"
                disabled={!me.isHost || Boolean(busyAction)}
                value={room.settings.formation}
                onChange={(event) =>
                  void onSettings({
                    formation: event.target.value as RoomSettingsInput['formation'],
                  })
                }
              >
                {FORMATIONS.map((formation) => (
                  <option value={formation} key={formation}>
                    {formation}
                  </option>
                ))}
              </select>
            </label>
            <div className="setting-block">
              <span>TRANSFER BUDGET</span>
              <div className="budget-options" data-testid="settings-budget">
                {BUDGETS.map((budget) => (
                  <button
                    className={room.settings.budgetEUR === budget * MILLION ? 'is-active' : ''}
                    disabled={!me.isHost || Boolean(busyAction)}
                    key={budget}
                    onClick={() => void onSettings({ budgetEUR: budget * MILLION })}
                    type="button"
                    data-testid={`settings-budget-${budget}`}
                  >
                    €{budget === 1_000 ? '1B' : `${budget}M`}
                  </button>
                ))}
              </div>
              <div className="custom-budget">
                <label>
                  <span>€</span>
                  <input
                    data-testid="settings-custom-budget"
                    disabled={!me.isHost}
                    inputMode="numeric"
                    min={100}
                    max={5000}
                    onChange={(event) => setCustomBudget(Number(event.target.value))}
                    onBlur={commitCustomBudget}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitCustomBudget();
                    }}
                    value={customBudget}
                  />
                  <b>M</b>
                </label>
                <small>CUSTOM</small>
              </div>
            </div>
            <div className="setting-row">
              <label className="setting-block">
                <span>BID STEP</span>
                <select
                  data-testid="settings-increment"
                  disabled={!me.isHost}
                  value={room.settings.bidIncrementEUR / MILLION}
                  onChange={(event) =>
                    void onSettings({ bidIncrementEUR: Number(event.target.value) * MILLION })
                  }
                >
                  <option value={1}>€1M</option>
                  <option value={2}>€2M</option>
                  <option value={5}>€5M</option>
                  <option value={10}>€10M</option>
                </select>
              </label>
              <label className="setting-block">
                <span>AUCTION CLOCK</span>
                <select
                  data-testid="settings-timer"
                  disabled={!me.isHost}
                  value={room.settings.auctionTimerSeconds}
                  onChange={(event) =>
                    void onSettings({ auctionTimerSeconds: Number(event.target.value) })
                  }
                >
                  <option value={8}>8 SEC</option>
                  <option value={12}>12 SEC</option>
                  <option value={18}>18 SEC</option>
                  <option value={25}>25 SEC</option>
                </select>
              </label>
            </div>
            <label className="toggle-setting">
              <span>
                <b>STRICT BUDGET</b>
                <small>Reserve enough to complete the XI</small>
              </span>
              <input
                data-testid="settings-mode"
                type="checkbox"
                checked={room.settings.budgetMode === 'STRICT'}
                disabled={!me.isHost}
                onChange={(event) =>
                  void onSettings({ budgetMode: event.target.checked ? 'STRICT' : 'CHAOS' })
                }
              />
              <i />
            </label>
            <label className="toggle-setting">
              <span>
                <b>ROOM SOUND</b>
                <small>Default event cues for the room</small>
              </span>
              <input
                data-testid="settings-sound"
                type="checkbox"
                checked={room.settings.soundEnabled}
                disabled={!me.isHost}
                onChange={(event) => void onSettings({ soundEnabled: event.target.checked })}
              />
              <i />
            </label>
            <label className="setting-block">
              <span>CURRENT-FORM WINDOW</span>
              <select
                data-testid="settings-lookback"
                disabled={!me.isHost}
                value={room.settings.formLookback}
                onChange={(event) =>
                  void onSettings({
                    formLookback: event.target.value as RoomSettingsInput['formLookback'],
                  })
                }
              >
                <option value="5_MATCHES">LAST 5 MATCHES</option>
                <option value="10_MATCHES">LAST 10 MATCHES</option>
                <option value="CURRENT_SEASON">CURRENT SEASON</option>
              </select>
            </label>
          </div>
        </section>
      </div>

      <section className="lobby-actions">
        <button
          className={`ready-button ${me.isReady ? 'is-ready' : ''}`}
          data-testid="ready-toggle"
          disabled={me.isSpectator || Boolean(busyAction) || preparing}
          type="button"
          onClick={() => void onReady(!me.isReady)}
        >
          <span>{me.isReady ? '✓' : '○'}</span>
          <b>{me.isReady ? 'YOU ARE READY' : 'MARK AS READY'}</b>
          <small>{me.isReady ? 'Click to stand down' : 'Lock in your seat'}</small>
        </button>
        {me.isHost ? (
          <button
            className="start-button"
            data-testid="start-game"
            disabled={!everyoneReady || Boolean(busyAction) || preparing}
            type="button"
            onClick={() => void onStart()}
          >
            <span>
              {busyAction === 'start' || preparing
                ? 'PREPARING THE MARKET…'
                : activeMembers.length < 2
                  ? 'WAITING FOR 2 DIRECTORS'
                  : !everyoneReady
                    ? 'EVERY DIRECTOR MUST BE READY'
                    : 'START THE AUCTION'}
            </span>
            <ArrowIcon />
          </button>
        ) : (
          <div className="host-wait">
            <i />
            <span>
              {preparing
                ? 'THE MARKET IS BEING PREPARED'
                : 'WAITING FOR THE HOST TO OPEN THE MARKET'}
            </span>
          </div>
        )}
      </section>
      <button
        className="leave-link"
        data-testid="leave-room"
        type="button"
        onClick={() => void onLeave()}
      >
        LEAVE WAR ROOM
      </button>
      {preparing ? (
        <div className="preparing-overlay" role="status" data-testid="game-preparing">
          <div className="data-orbit">
            <i />
            <i />
            <i />
          </div>
          <p className="eyebrow">FREEZING LIVE DATA</p>
          <h2>BUILDING THE HIDDEN MARKET</h2>
          <p>Current form. Current clubs. One fair, seeded reveal order.</p>
        </div>
      ) : null}
    </main>
  );
}
