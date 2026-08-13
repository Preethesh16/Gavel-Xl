const SESSION_KEY = 'gavel-xi:session';

export interface StoredSession {
  sessionToken: string;
  memberId: string;
  roomCode: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sessionToken' in parsed &&
      'memberId' in parsed &&
      'roomCode' in parsed &&
      typeof parsed.sessionToken === 'string' &&
      typeof parsed.memberId === 'string' &&
      typeof parsed.roomCode === 'string'
    ) {
      return parsed as StoredSession;
    }
  } catch {
    // Storage can be disabled in privacy mode. The current socket session still works.
  }
  return null;
}

export function saveSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // A non-persistent session is still usable.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing else to clear.
  }
}
