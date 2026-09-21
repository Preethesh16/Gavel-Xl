'use client';

import type { EvaluationView, MetricScoreView, RoomView, TeamResultView } from '@gavel-xi/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cancelBroadcastNarration, emitBroadcast, type SoundCue } from '@/lib/broadcast-audio';
import {
  buildCeremonySteps,
  ceremonyDuration,
  nextCeremonyChapter,
  type CeremonyStep,
} from '@/lib/results-ceremony';
import { initials } from '@/lib/format';
import { BroadcastAtmosphere, BroadcastStrip, CountUp } from './broadcast-kit';
import { MetricDial } from './metrics-explorer';
import { CeremonyLineup } from './ceremony-lineup';
import { Podium } from './podium';

const CHAPTERS = [
  ['comparison', '01', 'THE COMPARISONS'],
  ['analysis', '02', 'THE ANALYST DESK'],
  ['verdict', '03', 'THE FINAL VERDICT'],
  ['lineup', '04', 'THE TEAM TOUR'],
] as const;

function nameOf(room: RoomView, id: string) {
  return room.members.find((member) => member.id === id)?.name ?? 'Director';
}
function colorOf(room: RoomView, id: string) {
  return room.members.find((member) => member.id === id)?.color ?? '#f1bf00';
}
function teamAnalysis(evaluation: EvaluationView, team: TeamResultView) {
  const report = evaluation.analystReport?.teamVerdicts.find(
    (verdict) => verdict.memberId === team.memberId,
  );
  return [
    [
      'TACTICAL IDENTITY',
      report?.tacticalIdentity || team.strengths[0] || 'A balanced footballing identity.',
    ],
    [
      'THE DECISIVE EDGE',
      report?.decisiveEdge ||
        team.strengths[1] ||
        team.strengths[0] ||
        'Consistency across the squad.',
    ],
    [
      'THE PRESSURE POINT',
      report?.concern || team.weakness || 'No standout weakness in this evaluation.',
    ],
  ] as const;
}
function narrationFor(
  step: CeremonyStep,
  room: RoomView,
  evaluation: EvaluationView,
): { cue: SoundCue; message: string } {
  switch (step.phase) {
    case 'category': {
      const ranked = [...evaluation.teams].sort(
        (a, b) => (b.categoryScores[step.category] ?? 0) - (a.categoryScores[step.category] ?? 0),
      );
      const top = ranked[0]?.categoryScores[step.category] ?? 0;
      const leaders = ranked.filter((team) => (team.categoryScores[step.category] ?? 0) === top);
      const names = leaders.map((team) => nameOf(room, team.memberId)).join(' and ');
      return {
        cue: 'category',
        message: `${step.category}. ${names} ${leaders.length > 1 ? 'share the lead' : 'leads this department'}. Now, the ${step.count} individual comparisons.`,
      };
    }
    case 'metric': {
      const metric = step.metric;
      const names = metric.winnerIds.map((id) => nameOf(room, id)).join(' and ');
      const best = Math.max(0, ...Object.values(metric.scores));
      const challenger = Object.entries(metric.scores)
        .filter(([id]) => !metric.winnerIds.includes(id))
        .sort((a, b) => b[1] - a[1])[0];
      return {
        cue: 'scan',
        message: `${metric.metric}. ${names} ${metric.winnerIds.length > 1 ? 'share the lead' : 'takes this metric'} with ${best.toFixed(1)} out of one hundred.${challenger ? ` ${nameOf(room, challenger[0])} follows at ${challenger[1].toFixed(1)}.` : ''}`,
      };
    }
    case 'analysis':
      return {
        cue: 'transition',
        message: `${nameOf(room, step.team.memberId)}. ${teamAnalysis(evaluation, step.team)
          .map(([label, value]) => `${label}. ${value}`)
          .join(' ')}`,
      };
    case 'verdict': {
      const winner = [...evaluation.teams].sort((a, b) => a.rank - b.rank)[0];
      return {
        cue: 'winner',
        message: winner
          ? `One hundred metrics. The verdict is in. ${nameOf(room, winner.memberId)} wins the Gavel eleven championship with ${winner.overallScore.toFixed(1)} out of one hundred. ${winner.metricWins} metric wins. What a draft!`
          : 'The evaluation is complete.',
      };
    }
    case 'lineup':
      return {
        cue: 'reveal',
        message: `${nameOf(room, step.team.memberId)}. The completed ${room.settings.formation} lineup. Overall rating, ${step.team.overallScore.toFixed(1)}. ${step.team.metricWins} metric wins. ${step.team.strengths[0] ? `The strength: ${step.team.strengths[0]}.` : ''} Select a player to inspect their form and role attributes.`,
      };
  }
}

