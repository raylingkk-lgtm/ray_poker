import type { PokerGamePhase } from '../types/game';

const PHASE_LABELS: Record<PokerGamePhase, string> = {
  IDLE: '未开局',
  PRE_FLOP: 'Pre-flop',
  FLOP: 'Flop',
  TURN: 'Turn',
  RIVER: 'River',
  SHOWDOWN: '摊牌',
  FINAL_HAND: '最后一手',
};

export function formatGamePhase(phase: string): string {
  return PHASE_LABELS[phase as PokerGamePhase] ?? phase;
}

export function totalPotAmount(
  pots: ReadonlyArray<{ amount: number }> | undefined,
): number {
  if (!pots?.length) return 0;
  return pots.reduce((s, p) => s + p.amount, 0);
}
