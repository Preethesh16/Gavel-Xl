import type { EvaluationView, TeamResultView } from '@gavel-xi/shared';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '../src/cache.js';
import {
  createOptionalNarrativeEnricher,
  GroqNarrativeEnricher,
  mergeEvaluationNarrative,
  withDeterministicAnalystReport,
} from '../src/narrative.js';

function team(memberId: string, rank: number, score: number): TeamResultView {
  return {
    memberId,
    rank,
    overallScore: score,
    categoryScores: { ATTACK: score, DEFENCE: score - 3 },
    metricWins: rank === 1 ? 10 : 5,
    categoryWins: rank === 1 ? 2 : 1,
    strengths: ['ATTACK', 'TACTICS'],
    weakness: 'DEFENCE',
    squadMarketValueEUR: 600_000_000,
    spentEUR: 500_000_000,
    remainingEUR: 250_000_000,
    auctionEfficiency: 80,
    leaguePoints: 90,
    knockoutRating: 82,
    finalRating: 81,
  };
}

function evaluation(): EvaluationView {
  return {
    metrics: [
      {
        index: 1,
        category: 'ATTACK',
        metric: 'Finishing',
        scores: { alpha: 91, beta: 82 },
        winnerIds: ['alpha'],
      },
    ],
    teams: [team('alpha', 1, 88), team('beta', 2, 81)],
    awards: [{ title: 'Draft Champion', memberId: 'alpha', detail: 'Top overall score: 88' }],
    headToHead: [
      {
        homeMemberId: 'alpha',
        awayMemberId: 'beta',
        homeGoals: 2,
        awayGoals: 1,
        explanation: 'ATTACK meets TACTICS.',
      },
    ],
    seed: 'revealed-seed',
    seedCommitment: 'commitment',
  };
}

const narrative = {
  teams: [
    {
      memberId: 'alpha',
      strengths: ['Ruthless movement between the lines', 'Calm control under pressure'],
      weakness: 'Can leave space behind adventurous full-backs',
    },
    {
      memberId: 'beta',
      strengths: ['Compact defensive distances', 'Direct counter-attacking threat'],
      weakness: 'Needs more invention against a settled block',
    },
  ],
  awards: [{ index: 0, detail: 'Alpha paired elite output with disciplined spending' }],
  headToHead: [
    {
      index: 0,
      explanation: 'Alpha controls the central spaces, while Beta remains dangerous in transition.',
    },
  ],
  report: {
    headline: 'Alpha wins the spaces that matter',
    opening: 'A narrow result decided by central control and cleaner work in the decisive phases.',
    teamVerdicts: [
      {
        memberId: 'alpha',
        verdict: 'Alpha built the more complete XI and controlled the central lane.',
        tacticalIdentity: 'Controlled possession with direct runners',
        decisiveEdge: 'Central overloads',
        concern: 'Space behind the full-backs',
      },
      {
        memberId: 'beta',
        verdict: 'Beta remained a threat in transition but lacked enough settled-possession craft.',
        tacticalIdentity: 'Compact counter-attacking block',
        decisiveEdge: 'Transition speed',
        concern: 'Low-block creativity',
      },
    ],
    categoryVerdicts: [{ index: 0, summary: 'Alpha carried the sharper final-third threat.' }],
    finalWhy: 'Alpha won because its attacking edge survived without sacrificing structure.',
    closingLine: 'One point on paper, one decisive tactical edge on the pitch.',
  },
};

