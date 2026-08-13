export const dynamic = 'force-dynamic';

interface DataHealthReport {
  provider: string;
  connected: boolean;
  generatedAt: string;
  leagues: Array<{ id: string; name: string; season: string | null }>;
  teamsFound: number;
  activePlayersFound: number;
  managersFound: number;
  statsCoveragePercent: number;
  positionCoverage: Record<string, number>;
  valuationCoveragePercent: number;
  freshness: string | null;
  samplePlayers: Array<{ name: string; club: string; league: string; position: string }>;
  errors: string[];
}

async function reports(): Promise<DataHealthReport[]> {
  const serverUrl =
    process.env.SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://127.0.0.1:4000';
  try {
    const response = await fetch(`${serverUrl}/admin/data-health`, { cache: 'no-store' });
    if (!response.ok) return [];
    return ((await response.json()) as { reports?: DataHealthReport[] }).reports ?? [];
  } catch {
    return [];
  }
}

export default async function DataHealthPage() {
  const entries = await reports();
  return (
    <main className="data-health-page">
      <header>
        <p>DEVELOPMENT / ADMIN</p>
        <h1>Real data readiness</h1>
        <span>Only current-season league squads are eligible for a GAVEL XI room.</span>
      </header>
      {entries.length === 0 ? (
        <p className="data-health-error">Data-health endpoint is unavailable.</p>
      ) : null}
      {entries.map((report) => (
        <section key={report.provider} className="data-health-card">
          <h2>
            {report.provider} <em>{report.connected ? 'CONNECTED' : 'OFFLINE'}</em>
          </h2>
          <dl>
            <div>
              <dt>Current leagues</dt>
              <dd>{report.leagues.length}</dd>
            </div>
            <div>
              <dt>Teams</dt>
              <dd>{report.teamsFound}</dd>
            </div>
            <div>
              <dt>Active players</dt>
              <dd>{report.activePlayersFound}</dd>
            </div>
            <div>
              <dt>Current managers</dt>
              <dd>{report.managersFound}</dd>
            </div>
            <div>
              <dt>Stats coverage</dt>
              <dd>{report.statsCoveragePercent}%</dd>
            </div>
            <div>
              <dt>Valuation coverage</dt>
              <dd>{report.valuationCoveragePercent}%</dd>
            </div>
          </dl>
          <p className="data-health-leagues">
            {report.leagues
              .map((league) => `${league.name} (${league.season ?? 'no current season'})`)
              .join(' · ') || 'No requested major leagues accessible'}
          </p>
          <p className="data-health-positions">
            {Object.entries(report.positionCoverage)
              .map(([position, count]) => `${position}: ${count}`)
              .join(' · ') || 'No position coverage'}
          </p>
          {report.samplePlayers.length > 0 ? (
            <ul>
              {report.samplePlayers.map((player) => (
                <li key={`${player.name}-${player.club}`}>
                  {player.name} — {player.position}, {player.club} ({player.league})
                </li>
              ))}
            </ul>
          ) : null}
          {report.errors.map((error) => (
            <p className="data-health-error" key={error}>
              {error}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
