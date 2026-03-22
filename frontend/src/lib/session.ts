import { getApiBase } from './apiBase';

export const SESSION_STORAGE_KEY = 'ray_poker_session';

export type PlayerSession = { playerId: string; authToken: string };

export function loadSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PlayerSession;
    if (typeof p?.playerId === 'string' && typeof p?.authToken === 'string') {
      return { playerId: p.playerId, authToken: p.authToken };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSession(s: PlayerSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function bootstrapSession(): Promise<PlayerSession> {
  const base = getApiBase();
  const r = await fetch(`${base}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error('BOOTSTRAP_FAILED');
  const j = (await r.json()) as { playerId?: string; authToken?: string };
  if (typeof j.playerId !== 'string' || typeof j.authToken !== 'string') {
    throw new Error('BOOTSTRAP_INVALID');
  }
  const s: PlayerSession = { playerId: j.playerId, authToken: j.authToken };
  saveSession(s);
  return s;
}

export async function ensureSession(): Promise<PlayerSession> {
  const existing = loadSession();
  if (existing) return existing;
  return bootstrapSession();
}
