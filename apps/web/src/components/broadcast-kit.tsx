'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

export function CountUp({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const update = (now: number) => {
      const progress = Math.min(1, (now - start) / 1000);
      setDisplay(value * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span className="broadcast-number" aria-label={value.toFixed(decimals)}>
      {display.toFixed(decimals)}
    </span>
  );
}

export function BroadcastAtmosphere({ celebration = false }: { celebration?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersecting = false;
    const visibility = () => {
      element.dataset.running = String(intersecting && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = Boolean(entry?.isIntersecting);
      visibility();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`broadcast-atmosphere ${celebration ? 'is-celebrating' : ''}`}
      aria-hidden="true"
      data-running="true"
    >
      <div className="broadcast-orbit broadcast-orbit--one" />
      <div className="broadcast-orbit broadcast-orbit--two" />
      <div className="broadcast-light broadcast-light--left" />
      <div className="broadcast-light broadcast-light--right" />
      {celebration ? (
        <div className="broadcast-confetti">
          {Array.from({ length: 36 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  '--particle': index,
                  left: `${(index * 37) % 100}%`,
                  '--drift': `${(index % 2 ? 1 : -1) * (40 + index * 3)}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BroadcastStrip({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="broadcast-strip">
      <span>
        <i /> GXI / {label}
      </span>
      <p>{detail}</p>
      <b>
        ON AIR{' '}
        <span className="broadcast-wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      </b>
    </div>
  );
}

export function TrophySculpture() {
  return (
    <div className="trophy-sculpture" aria-hidden="true">
      <div className="trophy-halo" />
      <svg viewBox="0 0 240 260" fill="none">
        <defs>
          <linearGradient
            id="trophy-gold"
            x1="40"
            y1="0"
            x2="200"
            y2="220"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff4dc" />
            <stop offset=".36" stopColor="#f1bf00" />
            <stop offset=".62" stopColor="#ffe58b" />
            <stop offset="1" stopColor="#977013" />
          </linearGradient>
        </defs>
        <path
          d="M74 54H38v27c0 35 20 52 53 56M166 54h36v27c0 35-20 52-53 56"
          stroke="url(#trophy-gold)"
          strokeWidth="13"
        />
        <path d="M65 30h110v58c0 38-22 67-55 67S65 126 65 88V30Z" fill="url(#trophy-gold)" />
        <path d="M78 40h12v54c0 23 7 38 19 49-20-7-31-25-31-49V40Z" fill="#fff4dc" opacity=".5" />
        <path d="M112 153h16v46h-16zM86 198h68v15H86zM65 217h110v23H65z" fill="url(#trophy-gold)" />
        <path d="m120 64 8 16 18 3-13 12 3 18-16-8-16 8 3-18-13-12 18-3 8-16Z" fill="#001d4a" />
        <path d="M75 244h90" stroke="#f1bf00" strokeWidth="3" />
      </svg>
      <span>THE GAVEL / XI</span>
    </div>
  );
}
