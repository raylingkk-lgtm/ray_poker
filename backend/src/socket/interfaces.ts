/**
 * Socket 负载与对外可见牌局模型（PRD §3.3 行动、§3.7 成牌比较在服务端权威校验）。
 * 任何下发给前端的牌局数据必须使用 {@link sanitizeGameState} 按接收者清洗。
 */

import {
  GameState,
  PlayerStatus,
  type ActionType,
  type Card,
  type Pot,
} from '../types/poker.js';

// --- 清洗后对外模型（无敏感聚合） ---

/**
 * 前端可见玩家：他人底牌在非 SHOWDOWN 阶段不得出现。
 * `holeCards === null` 表示不可见（未发牌、已隐藏或无权查看）。
 */
export interface SanitizedPlayer {
  id: string;
  nickname: string;
  stack: number;
  bet: number;
  status: PlayerStatus;
  /** 物理座位 0..9 */
  seatIndex: number;
  holeCards: readonly [Card, Card] | null;
  /** 是否在 Socket 上在线（断线重连 PRD）；未传 presence 时默认 true */
  isConnected?: boolean;
}

/**
 * 前端可见牌局快照（已按某位接收者清洗）。
 */
export interface PendingBuyInView {
  id: string;
  playerId: string;
  amount: number;
  requestedAt: number;
}

/** 单局结束分池明细（全桌可见，不含未公开底牌） */
export interface HandPotAwardView {
  playerId: string;
  nickname: string;
  potLevel: number;
  amount: number;
}

export interface LastHandSettlementView {
  /** 已结束的这一手序号（与房间 `handsDealtCount` 一致） */
  handNumber: number;
  awards: readonly HandPotAwardView[];
}

export interface SanitizedGameState {
  roomId: string;
  gameState: GameState;
  communityCards: readonly Card[];
  pots: readonly Pot[];
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentTurnPlayerId: string | null;
  /** 当前街最高注（与玩家本街 `bet` 对齐） */
  currentHighestBet: number;
  /** 加注时 `Raise` 的 `amount` 不得低于本值（本街目标总注） */
  minRaiseTo: number;
  /** 房主 id（客户端用于权限与角标） */
  hostPlayerId: string;
  /** 仅房主可见待审买入；非房主恒为空数组 */
  pendingBuyIns: readonly PendingBuyInView[];
  /** 上一手分池结果；新开下一手后为 `null` */
  lastHandSettlement: LastHandSettlementView | null;
  /** 已完成发牌开局次数；0 表示尚未发第一手 */
  handsDealtCount?: number;
  /** 当前行动位托管截止时间（Unix 毫秒）；无倒计时为 `null` */
  actionDeadlineAt?: number | null;
  /** 房间展示名（大厅列表） */
  roomDisplayName: string;
  /** 进房密码版本；房主改密后递增，供客户端失效本地缓存 */
  joinPasswordRevision: number;
  players: readonly SanitizedPlayer[];
}

// --- 服务端引擎/房间聚合快照（清洗前，含完整底牌） ---

export interface EngineGameStatePlayerSnapshot {
  id: string;
  nickname: string;
  stack: number;
  bet: number;
  status: PlayerStatus;
  seatIndex: number;
  /** 仅服务端持有；下发前必须经 {@link sanitizeGameState} */
  holeCards?: readonly [Card, Card] | null;
}

export interface EngineGameStateSnapshot {
  roomId: string;
  gameState: GameState;
  communityCards: readonly Card[];
  pots: readonly Pot[];
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentTurnPlayerId: string | null;
  currentHighestBet: number;
  minRaiseTo: number;
  hostPlayerId: string;
  pendingBuyIns: readonly PendingBuyInView[];
  lastHandSettlement: LastHandSettlementView | null;
  /** 与房间 `handsDealtCount` 一致 */
  handsDealtCount: number;
  /** 当前行动位托管截止时间（Unix 毫秒）；无行动计时为 `null` */
  actionDeadlineAt: number | null;
  roomDisplayName: string;
  joinPasswordRevision: number;
  players: readonly EngineGameStatePlayerSnapshot[];
}

