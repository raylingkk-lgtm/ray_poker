import { describe, expect, it } from 'vitest';
import {
  buildAscendingSidePots,
  PokerEngine,
  splitPotWithOddChips,
} from '../PokerEngine.js';
import { PlayerStatus, Rank, Suit } from '../../types/poker.js';
import type { Card, Player } from '../../types/poker.js';

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });

const royalBoard: Card[] = [
  c(Rank.Ace, Suit.Spades),
  c(Rank.King, Suit.Spades),
  c(Rank.Queen, Suit.Spades),
  c(Rank.Jack, Suit.Spades),
  c(Rank.Ten, Suit.Spades),
];

function player(id: string, stack: number, bet = 0, status = PlayerStatus.Alive): Player {
  return { id, nickname: id, stack, bet, status, seatIndex: 0 };
}

describe('buildAscendingSidePots', () => {
  it('升序切分：100 / 300 / 500 三层主池与边池', () => {
    const players: Player[] = [
      player('a', 0, 0),
      player('b', 0, 0),
      player('c', 0, 0),
    ];
    const contribs = new Map<string, number>([
      ['a', 100],
      ['b', 300],
      ['c', 500],
    ]);
    const pots = buildAscendingSidePots(players, contribs, () => true);
    expect(pots.map((p) => p.amount)).toEqual([300, 400, 200]);
    expect(pots.map((p) => p.level)).toEqual([0, 1, 2]);
    expect(pots[0]!.eligiblePlayers.sort()).toEqual(['a', 'b', 'c'].sort());
    expect(pots[1]!.eligiblePlayers.sort()).toEqual(['b', 'c'].sort());
    expect(pots[2]!.eligiblePlayers).toEqual(['c']);
  });

  it('弃牌玩家筹码留在池中但无资格分池', () => {
    const players: Player[] = [
      { ...player('a', 0), status: PlayerStatus.Folded },
      player('b', 0, 0),
      player('c', 0, 0),
    ];
    const contribs = new Map<string, number>([
      ['a', 100],
      ['b', 300],
      ['c', 500],
    ]);
    const pots = buildAscendingSidePots(players, contribs, (id) => {
      const p = players.find((x) => x.id === id);
      return !!p && p.status !== PlayerStatus.Folded;
    });
    expect(pots[0]!.eligiblePlayers.sort()).toEqual(['b', 'c'].sort());
    expect(pots[0]!.amount).toBe(300);
  });
});

describe('splitPotWithOddChips', () => {
  it('PRD §3.2：从 D 下一位顺时针，余数筹码依次多分 1', () => {
    const players: Player[] = [player('p0', 0), player('p1', 0), player('p2', 0)];
    const dealerIndex = 0;
    const shares = splitPotWithOddChips(7, ['p0', 'p1', 'p2'], players, dealerIndex);
    expect(shares.get('p0')).toBe(2);
    expect(shares.get('p1')).toBe(3);
    expect(shares.get('p2')).toBe(2);
  });

  it('仅胜者可得多出的筹码；多圈顺时针分配', () => {
    const players: Player[] = [
      player('p0', 0),
      player('p1', 0),
      player('p2', 0),
      player('p3', 0),
    ];
    const shares = splitPotWithOddChips(11, ['p0', 'p3'], players, 0);
    expect(shares.get('p0')).toBe(5);
    expect(shares.get('p3')).toBe(6);
  });
});

describe('PokerEngine.calculateSidePots', () => {
  it('与引擎内部 contribution 一致', () => {
    const engine = new PokerEngine();
    engine.hydrateShowdownState({
      players: [player('a', 1000), player('b', 1000), player('c', 1000)],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      communityCards: royalBoard,
      holeCards: new Map<string, readonly [Card, Card]>([
        ['a', [c(Rank.Two, Suit.Clubs), c(Rank.Three, Suit.Diamonds)]],
        ['b', [c(Rank.Two, Suit.Diamonds), c(Rank.Three, Suit.Hearts)]],
        ['c', [c(Rank.Two, Suit.Hearts), c(Rank.Three, Suit.Spades)]],
      ]),
      contributions: new Map([
        ['a', 100],
        ['b', 300],
        ['c', 500],
      ]),
    });
    const pots = engine.calculateSidePots();
    expect(pots.map((p) => p.amount)).toEqual([300, 400, 200]);
  });
});

