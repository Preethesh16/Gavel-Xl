'use client';

import {
  avatarSchema,
  displayNameSchema,
  roomCodeSchema,
  type CreateRoomInput,
  type JoinRoomInput,
} from '@gavel-xi/shared';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ArrowIcon, CheckIcon } from './icons';
import { Brand } from './brand';
import { FORMATION_PITCHES } from '@/lib/formations';
import type { ConnectionState } from '@/hooks/use-gavel-room';

const AVATARS = [
  { id: 'barcelona', label: 'FC Barcelona' },
  { id: 'real-madrid', label: 'Real Madrid' },
  { id: 'manchester-united', label: 'Manchester United' },
  { id: 'liverpool', label: 'Liverpool' },
  { id: 'manchester-city', label: 'Manchester City' },
  { id: 'arsenal', label: 'Arsenal' },
  { id: 'chelsea', label: 'Chelsea' },
  { id: 'bayern-munich', label: 'Bayern Munich' },
  { id: 'psg', label: 'Paris Saint-Germain' },
  { id: 'juventus', label: 'Juventus' },
] as const;

type LandingMode = 'choice' | 'create' | 'join';

interface LandingProps {
  busyAction: string | null;
  connection: ConnectionState;
  suggestedCode?: string;
  onCreate: (input: CreateRoomInput) => Promise<{ ok: boolean }>;
  onJoin: (input: JoinRoomInput) => Promise<{ ok: boolean }>;
}