// --- 客户端 → 服务端 ---

/** `join_room`：会话绑定（含重连）；`authToken` 须与 `playerId` 在服务端登记一致 */
export interface JoinRoomClientPayload {
  roomId: string;
  playerId: string;
  authToken: string;
  /** 有进房密码的房间必填（或重试时传入） */
  roomPassword?: string;
}

/** `admin_changed`：房主继承 */
export interface AdminChangedServerPayload {
  roomId: string;
  previousHostId: string;
  newHostId: string;
}

/** `sit_down`：入座 / 占座；已入座时同事件表示换到该空位 */
export interface SitDownClientPayload {
  roomId: string;
  /** 物理座位 0..9，必填 */
  seatIndex: number;
  /** 显示昵称；缺省用 `playerId` */
  nickname?: string;
  /** 带入筹码；缺省用房间 `defaultStartingStack` */
  stack?: number;
}

/** `sit_down` 回执 */
export interface SitDownServerAckPayload {
  roomId: string;
  ok: boolean;
  playerId?: string;
  seatIndex?: number;
  message?: string;
}

/**
 * `player_action`：声明行动（PRD §3.3：Check 仅当当前最高下注等于本街已投入；否则 Call/Fold/Raise/All-in）。
 * 具体合法性由服务端引擎校验。
 */
export interface PlayerActionClientPayload {
  roomId: string;
  action: ActionType;
  /** BET/RAISE 等需要金额时使用；无金额行动可省略或传 0 */
  amount?: number;
}

export interface PlayerActionServerAckPayload {
  roomId: string;
  ok: boolean;
  errorCode?: string;
  message?: string;
}

/** `request_buy_in`：请求补充筹码 */
export interface RequestBuyInClientPayload {
  roomId: string;
  amount: number;
}

export interface RequestBuyInServerAckPayload {
  roomId: string;
  ok: boolean;
  approvedAmount?: number;
  message?: string;
}

/** `admin_control`：房主 / 管理员指令（具体指令集由房间实现扩展） */
export type AdminControlCommand =
  | 'pause_table'
  | 'resume_table'
  | 'kick_player'
  | 'adjust_stack'
  | 'force_showdown'
  | 'close_room'
  | 'approve_buy_in'
  | 'reject_buy_in'
  /** 房主：开始第一手（若尚未开局）或上一手已结算后的下一手 */
  | 'start_hand'
  /** 房主：设置或清除进房密码；`newRoomPassword` 空串表示清除 */
  | 'set_room_password';

export interface AdminControlClientPayload {
  roomId: string;
  command: AdminControlCommand;
  targetPlayerId?: string;
  value?: number;
  reason?: string;
  /** 买入审批：`approve_buy_in` / `reject_buy_in` 必填 */
  requestId?: string;
  /** `set_room_password`：新密码；省略或空串表示清除进房密码 */
  newRoomPassword?: string;
}

export interface AdminControlServerAckPayload {
  roomId: string;
  ok: boolean;
  message?: string;
}

// --- 服务端 → 客户端（负载内嵌 {@link SanitizedGameState}） ---

export interface GameStateUpdateServerPayload {
  roomId: string;
  /** 必须为 {@link sanitizeGameState} 的输出 */
  state: SanitizedGameState;
  /** 可选序列号，便于客户端去重或合并 */
  seq?: number;
}

export interface SyncGameStateServerPayload {
  roomId: string;
  /** 必须为 {@link sanitizeGameState} 的输出 */
  state: SanitizedGameState;
  serverTime?: number;
}

function cloneCard(card: Card): Card {
  return { suit: card.suit, rank: card.rank };
}

function clonePot(pot: Pot): Pot {
  return {
    amount: pot.amount,
    eligiblePlayers: [...pot.eligiblePlayers],
    level: pot.level,
  };
}

function cloneLastHandSettlement(s: LastHandSettlementView): LastHandSettlementView {
  return {
    handNumber: s.handNumber,
    awards: s.awards.map((a) => ({ ...a })),
  };
}

