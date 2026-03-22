import { describe, expect, it } from 'vitest';
import {
  sanitizeGameState,
  type EngineGameStateSnapshot,
} from '../interfaces.js';
import { GameState, PlayerStatus, Rank, Suit } from '../../types/poker.js';

const holeA = [
  { rank: Rank.Ace, suit: Suit.Spades },
  { rank: Rank.Ace, suit: Suit.Hearts },
] as const;
const holeB = [
  { rank: Rank.King, suit: Suit.Spades },
  { rank: Rank.King, suit: Suit.Hearts },
] as const;

function baseSnapshot(phase: GameState): EngineGameStateSnapshot {
  return {
    roomId: 'r1',
    gameState: phase,
    communityCards: [],
    pots: [],
    dealerIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    currentTurnPlayerId: 'a',
    currentHighestBet: 0,
    minRaiseTo: 2,
    hostPlayerId: 'host',
    pendingBuyIns: [],
    lastHandSettlement: null,
    players: [
      {
        id: 'a',
        nickname: 'A',
        stack: 100,
        bet: 0,
        status: PlayerStatus.Alive,
        seatIndex: 0,
        holeCards: holeA,
      },
      {
        id: 'b',
        nickname: 'B',
        stack: 100,
        bet: 0,
        status: PlayerStatus.Alive,
        seatIndex: 1,
        holeCards: holeB,
      },
    ],
  };
}

describe('sanitizeGameState', () => {
  it('非 SHOWDOWN：仅本人可见底牌', () => {
    const raw = baseSnapshot(GameState.Flop);
    const forA = sanitizeGameState(raw, 'a');
    expect(forA.players[0]!.holeCards).not.toBeNull();
    expect(forA.players[1]!.holeCards).toBeNull();
    const forB = sanitizeGameState(raw, 'b');
    expect(forB.players[0]!.holeCards).toBeNull();
    expect(forB.players[1]!.holeCards).not.toBeNull();
  });

  it('SHOWDOWN：未弃牌玩家互相可见底牌', () => {
    const raw = baseSnapshot(GameState.Showdown);
    const forA = sanitizeGameState(raw, 'a');
    expect(forA.players[0]!.holeCards).not.toBeNull();
    expect(forA.players[1]!.holeCards).not.toBeNull();
  });

  it('SHOWDOWN：已弃牌玩家底牌不下发', () => {
    const raw = baseSnapshot(GameState.Showdown);
    raw.players[1]!.status = PlayerStatus.Folded;
    const forA = sanitizeGameState(raw, 'a');
    expect(forA.players[1]!.holeCards).toBeNull();
  });

  it('pendingBuyIns：仅房主可见', () => {
    const raw = baseSnapshot(GameState.Flop);
    raw.pendingBuyIns = [
      { id: 'r1', playerId: 'b', amount: 500, requestedAt: 1 },
    ];
    raw.hostPlayerId = 'host';
    const forHost = sanitizeGameState(raw, 'host');
    expect(forHost.pendingBuyIns).toHaveLength(1);
    const forGuest = sanitizeGameState(raw, 'a');
    expect(forGuest.pendingBuyIns).toHaveLength(0);
  });
});
