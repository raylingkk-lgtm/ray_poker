import { randomUUID } from 'node:crypto';
import { hashRoomPassword, verifyRoomPassword } from '../auth/roomPassword.js';
import { PokerEngine } from '../engine/PokerEngine.js';
import {
  clipPlayerNickname,
  resolvedNicknameForSitDown,
} from '../util/playerNickname.js';
import { solveHoldem } from '../engine/handEvaluator.js';
import type { Player } from '../types/poker.js';
import { ActionType, GameState, PlayerStatus } from '../types/poker.js';
import type {
  EngineGameStateSnapshot,
  LastHandSettlementView,
  SettlementPlayerView,
} from './interfaces.js';

/** 与前端 `TABLE_SEAT_COUNT` 对齐 */
export const ROOM_MAX_TABLE_PLAYERS = 10;

/** PRD 托管：轮到行动后等待时长（毫秒） */
export const ROOM_ACTION_TIMEOUT_MS = 30_000;

/** 房主断线超过该时间未重连则转移房主（PRD 断线/管理） */
export const HOST_TRANSFER_TIMEOUT_MS = 30_000;

/** 结算弹窗展示后自动开下一手（毫秒） */
export const ROOM_AUTO_NEXT_HAND_AFTER_SETTLEMENT_MS = 10_000;

export interface RoomCreateOptions {
  roomId: string;
  hostPlayerId: string;
  smallBlind: number;
  bigBlind: number;
  initialPlayers?: Player[];
  /** 观战入座默认带入（未传 `sit_down.stack` 时使用） */
  defaultStartingStack?: number;
  /** 进房密码（与 `joinPasswordHash` 成对；不设则公开进房） */
  joinPasswordSalt?: string;
  joinPasswordHash?: string;
  /** 大厅与桌上房主昵称展示；缺省由 API 生成 */
  displayName?: string;
}

export interface PendingBuyInRequest {
  id: string;
  playerId: string;
  amount: number;
  requestedAt: number;
}

export interface ApprovedBuyInCredit {
  playerId: string;
  amount: number;
  approvedAt: number;
}

/**
 * 单房间：引擎、连接映射、行动托管计时、买入审批（批准后即时入账 stack；下一手开桌前仍会清空待入账队列，通常为空）。
 */
export type HostTransferredEvent = {
  roomId: string;
  previousHostId: string;
  newHostId: string;
};

export class Room {
  readonly roomId: string;
  readonly engine: PokerEngine;

  private _hostPlayerId: string;
  private readonly defaultStartingStack: number;
  private readonly playersConnectMap = new Map<string, string>();
  /** 已 join_room 但未入引擎座位的观战连接 */
  private readonly lobbyConnectMap = new Map<string, string>();
  /** 首次入桌/绑定时间，用于房主继承时选最早在线玩家 */
  private readonly joinedAtMs = new Map<string, number>();
  private pendingBuyIns: PendingBuyInRequest[] = [];
  private approvedBuyInsPendingCredit: ApprovedBuyInCredit[] = [];
  /** 会话累计买入（含开局初始 stack 视为首次买入） */
  private readonly totalBuyInRecorded = new Map<string, number>();
  /** 已站起围观、不在引擎座位上的玩家，供 game_ended 战绩合并 */
  private readonly stoodUpPlayersForSettlement = new Map<
    string,
    { playerId: string; nickname: string; finalStack: number; totalBuyIn: number }
  >();
  /** PRD §3.8：最后一手阶段内拒绝新买入（已排队待审的仍可由房主处理） */
  private isFinalHand = false;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  /** 与 `ROOM_ACTION_TIMEOUT_MS` 对齐，供前端倒计时 */
  private actionDeadlineAtMs: number | null = null;
  private hostTransferTimer: ReturnType<typeof setTimeout> | null = null;
  private handPotDistributed = false;
  /** 上一手分池结果（供单局结算 UI）；`startNextHand` 时清空 */
  private lastHandSettlement: LastHandSettlementView | null = null;
  /** 已成功发牌开局的次数（0 = 尚未开过第一手） */
  private handsDealtCount = 0;
  private readonly onHostTransferred?: (e: HostTransferredEvent) => void;
  private joinPwdSalt?: string;
  private joinPwdHash?: string;
  private joinPasswordRevision: number;
  private roomDisplayName: string;
  private autoNextHandTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onRoomStateChanged?: (room: Room) => void;

