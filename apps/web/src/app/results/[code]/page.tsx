import type { RoomView } from '@gavel-xi/shared';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ResultsHub } from '@/components/results-hub';

export const dynamic = 'force-dynamic';

interface PublicResultResponse {
  room: RoomView;
}

async function loadResult(code: string): Promise<RoomView | null> {
  const serverUrl =
    process.env.SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://127.0.0.1:4000';
  try {
    const response = await fetch(
      `${serverUrl}/api/rooms/${encodeURIComponent(code.toUpperCase())}/results`,
      { cache: 'no-store' },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as PublicResultResponse;
    return payload.room.evaluation === null ? null : payload.room;
  } catch {
    return null;
  }
}

export default async function PublicResultsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = await loadResult(code);
  if (room === null) notFound();
  const viewer = room.members.find((member) => !member.isSpectator);
  if (viewer === undefined) notFound();

  return (
    <div className="public-results">
      <header className="public-results__header">
        <Brand compact />
        <div>
          <span>READ-ONLY RESULT</span>
          <strong>{room.code}</strong>
        </div>
      </header>
      <ResultsHub room={room} me={viewer} readOnly />
    </div>
  );
}
