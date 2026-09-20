'use client';

import type { EvaluationView, RoomView } from '@gavel-xi/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { METRIC_CATEGORIES } from '@/lib/metrics';
import { ReplayIcon, SearchIcon } from './icons';

/** CSS reels reveal the score; the accessible value is always the locked result. */
function MetricNumber({ value }: { value: number }) {
  const formatted = value.toFixed(1);
  return (
    <span className="score-number" role="img" aria-label={formatted}>
      {formatted.split('').map((character, index) =>
        character === '.' ? (
          <span className="score-point" aria-hidden="true" key={index}>
            .
          </span>
        ) : (
          <span
            className="score-reel"
            aria-hidden="true"
            key={index}
            style={
              {
                '--digit': Number(character) + 10,
                '--digit-delay': `${index * 75}ms`,
              } as CSSProperties
            }
          >
            <span className="score-reel__strip">
              {Array.from({ length: 20 }, (_, digit) => (
                <span key={digit}>{digit % 10}</span>
              ))}
            </span>
          </span>
        ),
      )}
    </span>
  );
}

export function MetricDial({
  name,
  score,
  color,
  leading,
  order,
}: {
  name: string;
  score: number;
  color: string;
  leading: boolean;
  order: number;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div
      className={`metric-contender ${leading ? 'is-leading' : ''}`}
      style={
        {
          '--score-color': color,
          '--score': clamped,
          '--score-delay': `${order * 110}ms`,
        } as CSSProperties
      }
    >
      <div
        className="metric-dial"
        role="img"
        aria-label={`${name}: ${score.toFixed(1)} out of 100`}
      >
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle className="metric-dial__halo" cx="70" cy="70" r="63" />
          <circle className="metric-dial__track" cx="70" cy="70" r="55" pathLength="100" />
          <circle
            className="metric-dial__score"
            cx="70"
            cy="70"
            r="55"
            pathLength="100"
            strokeDasharray={`${clamped} 100`}
          />
          <circle className="metric-dial__ticks" cx="70" cy="70" r="45" pathLength="100" />
        </svg>
        <div className="metric-dial__number">
          <MetricNumber value={score} />
          <small>OUT OF 100</small>
        </div>
        {leading ? (
          <span className="metric-dial__crown" aria-hidden="true">
            ✦
          </span>
        ) : null}
      </div>
      <strong>{name}</strong>
      <span>{leading ? 'METRIC LEADER' : 'CHALLENGER'}</span>
    </div>
  );
}

