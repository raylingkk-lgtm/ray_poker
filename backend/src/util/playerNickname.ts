/** 与入座、改名共用：按 Unicode 码点截断，避免把代理对劈开 */
export const MAX_PLAYER_NICKNAME_CODEPOINTS = 32;

export function clipPlayerNickname(s: string): string {
  return [...s].slice(0, MAX_PLAYER_NICKNAME_CODEPOINTS).join('');
}

/** 入座：`sit_down` 可选昵称，空则回退为 `playerId`（截断） */
export function resolvedNicknameForSitDown(
  raw: string | undefined,
  playerId: string,
): string {
  const rawNick = raw?.trim();
  if (rawNick && rawNick.length > 0) {
    return clipPlayerNickname(rawNick);
  }
  return clipPlayerNickname(playerId);
}
