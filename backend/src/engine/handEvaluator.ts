import { createRequire } from 'node:module';
import type { Card } from '../types/poker.js';
import { Rank, Suit } from '../types/poker.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Hand } = require('pokersolver') as { Hand: typeof import('pokersolver').Hand };

/** pokersolver 牌面字符串，如 `Ah`, `Ts` */
export function cardToSolverString(card: Card): string {
  const rankChar =
    card.rank === Rank.Ten ? 'T' : card.rank === Rank.Jack ? 'J' : card.rank === Rank.Queen
      ? 'Q'
      : card.rank === Rank.King
        ? 'K'
        : card.rank === Rank.Ace
          ? 'A'
          : card.rank;

  const suitChar =
    card.suit === Suit.Spades
      ? 's'
      : card.suit === Suit.Hearts
        ? 'h'
        : card.suit === Suit.Diamonds
          ? 'd'
          : 'c';

  return `${rankChar}${suitChar}`;
}

function cardsToSolverStrings(cards: readonly Card[]): string[] {
  return cards.map(cardToSolverString);
}

/**
 * 从 2 张底牌 + 最多 5 张公共牌中求最佳 5 张成牌（标准德州成牌顺序）。
 */
export function solveHoldem(hole: readonly [Card, Card], board: readonly Card[]) {
  const seven = [...hole, ...board];
  if (seven.length < 5) {
    throw new Error('solveHoldem: need at least 5 cards (hole + board)');
  }
  return Hand.solve(cardsToSolverStrings(seven), 'standard');
}

export function winningPlayerIdsFromHands(
  entries: readonly { playerId: string; hand: import('pokersolver').Hand }[],
): string[] {
  if (entries.length === 0) return [];
  const hands = entries.map((e) => e.hand);
  const winners = Hand.winners(hands);
  const set = new Set(winners);
  return entries.filter((e) => set.has(e.hand)).map((e) => e.playerId);
}
