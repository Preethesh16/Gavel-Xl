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

const AVATARS = [
  { id: 'shield', symbol: '◇', label: 'Shield' },
  { id: 'bolt', symbol: 'ϟ', label: 'Bolt' },
  { id: 'crown', symbol: '♜', label: 'Crown' },
  { id: 'star', symbol: '✦', label: 'Star' },
  { id: 'target', symbol: '⊙', label: 'Target' },
  { id: 'wave', symbol: '≋', label: 'Wave' },
] as const;

type LandingMode = 'choice' | 'create' | 'join';

interface LandingProps {
  busyAction: string | null;
  suggestedCode?: string;
  onCreate: (input: CreateRoomInput) => Promise<{ ok: boolean }>;
  onJoin: (input: JoinRoomInput) => Promise<{ ok: boolean }>;
}

export function Landing({ busyAction, suggestedCode, onCreate, onJoin }: LandingProps) {
  const [mode, setMode] = useState<LandingMode>(suggestedCode ? 'join' : 'choice');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(suggestedCode ?? '');
  const [avatar, setAvatar] = useState<(typeof AVATARS)[number]['id']>('shield');
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
    <main className="landing" data-testid="landing-screen">
      <div className="stadium-lines" />
      <div className="landing__beam landing__beam--left" />
      <div className="landing__beam landing__beam--right" />
      <header className="landing__header">
        <Brand />
        <span className="live-chip">
          <i /> LIVE MULTIPLAYER
        </span>
      </header>

      <section className="hero">
        <div className="hero__stage">
          <div className="hero__copy">
            <h1>
              BUILD YOUR XI.
              <br />
              <em>OWN THE MARKET.</em>
            </h1>
            <p className="hero__lede">Draft. Bid. Build. Win.</p>
            <div className="hero__proof" aria-label="Game features">
              <span>
                <CheckIcon /> 2–8 DIRECTORS
              </span>
              <span>
                <CheckIcon /> REAL-TIME AUCTIONS
              </span>
            </div>
          </div>

          <figure className="cover-athlete" aria-label="Cover athlete Lamine Yamal">
            <Image
              alt="Lamine Yamal celebrating with the world championship trophy"
              className="cover-athlete__image"
              height={1750}
              priority
              sizes="(max-width: 760px) 88vw, 52vw"
              src="/athletes/lamine-yamal-cover.png"
              width={1400}
            />
            <div className="cover-athlete__stats" aria-label="Lamine Yamal cover profile">
              <span>
                <small>ROLE</small>
                <b>RIGHT WINGER</b>
              </span>
              <span>
                <small>CLUB</small>
                <b>BARCELONA</b>
              </span>
              <span>
                <small>STATUS</small>
                <b>WORLD CHAMPION</b>
              </span>
            </div>
          </figure>
        </div>

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
              <p className="entry-choice__intro">Create or join.</p>
              <button
                className="action-card action-card--primary"
                data-testid="create-room-open"
                type="button"
                onClick={() => setMode('create')}
              >
                <span className="action-card__index">A</span>
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
                <span className="action-card__index">B</span>
                <span>
                  <b>JOIN ROOM</b>
                  <small>Enter with a code</small>
                </span>
                <ArrowIcon />
              </button>
              <div className="entry-choice__rule">
                <span /> THE MARKET WAITS FOR NO ONE <span />
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
                      {option.symbol}
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
      </section>

      <footer className="landing__footer">
        <span>© GAVEL XI</span>
        <span className="landing__footer-line" />
        <span>PLAYER PROFILES · MARKET VALUES · SEEDED FAIRNESS</span>
      </footer>
    </main>
  );
}
