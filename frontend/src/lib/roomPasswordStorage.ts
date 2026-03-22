const PREFIX = 'ray_poker_room_pwd_v1:';

export type StoredRoomPassword = {
  password: string;
  revision: number;
};

function key(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export function getStoredRoomPassword(roomId: string): StoredRoomPassword | null {
  try {
    const raw = localStorage.getItem(key(roomId));
    if (!raw) return null;
    const j = JSON.parse(raw) as { password?: string; revision?: number };
    if (typeof j.password !== 'string' || typeof j.revision !== 'number') return null;
    return { password: j.password, revision: j.revision };
  } catch {
    return null;
  }
}

export function setStoredRoomPassword(
  roomId: string,
  password: string,
  revision: number,
): void {
  try {
    localStorage.setItem(
      key(roomId),
      JSON.stringify({ password, revision }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearStoredRoomPassword(roomId: string): void {
  try {
    localStorage.removeItem(key(roomId));
  } catch {
    /* ignore */
  }
}
