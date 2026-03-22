import type { Card, Player, Pot, PotAward } from '../types/poker.js';
import { ActionType, GameState, PlayerStatus, Rank, Suit } from '../types/poker.js';
import { solveHoldem, winningPlayerIdsFromHands } from './handEvaluator.js';

type ContributionMap = ReadonlyMap<string, number>;

const MAX_TABLE_SEATS = 10;

/** 升序切分法：由低到高逐层剥离，生成主池 + 边池（PRD §3.6） */
export function buildAscendingSidePots(
  seatOrderedPlayers: readonly Player[],
  contributions: ContributionMap,
  isEligibleForPot: (playerId: string) => boolean,
): Pot[] {
  const entries: { id: string; total: number }[] = [];
  for (const p of seatOrderedPlayers) {
    if (p.status === PlayerStatus.SittingOut) continue;
    const total = contributions.get(p.id) ?? 0;
    if (total > 0) entries.push({ id: p.id, total });
  }
  if (entries.length === 0) return [];

  const uniqueCaps = [...new Set(entries.map((e) => e.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  let level = 0;

  for (const cap of uniqueCaps) {
    const height = cap - prev;
    if (height <= 0) {
      prev = cap;
      continue;
    }

    let amount = 0;
    for (const e of entries) {
      const pay = Math.min(Math.max(0, e.total - prev), height);
      amount += pay;
    }

    const eligiblePlayers = entries
      .filter((e) => e.total >= cap && isEligibleForPot(e.id))
      .map((e) => e.id);

    pots.push({ amount, eligiblePlayers, level });
    level++;
    prev = cap;
  }

  return pots;
}

/**
 * PRD §3.2：余数筹码从庄家下一位起顺时针，每名胜者最多多分 1，直到分完。
 * `seatOrderedPlayers` 为座位顺时针顺序；`dealerIndex` 指向 D 位在该数组中的下标。
 */
export function splitPotWithOddChips(
  potAmount: number,
  winnerIds: readonly string[],
  seatOrderedPlayers: readonly Player[],
  dealerIndex: number,
): Map<string, number> {
  const winnerSet = new Set(winnerIds);
  const k = winnerIds.length;
  if (k === 0) return new Map();
  const base = Math.floor(potAmount / k);
  let remainder = potAmount % k;
  const share = new Map<string, number>();
  for (const id of winnerIds) {
    share.set(id, base);
  }

  const n = seatOrderedPlayers.length;
  for (let step = 1; step <= n && remainder > 0; step++) {
    const idx = (dealerIndex + step) % n;
    const pid = seatOrderedPlayers[idx]!.id;
    if (!winnerSet.has(pid)) continue;
    share.set(pid, (share.get(pid) ?? 0) + 1);
    remainder--;
  }

  return share;
}

function buildFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of Object.values(Suit)) {
    for (const rank of Object.values(Rank)) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function sbBbIndices(numPlayers: number, dealerIndex: number): { sb: number; bb: number } {
  if (numPlayers < 2) throw new Error('PokerEngine: need at least 2 players');
  if (numPlayers === 2) {
    return { sb: dealerIndex, bb: (dealerIndex + 1) % numPlayers };
  }
  return {
    sb: (dealerIndex + 1) % numPlayers,
    bb: (dealerIndex + 2) % numPlayers,
  };
}

function nextActiveIndex(players: Player[], from: number): number {
  const n = players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = players[i]!;
    if (p.status === PlayerStatus.Alive || p.status === PlayerStatus.AllIn) {
      return i;
    }
  }
  return from;
}

function countContenders(players: Player[]): number {
  return players.filter((p) => p.status === PlayerStatus.Alive || p.status === PlayerStatus.AllIn).length;
}

/**
 * 德州扑克牌局核心引擎。
 */
export class PokerEngine {
  private deck: Card[] = [];
  private communityCards: Card[] = [];
  private players: Player[] = [];
  private currentTurnIndex = 0;
  private dealerIndex = 0;
  private currentHighestBet = 0;
  private smallBlind = 0;
  private bigBlind = 0;
  private gameState: GameState = GameState.Idle;
  private pots: Pot[] = [];
  private holeCardsByPlayerId = new Map<string, readonly [Card, Card]>();
  /** 本手累计投入（用于边池） */
  private handContributionByPlayerId = new Map<string, number>();
  /** 当前街每条街下注累计（用于跟注差额） */
  private streetBetByPlayerId = new Map<string, number>();
  private lastAggressorIndex: number | null = null;
  private bettingRoundStartIndex: number | null = null;
  /** 本轮自最后一次加注以来已完成表态的玩家（不含仅下盲注） */
  private actedSinceLastRaise = new Set<string>();

  constructor(opts?: {
    players?: Player[];
    dealerIndex?: number;
    smallBlind?: number;
    bigBlind?: number;
  }) {
    if (opts?.players) {
      this.players = opts.players.map((p) => ({ ...p }));
      this.normalizeSeatOrdering();
    }
    if (opts?.dealerIndex !== undefined) this.dealerIndex = opts.dealerIndex;
    if (opts?.smallBlind !== undefined) this.smallBlind = opts.smallBlind;
    if (opts?.bigBlind !== undefined) this.bigBlind = opts.bigBlind;
  }

  /**
   * 注入摊牌结算所需快照（重连、测试、或跳过完整下注链时使用）。
   */
  hydrateShowdownState(args: {
    players: Player[];
    dealerIndex: number;
    smallBlind: number;
    bigBlind: number;
    communityCards: Card[];
    holeCards: ReadonlyMap<string, readonly [Card, Card]>;
    contributions: ReadonlyMap<string, number>;
  }): void {
    this.players = args.players.map((p) => ({ ...p }));
    this.dealerIndex = args.dealerIndex;
    this.smallBlind = args.smallBlind;
    this.bigBlind = args.bigBlind;
    this.communityCards = [...args.communityCards];
    this.holeCardsByPlayerId = new Map(args.holeCards);
    this.handContributionByPlayerId = new Map(args.contributions);
    this.streetBetByPlayerId.clear();
    this.currentHighestBet = 0;
    this.pots = [];
    this.deck = [];
    this.gameState = GameState.Showdown;
    this.lastAggressorIndex = null;
    this.bettingRoundStartIndex = null;
    this.actedSinceLastRaise.clear();
    this.normalizeSeatOrdering();
  }

  private sortPlayersBySeat(): void {
    this.players.sort((a, b) => a.seatIndex - b.seatIndex);
  }

  /**
   * 保证每人有合法且互异的 `seatIndex`（0..MAX-1），并按座位排序。
   * 缺省、越界或冲突时按当前数组顺序分配 0..n-1。
   */
  private normalizeSeatOrdering(): void {
    const n = this.players.length;
    if (n === 0) return;
    const seats = this.players.map((p) => p.seatIndex);
    const valid = seats.every(
      (s) =>
        typeof s === 'number' &&
        Number.isInteger(s) &&
        s >= 0 &&
        s < MAX_TABLE_SEATS,
    );
    const uniq = new Set(seats);
    if (valid && uniq.size === n) {
      this.sortPlayersBySeat();
      return;
    }
    this.players.forEach((p, i) => {
      p.seatIndex = i;
    });
    this.sortPlayersBySeat();
  }

  private captureSeatIndexSnapshot(): {
    dealerId: string | null;
    turnId: string | null;
    lagId: string | null;
    brId: string | null;
  } {
    return {
      dealerId: this.players[this.dealerIndex]?.id ?? null,
      turnId: this.getCurrentTurnPlayerId(),
      lagId:
        this.lastAggressorIndex != null
          ? (this.players[this.lastAggressorIndex]?.id ?? null)
          : null,
      brId:
        this.bettingRoundStartIndex != null
          ? (this.players[this.bettingRoundStartIndex]?.id ?? null)
          : null,
    };
  }

  private applySeatIndexSnapshot(s: {
    dealerId: string | null;
    turnId: string | null;
    lagId: string | null;
    brId: string | null;
  }): void {
    if (s.dealerId) {
      const i = this.players.findIndex((p) => p.id === s.dealerId);
      if (i >= 0) this.dealerIndex = i;
    }
    if (s.turnId) {
      const i = this.players.findIndex((p) => p.id === s.turnId);
      if (i >= 0) this.currentTurnIndex = i;
    }
    if (s.lagId) {
      const i = this.players.findIndex((p) => p.id === s.lagId);
      this.lastAggressorIndex = i >= 0 ? i : null;
    } else {
      this.lastAggressorIndex = null;
    }
    if (s.brId) {
      const i = this.players.findIndex((p) => p.id === s.brId);
      this.bettingRoundStartIndex = i >= 0 ? i : null;
    } else {
      this.bettingRoundStartIndex = null;
    }
  }

  private getHandContribution(playerId: string): number {
    return this.handContributionByPlayerId.get(playerId) ?? 0;
  }

  private addHandContribution(playerId: string, delta: number): void {
    if (delta <= 0) return;
    const next = this.getHandContribution(playerId) + delta;
    this.handContributionByPlayerId.set(playerId, next);
  }

  private getStreetBet(playerId: string): number {
    return this.streetBetByPlayerId.get(playerId) ?? 0;
  }

  private setStreetBet(playerId: string, value: number): void {
    this.streetBetByPlayerId.set(playerId, value);
    const p = this.players.find((x) => x.id === playerId);
    if (p) p.bet = value;
  }

  private firstActiveFrom(start: number): number {
    const n = this.players.length;
    for (let s = 0; s < n; s++) {
      const i = (start + s) % n;
      const p = this.players[i]!;
      if (p.status === PlayerStatus.SittingOut) continue;
      if (p.stack <= 0) continue;
      return i;
    }
    throw new Error('PokerEngine: no active seat for blind');
  }

  private postBlind(playerIndex: number, blindAmount: number): void {
    const p = this.players[playerIndex]!;
    if (p.status === PlayerStatus.SittingOut) return;
    const pay = Math.min(p.stack, blindAmount);
    p.stack -= pay;
    this.addHandContribution(p.id, pay);
    const street = this.getStreetBet(p.id) + pay;
    this.setStreetBet(p.id, street);
    if (pay < blindAmount && p.stack === 0) {
      p.status = PlayerStatus.AllIn;
    }
  }

  dealPreFlop(): void {
    const inHand = this.players.filter((p) => p.status !== PlayerStatus.SittingOut);
    if (inHand.length < 2) {
      throw new Error('PokerEngine.dealPreFlop: need at least 2 seated players');
    }

    this.communityCards = [];
    this.pots = [];
    this.handContributionByPlayerId.clear();
    this.streetBetByPlayerId.clear();
    this.holeCardsByPlayerId.clear();
    this.lastAggressorIndex = null;
    this.currentHighestBet = 0;
    this.actedSinceLastRaise.clear();

    for (const p of this.players) {
      if (p.status === PlayerStatus.SittingOut) continue;
      p.bet = 0;
      if (p.stack > 0) {
        p.status = PlayerStatus.Alive;
      } else {
        // 上一手可能为 AllIn；0 筹码本手不参与，避免仍被算进争池/行动位指向无手牌玩家导致分池异常或死循环
        p.status = PlayerStatus.Folded;
      }
    }

    const deck = buildFullDeck();
    shuffleInPlace(deck);
    this.deck = deck;

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (p.status === PlayerStatus.SittingOut || p.stack <= 0) continue;
      const c1 = this.deck.pop();
      const c2 = this.deck.pop();
      if (!c1 || !c2) throw new Error('PokerEngine.dealPreFlop: deck exhausted');
      this.holeCardsByPlayerId.set(p.id, [c1, c2]);
    }

    const activeSeatCount = this.players.filter(
      (p) => p.status !== PlayerStatus.SittingOut && p.stack > 0,
    ).length;
    if (activeSeatCount < 2) throw new Error('PokerEngine.dealPreFlop: not enough active seats');

    let sb: number;
    let bb: number;
    if (activeSeatCount === 2) {
      ({ sb, bb } = sbBbIndices(this.players.length, this.dealerIndex));
    } else {
      sb = this.firstActiveFrom(this.dealerIndex + 1);
      bb = this.firstActiveFrom(sb + 1);
    }
    this.postBlind(sb, this.smallBlind);
    this.postBlind(bb, this.bigBlind);
    this.currentHighestBet = Math.max(
      this.getStreetBet(this.players[sb]!.id),
      this.getStreetBet(this.players[bb]!.id),
    );

    this.gameState = GameState.PreFlop;
    this.bettingRoundStartIndex = this.firstPreflopActingIndex(bb);
    this.currentTurnIndex = this.bettingRoundStartIndex;

    // 全员已下盲即全下等：无待表态位时连续推进至发完公共牌或进入下一街
    for (let guard = 0; guard < 8; guard++) {
      if (this.getGameState() === GameState.Showdown) break;
      if (!this.isBettingRoundComplete()) break;
      this.advanceAfterBettingRound();
    }
  }

  /** 第一手行动位：须已发底牌且仍可表态（跳过上手遗留的 AllIn / 无筹码位） */
  private firstPreflopActingIndex(bbIndex: number): number {
    const n = this.players.length;
    const utg = (bbIndex + 1) % n;
    for (let k = 0; k < n; k++) {
      const i = (utg + k) % n;
      const p = this.players[i]!;
      if (p.status === PlayerStatus.SittingOut || p.status === PlayerStatus.Folded) continue;
      if (!this.holeCardsByPlayerId.has(p.id)) continue;
      if (p.status === PlayerStatus.AllIn) continue;
      return i;
    }
    return utg;
  }

  processAction(playerId: string, actionType: ActionType, amount: number): void {
    if (this.gameState === GameState.Idle) {
      throw new Error('PokerEngine.processAction: no hand in progress');
    }
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx < 0) throw new Error('PokerEngine.processAction: unknown player');
    if (idx !== this.currentTurnIndex) {
      throw new Error('PokerEngine.processAction: not this player turn');
    }

    const p = this.players[idx]!;
    if (p.status === PlayerStatus.Folded || p.status === PlayerStatus.SittingOut) {
      throw new Error('PokerEngine.processAction: player cannot act');
    }

    const toCall = Math.max(0, this.currentHighestBet - this.getStreetBet(p.id));
    const previousHighestBet = this.currentHighestBet;

    switch (actionType) {
      case ActionType.Fold: {
        p.status = PlayerStatus.Folded;
        break;
      }
      case ActionType.Check: {
        if (toCall > 0) throw new Error('PokerEngine.processAction: illegal check');
        break;
      }
      case ActionType.Call: {
        const pay = Math.min(p.stack, toCall);
        p.stack -= pay;
        this.addHandContribution(p.id, pay);
        this.setStreetBet(p.id, this.getStreetBet(p.id) + pay);
        if (p.stack === 0) p.status = PlayerStatus.AllIn;
        break;
      }
      case ActionType.Bet: {
        if (this.currentHighestBet > 0) throw new Error('PokerEngine.processAction: bet illegal when facing bet');
        if (amount < this.bigBlind) {
          throw new Error('PokerEngine.processAction: bet below big blind');
        }
        const pay = Math.min(p.stack, amount);
        p.stack -= pay;
        this.addHandContribution(p.id, pay);
        this.setStreetBet(p.id, this.getStreetBet(p.id) + pay);
        this.currentHighestBet = this.getStreetBet(p.id);
        this.lastAggressorIndex = idx;
        if (p.stack === 0) p.status = PlayerStatus.AllIn;
        break;
      }
      case ActionType.Raise: {
        if (amount <= this.currentHighestBet) {
          throw new Error('PokerEngine.processAction: raise must exceed current highest');
        }
        const target = amount;
        const needTotalOnStreet = target;
        const currentStreet = this.getStreetBet(p.id);
        const add = Math.min(p.stack, needTotalOnStreet - currentStreet);
        p.stack -= add;
        this.addHandContribution(p.id, add);
        this.setStreetBet(p.id, currentStreet + add);
        if (this.getStreetBet(p.id) > this.currentHighestBet) {
          this.currentHighestBet = this.getStreetBet(p.id);
          this.lastAggressorIndex = idx;
        }
        if (p.stack === 0) p.status = PlayerStatus.AllIn;
        break;
      }
      case ActionType.AllIn: {
        const all = p.stack;
        p.stack = 0;
        this.addHandContribution(p.id, all);
        const newStreet = this.getStreetBet(p.id) + all;
        this.setStreetBet(p.id, newStreet);
        if (newStreet > this.currentHighestBet) {
          this.currentHighestBet = newStreet;
          this.lastAggressorIndex = idx;
        }
        p.status = PlayerStatus.AllIn;
        break;
      }
      default:
        throw new Error('PokerEngine.processAction: unsupported action');
    }

    const reopenedAction =
      actionType === ActionType.Bet ||
      actionType === ActionType.Raise ||
      (actionType === ActionType.AllIn && this.currentHighestBet > previousHighestBet);

    if (reopenedAction) {
      this.actedSinceLastRaise.clear();
      this.actedSinceLastRaise.add(playerId);
    } else {
      this.actedSinceLastRaise.add(playerId);
    }

    if (countContenders(this.players) <= 1) {
      this.gameState = GameState.Showdown;
      return;
    }

    if (this.isBettingRoundComplete()) {
      this.advanceAfterBettingRound();
      return;
    }

    this.currentTurnIndex = nextActorIndexFrom(this.players, idx);
  }

  private allMatchedStreets(): boolean {
    const need = this.currentHighestBet;
    for (const p of this.players) {
      if (p.status === PlayerStatus.Folded || p.status === PlayerStatus.SittingOut) continue;
      if (p.status === PlayerStatus.AllIn) continue;
      if (p.status === PlayerStatus.Alive && this.getStreetBet(p.id) < need) return false;
    }
    return true;
  }

  private isBettingRoundComplete(): boolean {
    if (!this.allMatchedStreets()) return false;
    const alive = this.players.filter((p) => p.status === PlayerStatus.Alive);
    for (const p of alive) {
      if (!this.actedSinceLastRaise.has(p.id)) return false;
    }
    return true;
  }

  private advanceAfterBettingRound(): void {
    this.actedSinceLastRaise.clear();
    for (const p of this.players) {
      p.bet = 0;
    }
    this.streetBetByPlayerId.clear();
    this.currentHighestBet = 0;
    this.lastAggressorIndex = null;

    if (this.gameState === GameState.PreFlop) {
      this.dealStreet(3);
      this.gameState = GameState.Flop;
    } else if (this.gameState === GameState.Flop) {
      this.dealStreet(1);
      this.gameState = GameState.Turn;
    } else if (this.gameState === GameState.Turn) {
      this.dealStreet(1);
      this.gameState = GameState.River;
    } else if (this.gameState === GameState.River) {
      this.gameState = GameState.Showdown;
      return;
    }

    this.maybeRunOutBoard();

    if (this.gameState === GameState.Showdown) {
      return;
    }

    this.bettingRoundStartIndex = nextActiveIndex(this.players, this.dealerIndex);
    this.currentTurnIndex = this.bettingRoundStartIndex;
  }

  /** 所有未弃牌者均已全下且无人在位可继续下注时，一次性发完公共牌至河牌。 */
  private maybeRunOutBoard(): void {
    if (countContenders(this.players) < 2) return;
    const anyAlive = this.players.some((p) => p.status === PlayerStatus.Alive);
    if (anyAlive) return;

    while (this.communityCards.length < 5) {
      if (this.gameState === GameState.PreFlop) {
        this.dealStreet(3);
        this.gameState = GameState.Flop;
      } else if (this.gameState === GameState.Flop) {
        this.dealStreet(1);
        this.gameState = GameState.Turn;
      } else if (this.gameState === GameState.Turn) {
        this.dealStreet(1);
        this.gameState = GameState.River;
      } else if (this.gameState === GameState.River) {
        this.dealStreet(1);
        break;
      }
    }
    this.gameState = GameState.Showdown;
  }

  private dealStreet(count: number): void {
    for (let c = 0; c < count; c++) {
      const card = this.deck.pop();
      if (!card) throw new Error('PokerEngine.dealStreet: deck exhausted');
      this.communityCards.push(card);
    }
  }

  calculateSidePots(): Pot[] {
    const pots = buildAscendingSidePots(
      this.players,
      this.handContributionByPlayerId,
      (playerId) => {
        const pl = this.players.find((x) => x.id === playerId);
        return (
          !!pl &&
          pl.status !== PlayerStatus.Folded &&
          pl.status !== PlayerStatus.SittingOut
        );
      },
    );
    this.pots = pots;
    return pots.map((p) => ({ ...p }));
  }

  distributePot(): PotAward[] {
    // 必须与当前 handContribution 一致：上一拍 buildEngineSnapshot 可能已写入旧 this.pots，
    // 最后一笔行动后先 settle 再广播，若此处不复算会用陈旧边池导致分池偏小、吞筹码。
    this.calculateSidePots();

    const awards: PotAward[] = [];
    let deadPotTotal = 0;

    for (const pot of this.pots) {
      if (pot.amount <= 0) continue;

      const activeEligible = pot.eligiblePlayers.filter((id) => {
        const pl = this.players.find((x) => x.id === id);
        return pl && pl.status !== PlayerStatus.Folded && pl.status !== PlayerStatus.SittingOut;
      });

      if (activeEligible.length === 0) {
        deadPotTotal += pot.amount;
        continue;
      }

      if (activeEligible.length === 1) {
        const winner = activeEligible[0]!;
        awards.push({ playerId: winner, potLevel: pot.level, amount: pot.amount });
        const wp = this.players.find((x) => x.id === winner);
        if (wp) wp.stack += pot.amount;
        continue;
      }

      if (this.communityCards.length < 5) {
        throw new Error('PokerEngine.distributePot: need 5 board cards for multi-way showdown');
      }

      const solved = activeEligible
        .map((id) => {
          const hole = this.holeCardsByPlayerId.get(id);
          if (!hole) throw new Error(`PokerEngine.distributePot: missing hole cards for ${id}`);
          return { playerId: id, hand: solveHoldem(hole, this.communityCards) };
        });

      const winnerIds = winningPlayerIdsFromHands(solved);
      if (winnerIds.length === 0) {
        throw new Error('PokerEngine.distributePot: no winner after showdown (tie detection bug?)');
      }

      const shares = splitPotWithOddChips(
        pot.amount,
        winnerIds,
        this.players,
        this.dealerIndex,
      );

      for (const [pid, amt] of shares) {
        if (amt > 0) {
          awards.push({ playerId: pid, potLevel: pot.level, amount: amt });
          const pl = this.players.find((x) => x.id === pid);
          if (pl) pl.stack += amt;
        }
      }
    }

    const potGrandTotal = this.pots.reduce((s, p) => s + p.amount, 0);
    const awardTotal = awards.reduce((s, a) => s + a.amount, 0);
    if (awardTotal + deadPotTotal !== potGrandTotal) {
      throw new Error(
        `PokerEngine.distributePot: chips not conserved (awards ${awardTotal}, dead ${deadPotTotal}, pots ${potGrandTotal})`,
      );
    }

    return awards;
  }

  getGameState(): GameState {
    return this.gameState;
  }

  getPlayers(): Player[] {
    return this.players.map((p) => ({ ...p }));
  }

  getCommunityCards(): Card[] {
    return [...this.communityCards];
  }

  getPots(): Pot[] {
    return this.pots.map((p) => ({
      amount: p.amount,
      eligiblePlayers: [...p.eligiblePlayers],
      level: p.level,
    }));
  }

  getDealerIndex(): number {
    return this.dealerIndex;
  }

  getSmallBlind(): number {
    return this.smallBlind;
  }

  getBigBlind(): number {
    return this.bigBlind;
  }

  /** 当前街最高已下注额（对齐 `player.bet` 本条街累计） */
  getCurrentHighestBet(): number {
    return this.currentHighestBet;
  }

  /**
   * 合法加注后的本街总注下限（目标总注额，供 UI 与 `Raise` 的 `amount` 对齐）。
   * 无面对注时开池请用 `Bet`，最小为一个大盲。
   */
  getMinRaiseTargetTotal(): number {
    const h = this.currentHighestBet;
    const bb = this.bigBlind;
    if (h === 0) return bb;
    return Math.max(h + bb, h * 2);
  }

  /**
   * 当前轮到表态的玩家（Alive）。Showdown / FinalHand / 全下无需再动筹码时为 null。
   */
  getCurrentTurnPlayerId(): string | null {
    if (
      this.gameState === GameState.Idle ||
      this.gameState === GameState.Showdown ||
      this.gameState === GameState.FinalHand
    ) {
      return null;
    }
    const p = this.players[this.currentTurnIndex];
    if (!p) return null;
    if (p.status === PlayerStatus.Folded || p.status === PlayerStatus.SittingOut) return null;
    if (p.status === PlayerStatus.AllIn) return null;
    return p.id;
  }

  getHoleCardsForPlayer(playerId: string): readonly [Card, Card] | undefined {
    const h = this.holeCardsByPlayerId.get(playerId);
    return h ? [h[0], h[1]] : undefined;
  }

  /** PRD §3.3：可否 Check（当前最高注等于本街已投入） */
  canPlayerCheckNow(playerId: string): boolean {
    const idx = this.players.findIndex((x) => x.id === playerId);
    if (idx !== this.currentTurnIndex) return false;
    const p = this.players[idx]!;
    if (p.status !== PlayerStatus.Alive) return false;
    const toCall = Math.max(0, this.currentHighestBet - this.getStreetBet(p.id));
    return toCall === 0;
  }

  isPlayerAllIn(playerId: string): boolean {
    return this.players.some((x) => x.id === playerId && x.status === PlayerStatus.AllIn);
  }

  /** 新一手发牌前移动庄家按钮（顺时针） */
  rotateDealerForNextHand(): void {
    const n = this.players.length;
    if (n === 0) return;
    this.dealerIndex = (this.dealerIndex + 1) % n;
  }

  setGameState(state: GameState): void {
    this.gameState = state;
  }

  addToPlayerStack(playerId: string, delta: number): void {
    if (delta <= 0) return;
    const p = this.players.find((x) => x.id === playerId);
    if (p) p.stack += delta;
  }

  /** 仅更新展示昵称；不改变牌局状态机 */
  setPlayerNickname(playerId: string, nickname: string): boolean {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return false;
    p.nickname = nickname;
    return true;
  }

  /** 新玩家入座指定物理座位（0..9），按座位排序并校正庄家 / 行动位下标 */
  addPlayerAtSeat(player: Player, seat: number): void {
    if (seat < 0 || seat >= MAX_TABLE_SEATS) {
      throw new Error('PokerEngine: seat index out of range');
    }
    if (this.players.length >= MAX_TABLE_SEATS) {
      throw new Error('PokerEngine: table full');
    }
    if (this.players.some((p) => p.id === player.id)) {
      throw new Error('PokerEngine: player already seated');
    }
    if (this.players.some((p) => p.seatIndex === seat)) {
      throw new Error('SEAT_OCCUPIED');
    }
    const snap = this.captureSeatIndexSnapshot();
    const next: Player = { ...player, seatIndex: seat };
    this.players.push(next);
    this.sortPlayersBySeat();
    this.applySeatIndexSnapshot(snap);
  }

  /** 已入座玩家换到另一空位；任意阶段可用，并校正庄家 / 行动位下标 */
  movePlayerToSeat(playerId: string, newSeat: number): void {
    if (newSeat < 0 || newSeat >= MAX_TABLE_SEATS) {
      throw new Error('PokerEngine: seat index out of range');
    }
    const curIdx = this.players.findIndex((p) => p.id === playerId);
    if (curIdx < 0) throw new Error('PokerEngine: unknown player');
    const p = this.players[curIdx]!;
    if (p.seatIndex === newSeat) return;
    if (this.players.some((x) => x.id !== playerId && x.seatIndex === newSeat)) {
      throw new Error('SEAT_OCCUPIED');
    }
    const snap = this.captureSeatIndexSnapshot();
    this.players.splice(curIdx, 1);
    p.seatIndex = newSeat;
    this.players.push(p);
    this.sortPlayersBySeat();
    this.applySeatIndexSnapshot(snap);
  }

  /**
   * 从座位移除玩家；仅用于「未开第一手」或 Showdown 已分池间隙（由 Room 校验）。
   */
  removePlayerFromTable(playerId: string): void {
    const curIdx = this.players.findIndex((p) => p.id === playerId);
    if (curIdx < 0) throw new Error('PokerEngine: unknown player');

    const oldDealer = this.dealerIndex;
    const oldTurn = this.currentTurnIndex;
    const oldLag = this.lastAggressorIndex;
    const oldBr = this.bettingRoundStartIndex;

    this.players.splice(curIdx, 1);
    this.holeCardsByPlayerId.delete(playerId);
    this.handContributionByPlayerId.delete(playerId);
    this.streetBetByPlayerId.delete(playerId);
    this.actedSinceLastRaise.delete(playerId);

    const n = this.players.length;
    const adjust = (idx: number): number => {
      if (idx < curIdx) return idx;
      if (idx > curIdx) return idx - 1;
      return Math.min(curIdx, Math.max(0, n - 1));
    };

    if (n === 0) {
      this.dealerIndex = 0;
      this.currentTurnIndex = 0;
      this.lastAggressorIndex = null;
      this.bettingRoundStartIndex = null;
      this.gameState = GameState.Idle;
      this.communityCards = [];
      this.pots = [];
      this.currentHighestBet = 0;
      this.deck = [];
      return;
    }

    this.dealerIndex = Math.max(0, Math.min(adjust(oldDealer), n - 1));
    this.currentTurnIndex = Math.max(0, Math.min(adjust(oldTurn), n - 1));
    this.lastAggressorIndex =
      oldLag != null ? Math.max(0, Math.min(adjust(oldLag), n - 1)) : null;
    this.bettingRoundStartIndex =
      oldBr != null ? Math.max(0, Math.min(adjust(oldBr), n - 1)) : null;
  }
}

function nextActorIndexFrom(players: Player[], currentIdx: number): number {
  const n = players.length;
  let i = currentIdx;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    const p = players[i]!;
    if (p.status === PlayerStatus.Folded || p.status === PlayerStatus.SittingOut) continue;
    if (p.status === PlayerStatus.AllIn) continue;
    return i;
  }
  return currentIdx;
}