export function Landing({ busyAction, connection, suggestedCode, onCreate, onJoin }: LandingProps) {
  const [mode, setMode] = useState<LandingMode>(suggestedCode ? 'join' : 'choice');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(suggestedCode ?? '');
  const [avatar, setAvatar] = useState<(typeof AVATARS)[number]['id']>('barcelona');
  const [formation, setFormation] = useState('4-3-3');
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (suggestedCode) {
      setRoomCode(suggestedCode);
      setMode('join');
    }
  }, [suggestedCode]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedName = displayNameSchema.safeParse(name);
    const parsedAvatar = avatarSchema.safeParse(avatar);
    if (!parsedName.success || !parsedAvatar.success) {
      setValidation(parsedName.error?.issues[0]?.message ?? 'Choose a valid director profile.');
      return;
    }
    setValidation(null);
    await onCreate({ name: parsedName.data, avatar: parsedAvatar.data });
  };

  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedName = displayNameSchema.safeParse(name);
    const parsedCode = roomCodeSchema.safeParse(roomCode);
    const parsedAvatar = avatarSchema.safeParse(avatar);
    if (!parsedName.success || !parsedCode.success || !parsedAvatar.success) {
      setValidation(
        parsedCode.error?.issues[0]?.message ??
          parsedName.error?.issues[0]?.message ??
          'Check your details.',
      );
      return;
    }
    setValidation(null);
    await onJoin({ roomCode: parsedCode.data, name: parsedName.data, avatar: parsedAvatar.data });
  };

  return (
    <main className="transfer-home" data-testid="landing-screen">
      <header className="transfer-nav">
        <Brand />
        <a href="#playbook">
          THE PLAYBOOK <span>↗</span>
        </a>
        <span className={`service-status service-status--${connection}`} role="status">
          <i />{' '}
          {connection === 'online'
            ? 'CONNECTED · READY TO PLAY'
            : connection === 'offline'
              ? 'SERVER UNAVAILABLE · RETRYING'
              : 'CONNECTING TO THE MARKET'}
        </span>
      </header>

      <section className="transfer-hero">
        <div className="transfer-intro">
          <p className="transfer-kicker">
            <span /> THE BEAUTIFUL GAME. YOUR RULES.
          </p>
          <h1>
            BUILD THE XI.
            <br />
            <em>BREAK THE BANK.</em>
          </h1>
          <p className="transfer-description">
            Big names. Bigger decisions. Take the hot seat in a live football auction and build a
            squad worth fighting for.
          </p>
          <a className="transfer-enter-link" href="#enter-market">
            ENTER THE MARKET <span>↘</span>
          </a>
          <div className="transfer-facts">
            <span>
              <b>02–08</b> DIRECTORS
            </span>
            <span>
              <b>11 + 1</b> PLAYERS & MANAGER
            </span>
            <span>
              <b>100</b> RATING METRICS
            </span>
          </div>
        </div>
        <figure className="transfer-cover">
          <span className="transfer-cover__edition">THE TRANSFER ROOM / GXI</span>
          <span className="transfer-cover__type" aria-hidden="true">
            XI
          </span>
          <Image
            alt="Gavel XI cover athlete Lamine Yamal with a trophy"
            className="transfer-cover__image"
            height={1750}
            priority
            sizes="(max-width: 760px) 90vw, 45vw"
            src="/athletes/lamine-yamal-cover.png"
            width={1400}
          />
          <figcaption>
            <span>THE NEXT GENERATION</span>
            <strong>
              LAMINE
              <br />
              YAMAL<span>↗</span>
            </strong>
            <small>RIGHT WINGER / BARCELONA</small>
          </figcaption>
          <span className="transfer-cover__seal">
            ONE ROOM.
            <br />
            ALL TO PLAY FOR.
          </span>
        </figure>
      </section>

      <section id="enter-market" className="transfer-workspace" aria-label="Enter the auction">
        <div className="entry-shell">
          <div className="entry-shell__topline">
            <span>
              {mode === 'join'
                ? 'ENTER ROOM'
                : mode === 'create'
                  ? 'OPEN A ROOM'
                  : 'TAKE YOUR SEAT'}
            </span>
            <b>GXI / 01</b>
          </div>
          {mode === 'choice' ? (
            <div className="entry-choice">
              <h2 className="entry-choice__intro">Your seat is waiting.</h2>
              <p className="entry-description">
                Bring your football knowledge. Invite your rivals. We’ll bring the gavel.
              </p>
              <button
                className="action-card action-card--primary"
                data-testid="create-room-open"
                type="button"
                onClick={() => setMode('create')}
              >
                <span className="action-card__index">01</span>
                <span>
                  <b>CREATE ROOM</b>
                  <small>Host the auction</small>
                </span>
                <ArrowIcon />
              </button>
              <button
                className="action-card"
                data-testid="join-room-open"
                type="button"
                onClick={() => setMode('join')}
              >
                <span className="action-card__index">02</span>
                <span>
                  <b>JOIN ROOM</b>
                  <small>Enter with a code</small>
                </span>
                <ArrowIcon />
              </button>
              <div className="entry-choice__rule">
                <span /> NO ACCOUNT. JUST FOOTBALL. <span />
              </div>
            </div>
          ) : (
            <form className="entry-form" onSubmit={mode === 'create' ? create : join}>
              <button
                className="text-back"
                type="button"
                onClick={() => {
                  setMode('choice');
                  setValidation(null);
                }}
              >
                ← BACK
              </button>
              {mode === 'join' ? (
                <label className="field">
                  <span>ROOM CODE</span>
                  <input
                    autoFocus
                    autoCapitalize="characters"
                    autoComplete="off"
                    data-testid="join-room-code-input"
                    inputMode="text"
                    maxLength={6}
                    onChange={(event) =>
                      setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="K7P4XQ"
                    value={roomCode}
                  />
                </label>
              ) : null}
              <label className="field">
                <span>SPORTING DIRECTOR</span>
                <input
                  autoFocus={mode === 'create'}
                  autoComplete="nickname"
                  data-testid={mode === 'create' ? 'create-name-input' : 'join-name-input'}
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your display name"
                  value={name}
                />
              </label>
              <fieldset className="avatar-field">
                <legend>YOUR CREST</legend>
                <div className="avatar-grid">
                  {AVATARS.map((option) => (
                    <button
                      aria-label={option.label}
                      aria-pressed={avatar === option.id}
                      className={
                        avatar === option.id ? 'avatar-option is-selected' : 'avatar-option'
                      }
                      data-testid={`${mode}-${option.id}-avatar`}
                      key={option.id}
                      onClick={() => setAvatar(option.id)}
                      type="button"
                    >
                      <Image
                        alt=""
                        className="avatar-option__crest"
                        height={48}
                        src={`/crests/${option.id}.png`}
                        width={48}
                      />
                    </button>
                  ))}
                </div>
              </fieldset>
              {validation ? (
                <p className="form-error" role="alert">
                  {validation}
                </p>
              ) : null}
              <button
                className="primary-button"
                data-testid={mode === 'create' ? 'create-room-submit' : 'join-room-submit'}
                disabled={Boolean(busyAction)}
                type="submit"
              >
                <span>
                  {busyAction
                    ? 'CONNECTING…'
                    : mode === 'create'
                      ? 'CREATE THE WAR ROOM'
                      : 'ENTER THE WAR ROOM'}
                </span>
                <ArrowIcon />
              </button>
            </form>
          )}
        </div>
        <aside className="tactics-preview">
          <header>
            <div>
              <p className="transfer-kicker">YOUR VISION STARTS HERE</p>
              <h2>Pick your shape.</h2>
            </div>
            <span className="preview-label">FORMATION PREVIEW</span>
          </header>
          <div className="formation-switch" aria-label="Preview a formation">
            {['4-3-3', '4-4-2', '3-5-2'].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={formation === value}
                onClick={() => setFormation(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="tactics-pitch" aria-label={`${formation} formation preview`}>
            <div className="tactics-pitch__circle" />
            <div className="tactics-pitch__box" />
            {FORMATION_PITCHES[formation]?.map((slot, index) => (
              <span
                className="tactics-player"
                key={index}
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                <b>{String(index + 1).padStart(2, '0')}</b>
                <small>{slot.label}</small>
              </span>
            ))}
          </div>
          <footer>
            <CheckIcon />
            <span>Explore your shape. The host sets the match formation in the lobby.</span>
          </footer>
        </aside>
      </section>

      <section className="transfer-playbook" id="playbook">
        <header>
          <p className="transfer-kicker">THE PLAYBOOK</p>
          <h2>
            A football mind.
            <br />
            <em>A poker face.</em>
          </h2>
        </header>
        <article>
          <span>01 / ASSEMBLE</span>
          <h3>Make it a rivalry.</h3>
          <p>
            Create a private room. Choose your budget and formation, then send the invite to your
            friends.
          </p>
        </article>
        <article>
          <span>02 / OUTBID</span>
          <h3>Read the room.</h3>
          <p>
            Bid live as each player is revealed. Save for a superstar or build balance. Every euro
            counts.
          </p>
        </article>
        <article>
          <span>03 / PROVE IT</span>
          <h3>Let football decide.</h3>
          <p>
            Eleven players. One manager. See how your squad stacks up across 100 football metrics.
          </p>
        </article>
      </section>
      <footer className="transfer-footer">
        <Brand />
        <span>BUILD THE XI. BREAK THE BANK.</span>
        <a href="#playbook">HOW IT WORKS ↑</a>
      </footer>
    </main>
  );
}