  constructor(
    opts: RoomCreateOptions & {
      onHostTransferred?: (e: HostTransferredEvent) => void;
      onRoomStateChanged?: (room: Room) => void;
    },
  ) {
    this.roomId = opts.roomId;
    this._hostPlayerId = opts.hostPlayerId;
    this.defaultStartingStack = opts.defaultStartingStack ?? 200;
    this.joinPwdSalt = opts.joinPasswordSalt;
    this.joinPwdHash = opts.joinPasswordHash;
    this.joinPasswordRevision =
      opts.joinPasswordSalt && opts.joinPasswordHash ? 1 : 0;
    this.roomDisplayName =
      typeof opts.displayName === 'string' && opts.displayName.trim().length > 0
        ? opts.displayName.trim()
        : `房间${opts.roomId.slice(-4)}`;
    this.onHostTransferred = opts.onHostTransferred;
    this.onRoomStateChanged = opts.onRoomStateChanged;
    this.engine = new PokerEngine({
      players: opts.initialPlayers ?? [],
      dealerIndex: 0,
      smallBlind: opts.smallBlind,
      bigBlind: opts.bigBlind,
    });
    const now = Date.now();
    this.joinedAtMs.set(opts.hostPlayerId, now);
    for (const p of opts.initialPlayers ?? []) {
      if (!this.joinedAtMs.has(p.id)) this.joinedAtMs.set(p.id, now);
    }
    for (const p of this.engine.getPlayers()) {
      this.totalBuyInRecorded.set(p.id, p.stack);
    }
  }

  get hostPlayerId(): string {
    return this._hostPlayerId;
  }

  getDisplayName(): string {
    return this.roomDisplayName;
  }

  /**
   * 房主：修改或清除进房密码。每次变更递增 `joinPasswordRevision`。
   */
  setJoinPassword(plain: string | undefined): { ok: true } | { ok: false; reason: string } {
    const MAX_PASSWORD_LEN = 128;
    const trimmed = typeof plain === 'string' ? plain.trim() : '';
    if (trimmed === '') {
      this.joinPwdSalt = undefined;
      this.joinPwdHash = undefined;
      this.joinPasswordRevision += 1;
      return { ok: true };
    }
    if (trimmed.length > MAX_PASSWORD_LEN) {
      return { ok: false, reason: 'PASSWORD_TOO_LONG' };
    }
    const h = hashRoomPassword(trimmed);
    this.joinPwdSalt = h.salt;
    this.joinPwdHash = h.hash;
    this.joinPasswordRevision += 1;
    return { ok: true };
  }

  /** 大厅列表用：不含敏感信息 */
  getListingSummary(): {
    roomId: string;
    displayName: string;
    seatedCount: number;
    hasPassword: boolean;
    joinPasswordRevision: number;
    smallBlind: number;
    bigBlind: number;
  } {
    return {
      roomId: this.roomId,
      displayName: this.roomDisplayName,
      seatedCount: this.engine.getPlayers().length,
      hasPassword: Boolean(this.joinPwdSalt && this.joinPwdHash),
      joinPasswordRevision: this.joinPasswordRevision,
      smallBlind: this.engine.getSmallBlind(),
      bigBlind: this.engine.getBigBlind(),
    };
  }

  /**
   * 校验进房密码：`ok` 可进；`required` 需客户端补密码；`invalid` 密码错误。
   */
  checkJoinPassword(plain?: string): 'ok' | 'required' | 'invalid' {
    if (!this.joinPwdSalt || !this.joinPwdHash) return 'ok';
    if (plain === undefined || plain === '') return 'required';
    return verifyRoomPassword(plain, this.joinPwdSalt, this.joinPwdHash)
      ? 'ok'
      : 'invalid';
  }

  get finalHandActive(): boolean {
    return this.isFinalHand;
  }

  /** 标记进入最后一手阶段：此后 `requestBuyIn` 一律拒绝 */
  enterFinalHandPhase(): void {
    this.isFinalHand = true;
  }

  /** 牌桌上的玩家 id（引擎座位） */
  getTablePlayerIds(): string[] {
    return this.engine.getPlayers().map((p) => p.id);
  }