function responseFor(value: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('optional Groq evaluation narrative', () => {
  it('always builds a complete deterministic analyst report without Groq', () => {
    const base = evaluation();
    const report = withDeterministicAnalystReport({
      roomCode: 'ABC234',
      members: [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ],
      evaluation: base,
      formation: '4-2-1-3',
      squads: [
        {
          memberId: 'alpha',
          player: 'Number Nine',
          position: 'ST',
          club: 'Alpha FC',
          priceEUR: 80_000_000,
          marketValueEUR: 90_000_000,
        },
      ],
    });

    expect(report.analystReport).toMatchObject({
      source: 'engine',
      winnerId: 'alpha',
      runnerUpId: 'beta',
      categoryVerdicts: [{ category: 'ATTACK', winnerIds: ['alpha'] }],
    });
    expect(report.analystReport?.teamVerdicts).toHaveLength(2);
    expect(report.analystReport?.teamVerdicts[0]?.verdict).toContain('Number Nine');
    expect(report.metrics).toEqual(base.metrics);
    expect(report.teams).toEqual(base.teams);
  });

  it('uses strict structured output, caches it and cannot change numerical authority', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return responseFor(narrative);
    });
    const base = evaluation();
    const enricher = new GroqNarrativeEnricher({
      apiKey: 'groq-test-key',
      cache: new InMemoryCache(),
      fetch: fetcher,
    });

    const first = await enricher.enrich({
      roomCode: 'ABC234',
      members: [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ],
      evaluation: base,
    });
    const second = await enricher.enrich({
      roomCode: 'ABC234',
      members: [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ],
      evaluation: base,
    });

    expect(requests).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first.teams[0]?.strengths[0]).toBe('Ruthless movement between the lines');
    expect(first.awards[0]?.detail).toContain('disciplined spending');
    expect(first.headToHead[0]?.explanation).toContain('central spaces');
    expect(first.analystReport).toMatchObject({
      source: 'groq',
      winnerId: 'alpha',
      runnerUpId: 'beta',
      headline: 'Alpha wins the spaces that matter',
      categoryVerdicts: [{ category: 'ATTACK', winnerIds: ['alpha'] }],
    });
    const request = JSON.parse(String(requests[0]?.init.body)) as {
      response_format: { json_schema: { strict: boolean; schema: object } };
    };
    expect(request.response_format.json_schema).toMatchObject({ strict: true });
    expect(request.response_format.json_schema.schema).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: 'Bearer groq-test-key',
    });

    const restored = structuredClone(first);
    restored.teams.forEach((result, index) => {
      result.strengths = [...base.teams[index]!.strengths];
      result.weakness = base.teams[index]!.weakness;
    });
    restored.awards.forEach((award, index) => {
      award.detail = base.awards[index]!.detail;
    });
    restored.headToHead.forEach((match, index) => {
      match.explanation = base.headToHead[index]!.explanation;
    });
    delete restored.analystReport;
    expect(restored).toEqual(base);
  });

  it('falls back exactly on invalid output or timeout and makes no call without a key', async () => {
    const base = evaluation();
    const fallback = withDeterministicAnalystReport({
      roomCode: 'ABC234',
      members: [],
      evaluation: base,
    });
    const invalid = new GroqNarrativeEnricher({
      apiKey: 'groq-test-key',
      cache: new InMemoryCache(),
      fetch: async () => responseFor({ ...narrative, teams: narrative.teams.slice(0, 1) }),
    });
    await expect(
      invalid.enrich({ roomCode: 'ABC234', members: [], evaluation: base }),
    ).resolves.toEqual(fallback);

    const timeout = new GroqNarrativeEnricher({
      apiKey: 'groq-test-key',
      cache: new InMemoryCache(),
      timeoutMs: 5,
      fetch: () => new Promise<Response>(() => undefined),
    });
    await expect(
      timeout.enrich({ roomCode: 'ABC234', members: [], evaluation: base }),
    ).resolves.toEqual(fallback);

    const neverFetch = vi.fn<typeof fetch>();
    expect(
      createOptionalNarrativeEnricher({ cache: new InMemoryCache(), fetch: neverFetch }),
    ).toBeUndefined();
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('rebuilds from authoritative results even if an injected enricher changes every number', () => {
    const base = withDeterministicAnalystReport({
      roomCode: 'ABC234',
      members: [],
      evaluation: evaluation(),
    });
    const hostile = structuredClone(base);
    hostile.metrics[0]!.scores.alpha = 0;
    hostile.teams[0]!.rank = 99;
    hostile.teams[0]!.overallScore = 0;
    hostile.headToHead[0]!.homeGoals = 99;
    hostile.seed = 'changed';
    hostile.teams[0]!.strengths = [...narrative.teams[0]!.strengths];
    hostile.teams[0]!.weakness = narrative.teams[0]!.weakness;

    const merged = mergeEvaluationNarrative(base, hostile);

    expect(merged.metrics).toEqual(base.metrics);
    expect(merged.teams[0]).toMatchObject({ rank: 1, overallScore: 88 });
    expect(merged.headToHead[0]).toMatchObject({ homeGoals: 2, awayGoals: 1 });
    expect(merged.seed).toBe(base.seed);
    expect(merged.teams[0]?.strengths).toEqual(narrative.teams[0]?.strengths);
    expect(merged.analystReport).toMatchObject({ winnerId: 'alpha', runnerUpId: 'beta' });
    expect(merged.analystReport?.categoryVerdicts[0]?.winnerIds).toEqual(['alpha']);
  });

  it('rebounds hostile report winners to the authoritative ranking and category scores', () => {
    const base = evaluation();
    const proposed = structuredClone(base);
    proposed.analystReport = {
      source: 'groq',
      headline: narrative.report.headline,
      opening: narrative.report.opening,
      teamVerdicts: narrative.report.teamVerdicts,
      categoryVerdicts: [
        {
          category: 'FAKE',
          winnerIds: ['beta'],
          summary: narrative.report.categoryVerdicts[0]!.summary,
        },
      ],
      winnerId: 'beta',
      runnerUpId: 'alpha',
      finalWhy: narrative.report.finalWhy,
      closingLine: narrative.report.closingLine,
    };

    const merged = mergeEvaluationNarrative(base, proposed);

    expect(merged.analystReport?.winnerId).toBe('alpha');
    expect(merged.analystReport?.runnerUpId).toBe('beta');
    expect(merged.analystReport?.categoryVerdicts).toEqual([
      expect.objectContaining({ category: 'ATTACK', winnerIds: ['alpha'] }),
    ]);
    expect(merged.teams).toEqual(base.teams);
    expect(merged.metrics).toEqual(base.metrics);
  });
});
