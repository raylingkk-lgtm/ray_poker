const MAX_CODEPOINTS = 10;

const PREFIXES = ['欢乐', '激战', '深夜', '朋友', '周末', '休闲'];
const SUFFIXES = ['牌局', '桌', '德州', '局', '房间'];

export function roomNameCodePointLength(s: string): number {
  return [...s].length;
}

export function clipRoomDisplayName(s: string): string {
  const chars = [...s];
  if (chars.length <= MAX_CODEPOINTS) return s;
  return chars.slice(0, MAX_CODEPOINTS).join('');
}

export function randomRoomDisplayName(): string {
  const a = PREFIXES[Math.floor(Math.random() * PREFIXES.length)]!;
  const b = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]!;
  const n = Math.floor(Math.random() * 9000) + 1000;
  return clipRoomDisplayName(`${a}${b}${n}`);
}
