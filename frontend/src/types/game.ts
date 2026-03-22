/**
 * 与后端 `SanitizedGameState` / Socket 负载对齐的前端视图模型。
 */

export type PokerGamePhase =
  | 'PRE_FLOP'
  | 'FLOP'
  | 'TURN'
  | 'RIVER'
  | 'SHOWDOWN'
  | 'FINAL_HAND';

export interface GameCard {
  suit: string;
  rank: string;
}

export interface SanitizedPlayer {
  id: string;
  nickname: string;
  stack: number;
  bet: number;
  status: string;
  /** 物理座位 0..9，与牌桌椭圆位一致 */
  seatIndex: number;
  holeCards: readonly [GameCard, GameCard] | null;
  isConnected?: boolean;
}

export interface PotView {
  amount: number;
  eligiblePlayers: string[];
  level: number;
}

export interface PendingBuyInView {
  id: string;
  playerId: string;
  amount: number;
  requestedAt: number;
}

export interface HandPotAwardView {
  playerId: string;
  nickname: string;
  potLevel: number;
  amount: number;
}

export interface LastHandSettlementView {
  handNumber: number;
  awards: readonly HandPotAwardView[];
}

export interface SanitizedGameState {
  roomId: string;
  gameState: PokerGamePhase;
  communityCards: readonly GameCard[];
  pots: readonly PotView[];
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentTurnPlayerId: string | null;
  /** 当前街最高注（旧版服务端可能缺省，由客户端用 max(bet) 推导） */
  currentHighestBet?: number;
  /** 合法加注目标总注（本街）下限 */
  minRaiseTo?: number;
  hostPlayerId?: string;
  /** 仅房主收到非空 */
  pendingBuyIns?: readonly PendingBuyInView[];
  lastHandSettlement?: LastHandSettlementView | null;
  /** 已开局次数；0 表示尚未发第一手 */
  handsDealtCount?: number;
  /** 当前行动位托管截止 Unix 毫秒；无则 null */
  actionDeadlineAt?: number | null;
  roomDisplayName?: string;
  joinPasswordRevision?: number;
  players: readonly SanitizedPlayer[];
}

export type PlayerActionKind =
  | 'FOLD'
  | 'CHECK'
  | 'CALL'
  | 'BET'
  | 'RAISE'
  | 'ALL_IN';

/** 与后端 ClientSocketEvent 字符串一致 */
export const SocketClientEvent = {
  JoinRoom: 'join_room',
  SitDown: 'sit_down',
  PlayerAction: 'player_action',
  RequestBuyIn: 'request_buy_in',
  AdminControl: 'admin_control',
} as const;

export const SocketServerEvent = {
  GameStateUpdate: 'game_state_update',
  SyncGameState: 'sync_game_state',
  AdminChanged: 'admin_changed',
  GameEnded: 'game_ended',
} as const;

export interface SettlementRow {
  playerId: string;
  nickname: string;
  totalBuyIn: number;
  finalStack: number;
  profit: number;
}

export interface GameEndedPayload {
  roomId: string;
  rows: readonly SettlementRow[];
}

/** GET /api/rooms 单项 */
export interface RoomListingItem {
  roomId: string;
  displayName: string;
  seatedCount: number;
  hasPassword: boolean;
  joinPasswordRevision: number;
  smallBlind: number;
  bigBlind: number;
}

/** GET /api/match-history 单项 */
export interface MatchHistoryRecord {
  id: string;
  endedAt: number;
  roomId: string;
  rows: readonly SettlementRow[];
}

export interface JoinRoomPayload {
  roomId: string;
  playerId: string;
  authToken: string;
  roomPassword?: string;
}

export interface SitDownPayload {
  roomId: string;
  seatIndex: number;
  nickname?: string;
  stack?: number;
}

export interface PlayerActionPayload {
  roomId: string;
  action: PlayerActionKind;
  amount?: number;
}

export interface RequestBuyInPayload {
  roomId: string;
  amount: number;
}

export interface AdminChangedPayload {
  roomId: string;
  previousHostId: string;
  newHostId: string;
}