describe('PokerEngine.movePlayerToSeat', () => {
  it('换座后庄家仍为同一玩家（按 id 校正下标）', () => {
    const engine = new PokerEngine({
      players: [
        { id: 'a', nickname: 'a', stack: 100, bet: 0, status: PlayerStatus.Alive, seatIndex: 0 },
        { id: 'b', nickname: 'b', stack: 100, bet: 0, status: PlayerStatus.Alive, seatIndex: 5 },
      ],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
    });
    engine.movePlayerToSeat('a', 9);
    const dealer = engine.getPlayers()[engine.getDealerIndex()];
    expect(dealer?.id).toBe('a');
    expect(engine.getPlayers().find((p) => p.id === 'a')?.seatIndex).toBe(9);
    expect(engine.getPlayers().find((p) => p.id === 'b')?.seatIndex).toBe(5);
  });
});

describe('PokerEngine.distributePot', () => {
  it('公共牌皇家同花顺平分时，主池与边池按牌力与奇数筹码规则分配', () => {
    const engine = new PokerEngine({
      players: [player('a', 900), player('b', 700), player('c', 500)],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
    });
    engine.hydrateShowdownState({
      players: [player('a', 900), player('b', 700), player('c', 500)],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      communityCards: royalBoard,
      holeCards: new Map<string, readonly [Card, Card]>([
        ['a', [c(Rank.Two, Suit.Clubs), c(Rank.Three, Suit.Diamonds)]],
        ['b', [c(Rank.Two, Suit.Diamonds), c(Rank.Three, Suit.Hearts)]],
        ['c', [c(Rank.Two, Suit.Hearts), c(Rank.Three, Suit.Spades)]],
      ]),
      contributions: new Map([
        ['a', 100],
        ['b', 300],
        ['c', 500],
      ]),
    });
    const awards = engine.distributePot();
    const byPlayer = new Map<string, number>();
    for (const a of awards) {
      byPlayer.set(a.playerId, (byPlayer.get(a.playerId) ?? 0) + a.amount);
    }
    expect(byPlayer.get('a')).toBe(100);
    expect(byPlayer.get('b')).toBe(300);
    expect(byPlayer.get('c')).toBe(500);
    expect(awards.reduce((s, x) => s + x.amount, 0)).toBe(900);
    const players = (engine as unknown as { players: Player[] }).players;
    expect(players.find((p) => p.id === 'a')!.stack).toBe(1000);
    expect(players.find((p) => p.id === 'b')!.stack).toBe(1000);
    expect(players.find((p) => p.id === 'c')!.stack).toBe(1000);
  });

  it('边池：主池最强牌拿走，中层边池由次强牌拿走，深层边池仅全下最深者竞争', () => {
    const board: Card[] = [
      c(Rank.Nine, Suit.Spades),
      c(Rank.Eight, Suit.Hearts),
      c(Rank.Seven, Suit.Diamonds),
      c(Rank.Two, Suit.Clubs),
      c(Rank.Three, Suit.Diamonds),
    ];
    const engine = new PokerEngine({ dealerIndex: 0, smallBlind: 1, bigBlind: 2 });
    engine.hydrateShowdownState({
      players: [player('short', 0), player('mid', 0), player('deep', 0)],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      communityCards: board,
      holeCards: new Map<string, readonly [Card, Card]>([
        ['short', [c(Rank.Six, Suit.Clubs), c(Rank.Five, Suit.Clubs)]],
        ['mid', [c(Rank.Ace, Suit.Clubs), c(Rank.King, Suit.Diamonds)]],
        ['deep', [c(Rank.Ace, Suit.Hearts), c(Rank.Queen, Suit.Hearts)]],
      ]),
      contributions: new Map([
        ['short', 50],
        ['mid', 150],
        ['deep', 200],
      ]),
    });
    const awards = engine.distributePot();
    const byPlayer = new Map<string, number>();
    for (const a of awards) {
      byPlayer.set(a.playerId, (byPlayer.get(a.playerId) ?? 0) + a.amount);
    }
    expect(byPlayer.get('short')).toBe(150);
    expect(byPlayer.get('mid')).toBe(200);
    expect(byPlayer.get('deep')).toBe(50);
  });
});
