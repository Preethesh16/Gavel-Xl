'use client';

import { useEffect, useState } from 'react';
import { CloseIcon, GavelIcon, TeamIcon } from './icons';

const SCENES = [
  {
    kicker: '01 · BUILD THE XI',
    title: 'ONE FORMATION. TWELVE DECISIONS.',
    body: 'Draft exactly eleven players shaped by your formation, then secure one manager. The player pool changes every game.',
    visual: 'formation',
  },
  {
    kicker: '02 · WIN THE MARKET',
    title: 'BID. PASS. PROTECT THE BUDGET.',
    body: 'Every accepted bid resets the clock to 20 seconds. Fill each role before your rivals and use Preview Team to watch your lineup take shape.',
    visual: 'auction',
  },
  {
    kicker: '03 · THE SAFETY NET',
    title: 'THE LAST DIRECTOR GETS THE FORCED DEAL.',
    body: 'Once the other players for a slot are sold, the remaining director receives a deliberately lower-rated fallback player.',
    visual: 'forced',
  },
  {
    kicker: '04 · COVER STAR',
    title: 'LAMINE YAMAL: THE 1-IN-30 CARD.',
    body: 'Yamal only enters the pool on a rare one-in-thirty game draw. The director who signs him earns +4.0 on the final overall score.',
    visual: 'yamal',
  },
  {
    kicker: '05 · COVER TEAM',
    title: 'SPAIN CHANGES THE VERDICT.',
    body: 'Spanish players can appear in every game. Owning at least one Spain player other than Yamal adds +2.0 to your final overall score.',
    visual: 'spain',
  },
] as const;

interface GameGuideProps {
  onClose: () => void;
}

export function GameGuide({ onClose }: GameGuideProps) {
  const [scene, setScene] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setScene((current) => (current + 1) % SCENES.length);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const active = SCENES[scene]!;
  return (
    <div className="guide-backdrop" role="presentation">
      <section
        className="game-guide"
        aria-label="How to play Gavel XI"
        aria-modal="true"
        role="dialog"
      >
        <header>
          <span>GAVEL XI · MATCH BRIEFING</span>
          <button aria-label="Skip game explanation" type="button" onClick={onClose}>
            SKIP <CloseIcon />
          </button>
        </header>
        <div className={`game-guide__visual game-guide__visual--${active.visual}`} key={scene}>
          {active.visual === 'formation' ? (
            <div className="guide-formation">
              {Array.from({ length: 11 }, (_, index) => (
                <i key={index} />
              ))}
              <TeamIcon />
            </div>
          ) : null}
          {active.visual === 'auction' ? <GavelIcon /> : null}
          {active.visual === 'forced' ? (
            <div className="guide-cards">
              <i />
              <i />
              <i />
            </div>
          ) : null}
          {active.visual === 'yamal' ? (
            <>
              <div className="game-guide__photo game-guide__photo--yamal" />
              <strong>
                30<span>:</span>1
              </strong>
            </>
          ) : null}
          {active.visual === 'spain' ? (
            <>
              <div className="game-guide__photo game-guide__photo--spain" />
              <div className="guide-spain">
                <span>+2.0</span>
              </div>
            </>
          ) : null}
        </div>
        <div className="game-guide__copy" key={`${scene}-copy`}>
          <p>{active.kicker}</p>
          <h2>{active.title}</h2>
          <span>{active.body}</span>
        </div>
        <footer>
          <div
            className="game-guide__timeline"
            aria-label={`Scene ${scene + 1} of ${SCENES.length}`}
          >
            {SCENES.map((item, index) => (
              <button
                aria-label={`Show ${item.kicker}`}
                className={index === scene ? 'is-active' : ''}
                key={item.kicker}
                type="button"
                onClick={() => setScene(index)}
              >
                <i />
              </button>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={onClose}>
            ENTER THE WAR ROOM
          </button>
        </footer>
      </section>
    </div>
  );
}