  /**
   * 房主手动开桌：第一手任意时刻可开；之后仅当上一手已进入 Showdown 且已分池。
   */
  hostRequestStartNextHand(): { ok: boolean; reason?: string } {
    if (this.isFinalHand) {
      return { ok: false, reason: 'FINAL_HAND_NO_NEW_HAND' };
    }
    if (!this.canHostStartNextHandNow()) {
      return { ok: false, reason: 'HAND_IN_PROGRESS' };
    }
    try {
      this.startNextHand();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'START_FAILED';
      return { ok: false, reason: msg };
    }
  }

  private canHostStartNextHandNow(): boolean {
    if (this.handsDealtCount === 0) return true;
    const gs = this.engine.getGameState();
    if (gs === GameState.FinalHand) return false;
    if (gs !== GameState.Showdown) return false;
    return this.handPotDistributed;
  }

  getConnectedPlayerIdSet(): ReadonlySet<string> {
    return new Set(this.playersConnectMap.keys());
  }

  getLobbyPlayerIds(): string[] {
    return [...this.lobbyConnectMap.keys()];
  }

  isLobbyPlayer(playerId: string): boolean {
    return this.lobbyConnectMap.has(playerId);
  }

  getLobbySocketId(playerId: string): string | undefined {
    return this.lobbyConnectMap.get(playerId);
  }

  bindLobbySocket(playerId: string, socketId: string): void {
    this.ensureJoinedAt(playerId);
    this.lobbyConnectMap.set(playerId, socketId);
  }

  unbindLobbySocket(playerId: string): void {
    this.lobbyConnectMap.delete(playerId);
  }

  handleLobbyDisconnect(playerId: string): void {
    this.lobbyConnectMap.delete(playerId);
  }