/**
 * 将引擎快照清洗为某一前端连接可见的 {@link SanitizedGameState}。
 *
 * **安全规则**：当 `gameState !== SHOWDOWN` 时，对任意 `player.id !== targetPlayerId` 的玩家，
 * 不得保留其 `holeCards`（置为 `null`）。本人始终可看到自己已发的底牌（若快照中存在）。
 * `SHOWDOWN` 起未弃牌玩家可按产品需要展示真实底牌（仍不向前端下发已 muck 的牌）。
 */
export function sanitizeGameState(
  engineState: EngineGameStateSnapshot,
  targetPlayerId: string,
  presence?: { connectedPlayerIds: ReadonlySet<string> },
): SanitizedGameState {
  const isShowdown = engineState.gameState === GameState.Showdown;

  const players: SanitizedPlayer[] = engineState.players.map((p) => {
    const isSelf = p.id === targetPlayerId;
    let holeCards: readonly [Card, Card] | null = null;

    if (isSelf) {
      if (p.holeCards && p.holeCards.length === 2) {
        holeCards = [cloneCard(p.holeCards[0]), cloneCard(p.holeCards[1])];
      }
    } else if (isShowdown) {
      const stillInHand =
        p.status !== PlayerStatus.Folded && p.status !== PlayerStatus.SittingOut;
      if (stillInHand && p.holeCards && p.holeCards.length === 2) {
        holeCards = [cloneCard(p.holeCards[0]), cloneCard(p.holeCards[1])];
      }
    }

    const isConnected = presence
      ? presence.connectedPlayerIds.has(p.id)
      : true;

    return {
      id: p.id,
      nickname: p.nickname,
      stack: p.stack,
      bet: p.bet,
      status: p.status,
      seatIndex: typeof p.seatIndex === 'number' ? p.seatIndex : 0,
      holeCards,
      isConnected,
    };
  });

  const isHost = targetPlayerId === engineState.hostPlayerId;
  const pendingBuyIns = isHost ? engineState.pendingBuyIns : [];

  return {
    roomId: engineState.roomId,
    gameState: engineState.gameState,
    communityCards: engineState.communityCards.map(cloneCard),
    pots: engineState.pots.map(clonePot),
    dealerIndex: engineState.dealerIndex,
    smallBlind: engineState.smallBlind,
    bigBlind: engineState.bigBlind,
    currentTurnPlayerId: engineState.currentTurnPlayerId,
    currentHighestBet: engineState.currentHighestBet,
    minRaiseTo: engineState.minRaiseTo,
    hostPlayerId: engineState.hostPlayerId,
    pendingBuyIns,
    lastHandSettlement: engineState.lastHandSettlement
      ? cloneLastHandSettlement(engineState.lastHandSettlement)
      : null,
    handsDealtCount: engineState.handsDealtCount,
    actionDeadlineAt: engineState.actionDeadlineAt,
    roomDisplayName: engineState.roomDisplayName,
    joinPasswordRevision: engineState.joinPasswordRevision,
    players,
  };
}

/** 构造 `sync_game_state` 负载；禁止传入未清洗的引擎快照给 `state` 字段。 */
export function buildSyncGameStatePayload(
  snapshot: EngineGameStateSnapshot,
  viewerPlayerId: string,
  serverTime?: number,
  presence?: { connectedPlayerIds: ReadonlySet<string> },
): SyncGameStateServerPayload {
  return {
    roomId: snapshot.roomId,
    state: sanitizeGameState(snapshot, viewerPlayerId, presence),
    serverTime,
  };
}

/** 构造 `game_state_update` 负载。 */
export function buildGameStateUpdatePayload(
  snapshot: EngineGameStateSnapshot,
  viewerPlayerId: string,
  seq?: number,
  presence?: { connectedPlayerIds: ReadonlySet<string> },
): GameStateUpdateServerPayload {
  return {
    roomId: snapshot.roomId,
    state: sanitizeGameState(snapshot, viewerPlayerId, presence),
    seq,
  };
}