function CategoryScene({
  room,
  evaluation,
  category,
  count,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  category: string;
  count: number;
}) {
  const ranked = [...evaluation.teams].sort(
    (a, b) => (b.categoryScores[category] ?? 0) - (a.categoryScores[category] ?? 0),
  );
  const best = ranked[0]?.categoryScores[category] ?? 0;
  const leaders = ranked.filter((team) => (team.categoryScores[category] ?? 0) === best);
  return (
    <div className="ceremony-category battle-reveal">
      <header className="ceremony-title">
        <p className="eyebrow">DEPARTMENT UNDER THE LIGHTS / {count} METRICS NEXT</p>
        <h1>{category.replaceAll(' & ', ' + ')}</h1>
        <p>One department. Every director. Let the football do the talking.</p>
      </header>
      <div className="battle-contenders">
        {ranked.map((team, index) => {
          const score = team.categoryScores[category] ?? 0;
          const leading = score === best;
          return (
            <article
              key={team.memberId}
              className={leading ? 'is-leading' : ''}
              style={
                {
                  '--team-color': colorOf(room, team.memberId),
                  '--contender-index': index,
                } as CSSProperties
              }
            >
              <span className="battle-position">{initials(nameOf(room, team.memberId))}</span>
              <div>
                <span>
                  {leading
                    ? leaders.length > 1
                      ? 'SHARED CATEGORY LEAD'
                      : 'CATEGORY LEADER'
                    : 'CHALLENGER'}
                </span>
                <h3>{nameOf(room, team.memberId)}</h3>
                <div className="battle-score-track">
                  <i style={{ transform: `scaleX(${score / 100})` }} />
                </div>
              </div>
              <strong>
                <CountUp value={score} />
                <small>/100</small>
              </strong>
            </article>
          );
        })}
      </div>
      <p className="ceremony-category__caption">
        THE BIG PICTURE IS IN. NOW WE GO METRIC BY METRIC. <span>↓</span>
      </p>
    </div>
  );
}

