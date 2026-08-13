'use client';

import type { EvaluationView, RoomView } from '@gavel-xi/shared';
import { useMemo, useState } from 'react';
import { METRIC_CATEGORIES, categoryTone } from '@/lib/metrics';
import { SearchIcon } from './icons';

export function MetricsExplorer({
  room,
  evaluation,
}: {
  room: RoomView;
  evaluation: EvaluationView;
}) {
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const metrics = useMemo(
    () =>
      evaluation.metrics.filter((metric) => {
        const categoryMatch = category === 'ALL' || metric.category.toUpperCase() === category;
        const queryMatch =
          !query.trim() || metric.metric.toLowerCase().includes(query.trim().toLowerCase());
        return categoryMatch && queryMatch;
      }),
    [category, evaluation.metrics, query],
  );
  const members = room.members.filter((member) => !member.isSpectator);

  return (
    <section className="metrics-explorer" data-testid="metrics-explorer">
      <header className="results-section-heading">
        <div>
          <p className="eyebrow">THE FULL MODEL</p>
          <h2>100 METRICS</h2>
        </div>
        <div className="metric-count">
          <strong data-testid="metric-count">{evaluation.metrics.length}</strong>
          <span>
            MEASURED
            <br />
            VERDICTS
          </span>
        </div>
      </header>
      <div className="metric-toolbar">
        <label className="metric-search">
          <SearchIcon />
          <input
            data-testid="metrics-search"
            type="search"
            placeholder="Search finishing, pressing, balance…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="metric-filter">
          <span>CATEGORY</span>
          <select
            data-testid="metrics-category-filter"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
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
      <div className="metric-legend">
        {members.map((member) => (
          <span key={member.id}>
            <i style={{ background: member.color }} />
            {member.name}
          </span>
        ))}
      </div>
      <div className="metric-list" data-testid="metrics-list">
        {metrics.map((metric) => {
          const ranked = members
            .map((member) => ({ member, score: metric.scores[member.id] ?? 0 }))
            .sort((a, b) => b.score - a.score);
          return (
            <article
              className={`metric-card ${categoryTone(metric.category)}`}
              data-testid={`metric-${metric.index}`}
              key={metric.index}
            >
              <div className="metric-card__heading">
                <span>{String(metric.index).padStart(3, '0')}</span>
                <div>
                  <small>{metric.category}</small>
                  <h3>{metric.metric}</h3>
                </div>
                <em>{ranked[0]?.score.toFixed(1) ?? '—'}</em>
              </div>
              <div className="metric-bars">
                {ranked.map(({ member, score }, index) => (
                  <div className={index === 0 ? 'is-winner' : ''} key={member.id}>
                    <span>{member.name}</span>
                    <i>
                      <b
                        style={{
                          width: `${Math.max(0, Math.min(100, score))}%`,
                          background: member.color,
                        }}
                      />
                    </i>
                    <strong>{score.toFixed(1)}</strong>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {!metrics.length ? (
        <div className="empty-results">
          <SearchIcon />
          <h3>NO METRICS MATCH</h3>
          <p>Try another category or a shorter search.</p>
        </div>
      ) : null}
    </section>
  );
}
