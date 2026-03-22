import { nanoid } from 'nanoid';

export type MatchHistoryRow = {
  playerId: string;
  nickname: string;
  totalBuyIn: number;
  finalStack: number;
  profit: number;
};

export type MatchHistoryRecord = {
  id: string;
  endedAt: number;
  roomId: string;
  rows: readonly MatchHistoryRow[];
};

const MAX_RECORDS = 100;

const records: MatchHistoryRecord[] = [];

export function pushMatchRecord(payload: {
  roomId: string;
  rows: readonly MatchHistoryRow[];
}): void {
  records.unshift({
    id: nanoid(10),
    endedAt: Date.now(),
    roomId: payload.roomId,
    rows: payload.rows.map((r) => ({ ...r })),
  });
  while (records.length > MAX_RECORDS) {
    records.pop();
  }
}

export function getRecentMatches(limit = 50): MatchHistoryRecord[] {
  return records.slice(0, Math.min(limit, records.length));
}
