/**
 * 德州扑克核心领域类型（引擎层）。
 * 分池与奇数筹码规则见 PRD §3.6 / §3.2；阶段含最后一手见 PRD §3.8。
 */

/** 花色 */
export enum Suit {
  Clubs = 'CLUBS',
  Diamonds = 'DIAMONDS',
  Hearts = 'HEARTS',
  Spades = 'SPADES',
}

/** 点数（德扑比较顺序由引擎实现时定义） */
export enum Rank {
  Two = '2',
  Three = '3',
  Four = '4',
  Five = '5',
  Six = '6',
  Seven = '7',
  Eight = '8',
  Nine = '9',
  Ten = '10',
  Jack = 'J',
  Queen = 'Q',
  King = 'K',
  Ace = 'A',
}

export interface Card {
  suit: Suit;
  rank: Rank;
}

/** 玩家在本局中的状态 */
export enum PlayerStatus {
  /** 仍在手牌中，可行动（存活） */
  Alive = 'ALIVE',
  /** 已弃牌 */
  Folded = 'FOLDED',
  /** 全下 */
  AllIn = 'ALL_IN',
  /** 起立 / 暂离，本局不参与 */
  SittingOut = 'SITTING_OUT',
}

export interface Player {
  id: string;
  nickname: string;
  /** 当前可用筹码 */
  stack: number;
  /** 当前下注轮已投入筹码（街道累计由引擎策略决定，此处为牌手维度展示字段） */
  bet: number;
  status: PlayerStatus;
  /** 物理座位 0..9，顺时针；引擎内 `players` 按此升序排列 */
  seatIndex: number;
}

/**
 * 房间 / 牌局阶段。
 * `FINAL_HAND`：PRD 3.8 最后一手结束后的收尾阶段（例如强制亮牌、结算后解散前状态）。
 */
export enum GameState {
  PreFlop = 'PRE_FLOP',
  Flop = 'FLOP',
  Turn = 'TURN',
  River = 'RIVER',
  Showdown = 'SHOWDOWN',
  FinalHand = 'FINAL_HAND',
}

/**
 * 单个奖池（主池或边池）。
 * `eligiblePlayers`：有资格参与该池分配的玩家 ID（已考虑全下层级）。
 */
export interface Pot {
  amount: number;
  eligiblePlayers: string[];
  /**
   * 0 为主池，1..n 为边池（约定由引擎维护顺序）。
   * 具体索引语义在实现 `calculateSidePots` 时固定。
   */
  level: number;
}

export enum ActionType {
  Fold = 'FOLD',
  Check = 'CHECK',
  Call = 'CALL',
  Bet = 'BET',
  Raise = 'RAISE',
  AllIn = 'ALL_IN',
}

/**
 * 单池分配给一名玩家的筹码（含 PRD 3.2 奇数筹码顺时针分配后的结果）。
 */
export interface PotAward {
  playerId: string;
  potLevel: number;
  amount: number;
}