  /**
   * 观战端 `sit_down`：写入引擎指定座位（须在 `canReconfigureSeatPositionsNow` 窗口内，且未满座）。
   * 不含 Socket 映射切换；成功后由 handler `unbindLobbySocket` + `bindPlayerSocket`。
   */
  sitDownFromLobby(
    playerId: string,
    opts: { nickname?: string; stack?: number; seatIndex: number },
  ): { ok: true; engineSeatIndex: number } | { ok: false; reason: string } {
    if (this.getTablePlayerIds().includes(playerId)) {
      return { ok: false, reason: 'ALREADY_SEATED' };
    }
    const timing = this.canReconfigureSeatPositionsNow();
    if (!timing.ok) return timing;
    if (this.engine.getPlayers().length >= ROOM_MAX_TABLE_PLAYERS) {
      return { ok: false, reason: 'TABLE_FULL' };
    }

    const seat = opts.seatIndex;
    if (!Number.isInteger(seat) || seat < 0 || seat >= ROOM_MAX_TABLE_PLAYERS) {
      return { ok: false, reason: 'INVALID_SEAT' };
    }

    const stack = opts.stack ?? this.defaultStartingStack;
    if (!Number.isFinite(stack) || stack <= 0) {
      return { ok: false, reason: 'INVALID_STACK' };
    }

    const nickname = resolvedNicknameForSitDown(opts.nickname, playerId);

    const player: Player = {
      id: playerId,
      nickname,
      stack: Math.floor(stack),
      bet: 0,
      status: PlayerStatus.Alive,
      seatIndex: seat,
    };
    try {
      this.engine.addPlayerAtSeat(player, seat);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'SEAT_OCCUPIED') return { ok: false, reason: 'SEAT_OCCUPIED' };
      return { ok: false, reason: msg || 'SIT_DOWN_FAILED' };
    }
    this.stoodUpPlayersForSettlement.delete(playerId);
    this.totalBuyInRecorded.set(playerId, player.stack);
    this.ensureJoinedAt(playerId);
    return { ok: true, engineSeatIndex: seat };
  }

  /**
   * 已上桌玩家修改展示昵称（任意阶段允许）。
   */
  updatePlayerNickname(
    playerId: string,
    rawNickname: unknown,
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.getTablePlayerIds().includes(playerId)) {
      return { ok: false, reason: 'NOT_AT_TABLE' };
    }
    if (typeof rawNickname !== 'string') {
      return { ok: false, reason: 'INVALID_NICKNAME' };
    }
    const trimmed = rawNickname.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'INVALID_NICKNAME' };
    }
    const nickname = clipPlayerNickname(trimmed);
    if (nickname.length === 0) {
      return { ok: false, reason: 'INVALID_NICKNAME' };
    }
    const ok = this.engine.setPlayerNickname(playerId, nickname);
    if (!ok) return { ok: false, reason: 'NOT_AT_TABLE' };
    return { ok: true };
  }

  /**
   * 已入座玩家换到另一空位。仅允许在「未开第一手」或「Showdown 且已分池」间隙（不在下注街中）。
   */
  moveSeatAtTable(
    playerId: string,
    seatIndex: number,
  ): { ok: true; engineSeatIndex: number } | { ok: false; reason: string } {
    if (!this.getTablePlayerIds().includes(playerId)) {
      return { ok: false, reason: 'NOT_AT_TABLE' };
    }
    const timing = this.canReconfigureSeatPositionsNow();
    if (!timing.ok) return timing;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= ROOM_MAX_TABLE_PLAYERS) {
      return { ok: false, reason: 'INVALID_SEAT' };
    }
    try {
      this.engine.movePlayerToSeat(playerId, seatIndex);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'SEAT_OCCUPIED') return { ok: false, reason: 'SEAT_OCCUPIED' };
      return { ok: false, reason: msg || 'MOVE_SEAT_FAILED' };
    }
    return { ok: true, engineSeatIndex: seatIndex };
  }

  /** 换座后刷新托管计时（当前行动位可能随下标变化） */
  refreshActionTimerAfterSeatChange(): void {
    this.clearActionTimer();
    this.scheduleActionTimerForCurrentTurn();
  }

  /**
   * 入座 / 换座 共同的「非下注中」窗口：未开第一手，或上一手已进入 Showdown 且已分池。
   */
  private canReconfigureSeatPositionsNow():
    | { ok: true }
    | { ok: false; reason: string } {
    if (this.isFinalHand) {
      return { ok: false, reason: 'FINAL_HAND_NO_SIT' };
    }
    if (this.handsDealtCount === 0) return { ok: true };
    if (
      this.engine.getGameState() === GameState.Showdown &&
      this.handPotDistributed
    ) {
      return { ok: true };
    }
    return { ok: false, reason: 'SHOWDOWN_GAP_ONLY' };
  }

  private ensureJoinedAt(playerId: string): void {
    if (!this.joinedAtMs.has(playerId)) {
      this.joinedAtMs.set(playerId, Date.now());
    }
  }

  bindPlayerSocket(playerId: string, socketId: string): void {
    this.ensureJoinedAt(playerId);
    this.playersConnectMap.set(playerId, socketId);
    if (playerId === this._hostPlayerId) {
      this.clearHostTransferTimer();
    }
    if (this.engine.getCurrentTurnPlayerId() === playerId) {
      this.scheduleActionTimerForCurrentTurn();
    }
  }

  /**
   * 断线：移出 socket 映射，不踢出引擎座位（仍可参与牌局，视为离线）。
   * 若断线为房主，启动 30s 房主转移计时器。
   */
  handlePlayerDisconnect(playerId: string): void {
    this.playersConnectMap.delete(playerId);
    if (this.engine.getCurrentTurnPlayerId() === playerId) {
      this.clearActionTimer();
    }
    if (playerId === this._hostPlayerId) {
      this.scheduleHostTransferTimer();
    }
  }

  unbindPlayerSocket(playerId: string): void {
    this.handlePlayerDisconnect(playerId);
  }

  isPlayerConnected(playerId: string): boolean {
    return this.playersConnectMap.has(playerId);
  }

  getSocketIdForPlayer(playerId: string): string | undefined {
    return this.playersConnectMap.get(playerId);
  }

  requestBuyIn(
    playerId: string,
    amount: number,
  ): { ok: boolean; requestId?: string; reason?: string } {
    if (this.isFinalHand) {
      return { ok: false, reason: 'FINAL_HAND_NO_BUYIN' };
    }
    if (amount <= 0) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    const id = randomUUID();
    this.pendingBuyIns.push({
      id,
      playerId,
      amount,
      requestedAt: Date.now(),
    });
    return { ok: true, requestId: id };
  }

  approveBuyIn(requestId: string, approverId: string): { ok: boolean; reason?: string } {
    if (approverId !== this._hostPlayerId) {
      return { ok: false, reason: 'NOT_HOST' };
    }
    const idx = this.pendingBuyIns.findIndex((r) => r.id === requestId);
    if (idx < 0) return { ok: false, reason: 'NOT_FOUND' };
    const [req] = this.pendingBuyIns.splice(idx, 1);
    this.approvedBuyInsPendingCredit.push({
      playerId: req.playerId,
      amount: req.amount,
      approvedAt: Date.now(),
    });
    this.applyApprovedBuyInsToStacks();
    return { ok: true };
  }

  rejectBuyIn(requestId: string, approverId: string): { ok: boolean; reason?: string } {
    if (approverId !== this._hostPlayerId) {
      return { ok: false, reason: 'NOT_HOST' };
    }
    const idx = this.pendingBuyIns.findIndex((r) => r.id === requestId);
    if (idx < 0) return { ok: false, reason: 'NOT_FOUND' };
    this.pendingBuyIns.splice(idx, 1);
    return { ok: true };
  }

  getPendingBuyIns(): readonly PendingBuyInRequest[] {
    return this.pendingBuyIns;
  }

  getApprovedCreditsPending(): readonly ApprovedBuyInCredit[] {
    return this.approvedBuyInsPendingCredit;
  }

  private applyApprovedBuyInsToStacks(): void {
    for (const c of this.approvedBuyInsPendingCredit) {
      this.engine.addToPlayerStack(c.playerId, c.amount);
      this.totalBuyInRecorded.set(
        c.playerId,
        (this.totalBuyInRecorded.get(c.playerId) ?? 0) + c.amount,
      );
    }
    this.approvedBuyInsPendingCredit = [];
  }

  /** 战绩结算：用于 `game_ended` 长图 */
  buildGameEndedSettlement(): {
    roomId: string;
    rows: {
      playerId: string;
      nickname: string;
      totalBuyIn: number;
      finalStack: number;
      profit: number;
    }[];
  } {
    const atTable = new Set(this.engine.getPlayers().map((p) => p.id));
    const rows = this.engine.getPlayers().map((p) => {
      const buy = this.totalBuyInRecorded.get(p.id) ?? 0;
      return {
        playerId: p.id,
        nickname: p.nickname,
        totalBuyIn: buy,
        finalStack: p.stack,
        profit: p.stack - buy,
      };
    });
    for (const s of this.stoodUpPlayersForSettlement.values()) {
      if (atTable.has(s.playerId)) continue;
      rows.push({
        playerId: s.playerId,
        nickname: s.nickname,
        totalBuyIn: s.totalBuyIn,
        finalStack: s.finalStack,
        profit: s.finalStack - s.totalBuyIn,
      });
    }
    return { roomId: this.roomId, rows };
  }

  /**
   * 站起围观：离开引擎座位、回到大厅连接映射；保留 `totalBuyInRecorded` 与离桌时筹码供最终结算。
   */
  standUpToLobby(
    playerId: string,
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.getTablePlayerIds().includes(playerId)) {
      return { ok: false, reason: 'NOT_AT_TABLE' };
    }
    const timing = this.canReconfigureSeatPositionsNow();
    if (!timing.ok) return timing;

    const p = this.engine.getPlayers().find((x) => x.id === playerId);
    if (!p) return { ok: false, reason: 'NOT_AT_TABLE' };

    this.pendingBuyIns = this.pendingBuyIns.filter((r) => r.playerId !== playerId);

    this.stoodUpPlayersForSettlement.set(playerId, {
      playerId,
      nickname: p.nickname,
      finalStack: p.stack,
      totalBuyIn: this.totalBuyInRecorded.get(playerId) ?? 0,
    });

    try {
      this.engine.removePlayerFromTable(playerId);
    } catch (e) {
      this.stoodUpPlayersForSettlement.delete(playerId);
      const msg = e instanceof Error ? e.message : 'REMOVE_FAILED';
      return { ok: false, reason: msg };
    }

    if (this.engine.getPlayers().length === 0) {
      this.handsDealtCount = 0;
      this.lastHandSettlement = null;
      this.handPotDistributed = false;
      this.clearActionTimer();
    } else {
      this.refreshActionTimerAfterSeatChange();
    }

    return { ok: true };
  }

  /**
   * 新一手：`GameState` 随 `dealPreFlop` 重置为 PRE_FLOP；此时将审批通过的买入注入 stack。
   */
  startNextHand(): void {
    this.clearAutoNextHandTimer();
    this.lastHandSettlement = null;
    const seated = this.engine
      .getPlayers()
      .filter((p) => p.status !== PlayerStatus.SittingOut);
    if (seated.length < 2) {
      throw new Error('Room.startNextHand: need at least 2 seated players');
    }
    const withChips = seated.filter((p) => p.stack > 0);
    if (withChips.length < 2) {
      throw new Error('Room.startNextHand: need at least 2 players with chips');
    }
    this.applyApprovedBuyInsToStacks();
    this.handPotDistributed = false;
    if (!this.isFinalHand && this.handsDealtCount >= 1) {
      this.engine.rotateDealerForNextHand();
    }
    this.engine.dealPreFlop();
    this.handsDealtCount += 1;
    this.clearActionTimer();
    this.scheduleActionTimerForCurrentTurn();
  }

  handlePlayerAction(playerId: string, action: ActionType, amount = 0): void {
    this.clearActionTimer();
    this.engine.processAction(playerId, action, amount);
    this.afterEngineStep();
  }

  private afterEngineStep(): void {
    this.settleHandIfNeeded();
    this.scheduleActionTimerForCurrentTurn();
  }

  private settleHandIfNeeded(): void {
    if (this.engine.getGameState() !== GameState.Showdown || this.handPotDistributed) return;
    try {
      const rawAwards = this.engine.distributePot();
      this.handPotDistributed = true;
      const nickById = new Map(
        this.engine.getPlayers().map((p) => [p.id, p.nickname] as const),
      );
      const board = this.engine.getCommunityCards();
      const settlementPlayers: SettlementPlayerView[] = this.engine
        .getPlayers()
        .map((p) => {
          const folded =
            p.status === PlayerStatus.Folded ||
            p.status === PlayerStatus.SittingOut;
          const holeRaw = this.engine.getHoleCardsForPlayer(p.id);
          const holeCards =
            folded || !holeRaw
              ? null
              : ([holeRaw[0], holeRaw[1]] as [typeof holeRaw[0], typeof holeRaw[1]]);
          let handDescription: string | undefined;
          if (!folded && holeRaw && board.length === 5) {
            try {
              const hand = solveHoldem(holeRaw, board) as {
                descr?: string;
                name?: string;
              };
              handDescription = hand.descr ?? hand.name;
            } catch {
              /* 牌张未齐等 */
            }
          }
          return {
            playerId: p.id,
            nickname: p.nickname,
            folded,
            holeCards,
            handDescription,
          };
        });
      this.lastHandSettlement = {
        handNumber: this.handsDealtCount,
        awards: rawAwards.map((a) => ({
          playerId: a.playerId,
          nickname: nickById.get(a.playerId) ?? a.playerId,
          potLevel: a.potLevel,
          amount: a.amount,
        })),
        communityCards: [...board],
        settlementPlayers,
      };
      this.scheduleAutoNextHandAfterSettlement();
    } catch {
      /* 牌桌未就绪时由外层处理；不标记已结算以便重试 */
    }
    if (this.handPotDistributed) {
      this.clearActionTimer();
    }
  }

  private scheduleActionTimerForCurrentTurn(): void {
    const actor = this.engine.getCurrentTurnPlayerId();
    if (!actor) return;
    if (!this.isPlayerConnected(actor)) return;
    this.clearActionTimer();
    this.actionDeadlineAtMs = Date.now() + ROOM_ACTION_TIMEOUT_MS;
    this.actionTimer = setTimeout(() => {
      this.actionTimer = null;
      this.actionDeadlineAtMs = null;
      this.onActionDeadline(actor);
    }, ROOM_ACTION_TIMEOUT_MS);
  }

  /**
   * 托管：可 Check 则 Check；否则若非全下则 Fold。
   * 全下或断线（无 socket 绑定）不自动弃牌（全下保护 / 断线不替用户弃牌）。
   */
  private onActionDeadline(playerId: string): void {
    if (this.engine.getCurrentTurnPlayerId() !== playerId) return;
    if (this.engine.isPlayerAllIn(playerId)) return;
    if (!this.isPlayerConnected(playerId)) return;
    try {
      if (this.engine.canPlayerCheckNow(playerId)) {
        this.engine.processAction(playerId, ActionType.Check, 0);
      } else {
        this.engine.processAction(playerId, ActionType.Fold, 0);
      }
    } catch {
      return;
    }
    this.afterEngineStep();
    this.notifyRoomStateChanged();
  }

  private notifyRoomStateChanged(): void {
    this.onRoomStateChanged?.(this);
  }

  private clearAutoNextHandTimer(): void {
    if (this.autoNextHandTimer != null) {
      clearTimeout(this.autoNextHandTimer);
      this.autoNextHandTimer = null;
    }
  }

  private scheduleAutoNextHandAfterSettlement(): void {
    this.clearAutoNextHandTimer();
    if (this.isFinalHand) return;
    if (!this.canAutoStartNextHand()) return;
    this.autoNextHandTimer = setTimeout(() => {
      this.autoNextHandTimer = null;
      this.tryAutoStartNextHandAfterSettlement();
    }, ROOM_AUTO_NEXT_HAND_AFTER_SETTLEMENT_MS);
  }

  /** 与手动「下一手」一致的前提：Showdown 且已分池、至少两人在座且有筹码 */
  private canAutoStartNextHand(): boolean {
    if (!this.handPotDistributed) return false;
    if (this.engine.getGameState() !== GameState.Showdown) return false;
    const seated = this.engine
      .getPlayers()
      .filter((p) => p.status !== PlayerStatus.SittingOut);
    if (seated.length < 2) return false;
    if (seated.filter((p) => p.stack > 0).length < 2) return false;
    return true;
  }

  private tryAutoStartNextHandAfterSettlement(): void {
    if (!this.canAutoStartNextHand()) return;
    try {
      this.startNextHand();
      this.notifyRoomStateChanged();
    } catch {
      /* 人不够等：静默跳过 */
    }
  }

  private clearActionTimer(): void {
    if (this.actionTimer != null) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    this.actionDeadlineAtMs = null;
  }

  buildEngineSnapshot(): EngineGameStateSnapshot {
    this.engine.calculateSidePots();
    const currentTurn = this.engine.getCurrentTurnPlayerId();
    const players = this.engine.getPlayers().map((p) => ({
      id: p.id,
      nickname: p.nickname,
      stack: p.stack,
      bet: p.bet,
      status: p.status,
      seatIndex: p.seatIndex,
      holeCards: this.engine.getHoleCardsForPlayer(p.id),
    }));
    return {
      roomId: this.roomId,
      gameState: this.engine.getGameState(),
      communityCards: this.engine.getCommunityCards(),
      pots: this.engine.getPots(),
      dealerIndex: this.engine.getDealerIndex(),
      smallBlind: this.engine.getSmallBlind(),
      bigBlind: this.engine.getBigBlind(),
      currentTurnPlayerId: currentTurn,
      currentHighestBet: this.engine.getCurrentHighestBet(),
      minRaiseTo: this.engine.getMinRaiseTargetTotal(),
      hostPlayerId: this._hostPlayerId,
      pendingBuyIns: this.pendingBuyIns.map((r) => ({ ...r })),
      lastHandSettlement: this.lastHandSettlement,
      handsDealtCount: this.handsDealtCount,
      actionDeadlineAt: this.actionDeadlineAtMs,
      roomDisplayName: this.roomDisplayName,
      joinPasswordRevision: this.joinPasswordRevision,
      players,
    };
  }

  private scheduleHostTransferTimer(): void {
    this.clearHostTransferTimer();
    this.hostTransferTimer = setTimeout(() => {
      this.hostTransferTimer = null;
      this.transferHostToEarliestOnline();
    }, HOST_TRANSFER_TIMEOUT_MS);
  }

  private clearHostTransferTimer(): void {
    if (this.hostTransferTimer != null) {
      clearTimeout(this.hostTransferTimer);
      this.hostTransferTimer = null;
    }
  }

  /**
   * 当前在线玩家中，按入桌时间最早者继任房主。
   */
  private transferHostToEarliestOnline(): void {
    const online = [...this.playersConnectMap.keys()];
    if (online.length === 0) return;
    const sorted = online.sort(
      (a, b) => (this.joinedAtMs.get(a) ?? 0) - (this.joinedAtMs.get(b) ?? 0),
    );
    const nextHost = sorted[0]!;
    const prev = this._hostPlayerId;
    if (nextHost === prev) return;
    this._hostPlayerId = nextHost;
    this.onHostTransferred?.({
      roomId: this.roomId,
      previousHostId: prev,
      newHostId: nextHost,
    });
  }

  destroy(): void {
    this.clearActionTimer();
    this.clearHostTransferTimer();
    this.clearAutoNextHandTimer();
  }
}
