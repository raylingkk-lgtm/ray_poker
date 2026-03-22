/** 与后端 `MAX_PLAYER_NICKNAME_CODEPOINTS` 对齐 */
export const MAX_PLAYER_NICKNAME_CODEPOINTS = 32;

const storageKey = (playerId: string) => `ray_poker_player_nickname:${playerId}`;

export function playerNicknameCodePointLength(s: string): number {
  return [...s].length;
}

export function clipPlayerNickname(s: string): string {
  return [...s].slice(0, MAX_PLAYER_NICKNAME_CODEPOINTS).join('');
}

export function getStoredPlayerNickname(playerId: string): string {
  try {
    const v = localStorage.getItem(storageKey(playerId));
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

export function setStoredPlayerNickname(playerId: string, nickname: string): void {
  try {
    localStorage.setItem(storageKey(playerId), nickname);
  } catch {
    /* ignore quota / private mode */
  }
}

/** 入座时传给服务端：有存储则返回截断后的非空串，否则 `undefined`（服务端用 playerId） */
export function nicknameForSitDownPayload(playerId: string): string | undefined {
  const trimmed = getStoredPlayerNickname(playerId).trim();
  if (!trimmed) return undefined;
  const clipped = clipPlayerNickname(trimmed);
  return clipped.length > 0 ? clipped : undefined;
}