function MetricScene({
  room,
  evaluation,
  metric,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  metric: MetricScoreView;
}) {
  const ranked = evaluation.teams
    .map((team) => ({ memberId: team.memberId, score: metric.scores[team.memberId] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const margin = ranked.length > 1 ? (ranked[0]!.score - ranked[1]!.score).toFixed(1) : '0.0';
  return (
    <div className="ceremony-metric" data-testid="ceremony-metric" data-metric-index={metric.index}>
      <header className="ceremony-title">
        <p className="eyebrow">{metric.category} / THE HEAD-TO-HEAD</p>
        <h1>{metric.metric}</h1>
        <p>Every team. The same test. Scores out of one hundred.</p>
      </header>
      <div className="ceremony-duel metric-lab-card" data-seen="true" data-motion="active">
        <div className="ceremony-duel__stamp" aria-hidden="true">
          {String(metric.index).padStart(3, '0')}
        </div>
        <div
          className="metric-dial-grid"
          style={{ '--competitors': Math.min(4, ranked.length) } as CSSProperties}
        >
          {ranked.map(({ memberId, score }, index) => (
            <div
              key={memberId}
              data-member-id={memberId}
              data-winner={metric.winnerIds.includes(memberId)}
            >
              <MetricDial
                name={nameOf(room, memberId)}
                score={score}
                color={colorOf(room, memberId)}
                leading={metric.winnerIds.includes(memberId)}
                order={index}
              />
            </div>
          ))}
        </div>
        <div className="ceremony-decision" aria-live="polite">
          <span>{metric.winnerIds.length > 1 ? 'HONOURS SHARED' : 'THIS ONE BELONGS TO'}</span>
          <strong>{metric.winnerIds.map((id) => nameOf(room, id)).join(' + ')}</strong>
          <b>{metric.winnerIds.length > 1 ? 'JOINT LEAD' : `+${margin} POINTS`}</b>
        </div>
      </div>
      <div className="ceremony-metric__trail" aria-label="Metrics revealed in this category">
        {evaluation.metrics
          .filter((entry) => entry.category === metric.category)
          .map((entry) => (
            <span
              key={entry.index}
              className={
                entry.index === metric.index
                  ? 'is-current'
                  : entry.index < metric.index
                    ? 'is-complete'
                    : ''
              }
            >
              {String(entry.index).padStart(2, '0')}
            </span>
          ))}
      </div>
    </div>
  );
}

function AnalysisScene({
  room,
  evaluation,
  team,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  team: TeamResultView;
}) {
  const name = nameOf(room, team.memberId);
  return (
    <div
      className="ceremony-analysis"
      data-testid="ceremony-analysis"
      data-member-id={team.memberId}
      style={{ '--team-color': colorOf(room, team.memberId) } as CSSProperties}
    >
      <header className="ceremony-title">
        <p className="eyebrow">
          {evaluation.analystReport?.source === 'groq'
            ? 'AI ANALYST DESK'
            : 'FOOTBALL ENGINE ANALYSIS'}{' '}
          / TEAM BY TEAM
        </p>
        <h1>
          BEHIND
          <br />
          <em>THE NUMBERS.</em>
        </h1>
      </header>
      <div className="ceremony-analysis__team">
        <span>{initials(name)}</span>
        <div>
          <small>UNDER THE MICROSCOPE</small>
          <h2>{name}</h2>
        </div>
        <b>{room.settings.formation}</b>
      </div>
      <div className="ceremony-analysis__cards">
        {teamAnalysis(evaluation, team).map(([label, copy], index) => (
          <article key={label} style={{ '--analysis-order': index } as CSSProperties}>
            <span>0{index + 1}</span>
            <h3>{label}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <p className="ceremony-analysis__note">
        THE STRENGTHS. THE TRADE-OFFS. THE IDENTITY. <b>THE FINAL VERDICT IS NEXT.</b>
      </p>
    </div>
  );
}

export function ResultsCeremony({
  room,
  evaluation,
  onComplete,
}: {
  room: RoomView;
  evaluation: EvaluationView;
  onComplete: () => void;
}) {
  const directorOrder = room.members
    .filter((member) => !member.isSpectator)
    .map((member) => member.id)
    .join(':');
  const steps = useMemo(
    () => buildCeremonySteps(evaluation, directorOrder.split(':')),
    [evaluation, directorOrder],
  );
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [runId] = useState(() => `${Date.now()}-${Math.random()}`);
  const elapsed = useRef({ index: -1, value: 0 });
  const narrationDone = useRef(false);
  const progress = useRef<HTMLProgressElement>(null);
  const activeStep = useRef<HTMLDivElement>(null);
  const narrationGeneration = useRef(0);
  const step = steps[index];
  const chapter = step?.chapter ?? 'lineup';
  const narration = step ? narrationFor(step, room, evaluation) : null;
  const halted = paused || hidden;
  const stepKey = `${index}:${step?.phase}`;
  const cue = narration?.cue;
  const message = narration?.message;

  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);

  useEffect(() => {
    // A new step always starts at its heading, even after inspecting a long lineup.
    if (!document.activeElement?.closest('.ceremony-controls, .broadcast-audio')) {
      activeStep.current?.focus({ preventScroll: true });
    }
    const root = activeStep.current;
    const target =
      step?.phase === 'lineup'
        ? root?.querySelector<HTMLElement>('.tactical-board__stadium')
        : step?.phase === 'analysis' && window.matchMedia('(max-width: 700px)').matches
          ? root?.querySelector<HTMLElement>('.ceremony-analysis__team')
          : null;
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, [stepKey, step?.phase]);

  useEffect(() => {
    const generation = ++narrationGeneration.current;
    narrationDone.current = false;
    if (halted || !cue || !message) return;
    emitBroadcast({
      id: `ceremony-${room.code}-${runId}-${stepKey}-${generation}`,
      cue,
      message,
      delayMs: 350,
      onSettled: () => {
        if (generation === narrationGeneration.current) narrationDone.current = true;
      },
    });
    return () => {
      narrationGeneration.current += 1;
      cancelBroadcastNarration();
    };
  }, [cue, halted, message, room.code, runId, stepKey]);

  useEffect(() => {
    if (!step) {
      onComplete();
      return;
    }
    if (elapsed.current.index !== index) {
      elapsed.current = { index, value: 0 };
      if (progress.current) progress.current.value = 0;
    }
    if (halted) return;
    let last = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      elapsed.current.value += (now - last) * speed;
      last = now;
      const fraction = Math.min(1, elapsed.current.value / ceremonyDuration(step));
      if (progress.current) progress.current.value = fraction;
      if (fraction >= 1 && narrationDone.current) {
        window.clearInterval(interval);
        if (index + 1 >= steps.length) onComplete();
        else setIndex(index + 1);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [halted, index, onComplete, speed, step, steps.length]);

  const goTo = (target: number) => {
    narrationGeneration.current += 1;
    cancelBroadcastNarration();
    if (target >= steps.length) onComplete();
    else setIndex(Math.max(0, target));
  };
  const finish = () => goTo(steps.length);
  if (!step) return null;
  const phaseTitle =
    step.phase === 'metric'
      ? `METRIC ${String(step.metric.index).padStart(3, '0')} / ${evaluation.metrics.length}`
      : step.phase === 'category'
        ? 'CATEGORY SHOWDOWN'
        : step.phase === 'analysis'
          ? 'THE ANALYST DESK'
          : step.phase === 'verdict'
            ? 'THE FINAL VERDICT'
            : 'THE TEAM TOUR';
  const champion = [...evaluation.teams].sort((a, b) => a.rank - b.rank)[0];
  const nextLabel =
    chapter === 'comparison'
      ? 'GO TO ANALYSIS'
      : chapter === 'analysis'
        ? 'REVEAL THE VERDICT'
        : chapter === 'verdict'
          ? 'MEET THE TEAMS'
          : 'OPEN DASHBOARD';

  return (
    <section
      className="results-ceremony broadcast-scene"
      data-testid="results-ceremony"
      data-phase={step.phase}
      data-paused={halted}
      onClickCapture={(event) => {
        if (
          event.target instanceof Element &&
          ((step.phase === 'lineup' &&
            event.target.closest('.tactical-player, .tactical-manager')) ||
            event.target.closest('[data-pause-ceremony]'))
        )
          setPaused(true);
      }}
    >
      <BroadcastAtmosphere />
      <BroadcastStrip
        label="THE POST-MATCH SHOW"
        detail="Every metric. Every team. The full story."
      />
      <nav className="ceremony-chapters" aria-label="Ceremony chapters">
        {CHAPTERS.map(([key, number, label]) => (
          <div
            key={key}
            className={chapter === key ? 'is-current' : ''}
            aria-current={chapter === key ? 'step' : undefined}
          >
            <span>{number}</span>
            <b>{label}</b>
          </div>
        ))}
      </nav>
      <div className="ceremony-cue">
        <span data-testid="ceremony-phase">
          {step.phase === 'lineup'
            ? `${nameOf(room, step.team.memberId)} · ${step.team.overallScore.toFixed(1)} / 100`
            : phaseTitle}
        </span>
        <b data-testid="ceremony-counter">
          {index + 1} / {steps.length}
        </b>
      </div>
      <div
        className="ceremony-stage"
        key={stepKey}
        ref={activeStep}
        tabIndex={-1}
        aria-label={phaseTitle}
      >
        {step.phase === 'category' ? (
          <CategoryScene
            room={room}
            evaluation={evaluation}
            category={step.category}
            count={step.count}
          />
        ) : null}
        {step.phase === 'metric' ? (
          <MetricScene room={room} evaluation={evaluation} metric={step.metric} />
        ) : null}
        {step.phase === 'analysis' ? (
          <AnalysisScene room={room} evaluation={evaluation} team={step.team} />
        ) : null}
        {step.phase === 'verdict' ? (
          <div data-testid="ceremony-verdict" data-winner-id={champion?.memberId}>
            <Podium room={room} evaluation={evaluation} announce={false} />
          </div>
        ) : null}
        {step.phase === 'lineup' ? (
          <CeremonyLineup room={room} evaluation={evaluation} memberId={step.team.memberId} />
        ) : null}
      </div>
      <footer className="ceremony-controls">
        <progress ref={progress} max={1} value={0} aria-label="Current scene progress" />
        <div className="ceremony-controls__top">
          <span>
            <i />
            {paused
              ? 'PAUSED · TAKE YOUR TIME'
              : hidden
                ? 'PAUSED WHILE AWAY'
                : 'AUTO PLAY · VOICE FINISHES BEFORE THE NEXT SCENE'}
          </span>
          <label>
            PACE
            <select
              data-testid="ceremony-speed"
              aria-label="Ceremony pace"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={3}>3×</option>
            </select>
          </label>
        </div>
        <div className="ceremony-controls__buttons">
          <button
            data-testid="ceremony-previous"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            aria-label="Previous scene"
          >
            ← BACK
          </button>
          <button
            data-testid="ceremony-pause"
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? '▶ RESUME' : 'Ⅱ PAUSE'}
          </button>
          <button data-testid="ceremony-next" onClick={() => goTo(index + 1)}>
            {index === steps.length - 1 ? 'DASHBOARD ↗' : 'NEXT →'}
          </button>
          <button
            className="ceremony-controls__chapter"
            data-testid="ceremony-skip-chapter"
            onClick={() => goTo(nextCeremonyChapter(steps, index))}
          >
            {nextLabel} ↗
          </button>
          <button
            className="ceremony-controls__exit"
            data-testid="ceremony-finish"
            onClick={finish}
          >
            SKIP SHOW
          </button>
        </div>
      </footer>
    </section>
  );
}
