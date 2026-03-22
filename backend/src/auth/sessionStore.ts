import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** 进程内会话：playerId -> authToken（重启清空） */
const sessions = new Map<string, string>();

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function createPlayerSession(): { playerId: string; authToken: string } {
  const playerId = randomUUID();
  const authToken = randomBytes(32).toString('hex');
  sessions.set(playerId, authToken);
  return { playerId, authToken };
}

export function verifyPlayerSession(playerId: string, authToken: string): boolean {
  const t = sessions.get(playerId);
  if (t === undefined) return false;
  return safeEqual(t, authToken);
}