export function MetricsExplorer({
  room,
  evaluation,
}: {
  room: RoomView;
  evaluation: EvaluationView;
}) {
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [motionRun, setMotionRun] = useState(0);
  const root = useRef<HTMLElement>(null);
  const metrics = useMemo(
    () =>
      evaluation.metrics.filter(
        (metric) =>
          (category === 'ALL' || metric.category.toUpperCase() === category) &&
          (!query.trim() || metric.metric.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [category, evaluation.metrics, query],
  );
  const members = room.members.filter((member) => !member.isSpectator);
  const shown = useMemo(() => new Set(metrics.map((metric) => metric.index)), [metrics]);
  const filterKey = `${category}:${query}`;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const cards = [...element.querySelectorAll<HTMLElement>('.metric-lab-card')];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const card = entry.target as HTMLElement;
          card.dataset.intersecting = String(entry.isIntersecting);
          card.dataset.motion = entry.isIntersecting && !document.hidden ? 'active' : 'idle';
          if (entry.isIntersecting) card.dataset.seen = 'true';
        }
      },
      { threshold: 0.12 },
    );
    const visibility = () =>
      cards.forEach((card) => {
        card.dataset.motion =
          card.dataset.intersecting === 'true' && !document.hidden ? 'active' : 'idle';
      });
    cards.forEach((card) => observer.observe(card));
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [filterKey, motionRun, evaluation.metrics]);

  useEffect(() => {
    if (selected === null) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-testid="metric-${selected}"]`);
    card?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'center',
    });
    card?.focus({ preventScroll: true });
  }, [selected]);

  return (
    <section className="metrics-explorer metric-lab" data-testid="metrics-explorer" ref={root}>
      <header className="metric-lab__hero">
        <div>
          <p className="eyebrow">THE PERFORMANCE LAB / EVERY EDGE COUNTS</p>
          <h2>
            NUMBERS.
            <br />
            <em>WITH IMPACT.</em>
          </h2>
          <p>
            A hundred head-to-head battles. Find the tiny margins that decided the entire draft.
          </p>
          <div className="metric-lab__total">
            <strong data-testid="metric-count">{evaluation.metrics.length}</strong>
            <span>
              METRICS
              <br />
              ONE COMPLETE PICTURE
            </span>
            <button
              data-testid="metrics-replay-motion"
              onClick={() => setMotionRun((run) => run + 1)}
            >
              <ReplayIcon /> REPLAY MOTION
            </button>
          </div>
        </div>
        <div className="metric-map" aria-label="Explore all metric winners">
          <header>
            <span>THE 100-METRIC MAP</span>
            <b>CHOOSE A TILE ↗</b>
          </header>
          <div className="metric-map__grid">
            {evaluation.metrics.map((metric, index) => {
              const winners = members.filter((member) => metric.winnerIds.includes(member.id));
              const shared = winners.length > 1;
              return (
                <button
                  key={metric.index}
                  data-testid={`lab-cell-${metric.index}`}
                  disabled={!shown.has(metric.index)}
                  className={selected === metric.index ? 'is-selected' : ''}
                  aria-pressed={selected === metric.index}
                  aria-label={`${metric.index}. ${metric.metric}. ${shared ? 'Shared lead: ' : 'Leader: '}${winners.map((member) => member.name).join(' and ')}`}
                  title={`${metric.metric} · ${winners.map((member) => member.name).join(' & ')}`}
                  onClick={() => setSelected(metric.index)}
                  style={
                    {
                      '--cell-color': shared ? '#fff4dc' : (winners[0]?.color ?? '#f1bf00'),
                      '--cell-delay': `${(index % 10) * 24 + Math.floor(index / 10) * 35}ms`,
                    } as CSSProperties
                  }
                >
                  <span>{String(metric.index).padStart(2, '0')}</span>
                </button>
              );
            })}
          </div>
          <footer>
            {members.map((member) => (
              <span key={member.id}>
                <i style={{ background: member.color }} />
                {member.name}
                <b>
                  {
                    evaluation.metrics.filter((metric) => metric.winnerIds.includes(member.id))
                      .length
                  }{' '}
                  wins
                </b>
              </span>
            ))}
            {evaluation.metrics.some((metric) => metric.winnerIds.length > 1) ? (
              <span>
                <i style={{ background: '#fff4dc' }} />
                Shared leads count for each director
              </span>
            ) : null}
          </footer>
        </div>
      </header>
      <div className="metric-toolbar">
        <label className="metric-search">
          <SearchIcon />
          <input
            aria-label="Search metrics"
            data-testid="metrics-search"
            type="search"
            placeholder="Search finishing, pressing, balance…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
          />
        </label>
        <label className="metric-filter">
          <span>CATEGORY</span>
          <select
            data-testid="metrics-category-filter"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setSelected(null);
            }}
          >
            <option value="ALL">ALL 100 METRICS</option>
            {METRIC_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="metric-lab__status" role="status">
        <span>
          {metrics.length} / {evaluation.metrics.length} METRICS IN VIEW
        </span>
        <p>
          <i />
          Final scores · tap a tile to inspect a metric
        </p>
      </div>
      <div
        className="metric-lab__cards"
        data-testid="metrics-list"
        key={`${filterKey}:${motionRun}`}
      >
        {metrics.map((metric) => {
          const ranked = members
            .map((member) => ({ member, score: metric.scores[member.id] ?? 0 }))
            .sort((a, b) => b.score - a.score);
          const margin =
            ranked.length > 1 ? (ranked[0]!.score - ranked[1]!.score).toFixed(1) : null;
          return (
            <article
              className={`metric-lab-card ${selected === metric.index ? 'is-focused' : ''}`}
              key={metric.index}
              data-testid={`metric-${metric.index}`}
              data-motion="idle"
              data-seen="false"
              tabIndex={-1}
              aria-label={`${metric.metric} scores`}
            >
              <header>
                <span className="metric-lab-card__index">
                  {String(metric.index).padStart(3, '0')}
                </span>
                <div>
                  <p>{metric.category}</p>
                  <h3>{metric.metric}</h3>
                </div>
                <span className="metric-lab-card__seal" aria-hidden="true">
                  ↗
                </span>
              </header>
              <div
                className="metric-dial-grid"
                style={{ '--competitors': Math.min(4, members.length) } as CSSProperties}
              >
                {ranked.map(({ member, score }, index) => (
                  <MetricDial
                    key={member.id}
                    name={member.name}
                    score={score}
                    color={member.color}
                    leading={metric.winnerIds.includes(member.id)}
                    order={index}
                  />
                ))}
              </div>
              <footer>
                <span>{metric.winnerIds.length > 1 ? 'SHARED LEAD' : 'THE DECISIVE EDGE'}</span>
                <b>
                  {metric.winnerIds
                    .map((id) => members.find((member) => member.id === id)?.name ?? 'Director')
                    .join(' & ')}
                </b>
                {margin !== null ? (
                  <em>{Number(margin) === 0 ? 'LEVEL' : `+${margin} PTS`}</em>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
      {!metrics.length ? (
        <div className="empty-results">
          <SearchIcon />
          <h3>NO METRICS MATCH</h3>
          <p>Try another category or a shorter search.</p>
          <button
            className="metric-lab__reset"
            onClick={() => {
              setCategory('ALL');
              setQuery('');
            }}
          >
            RESET FILTERS ↗
          </button>
        </div>
      ) : null}
    </section>
  );
}
