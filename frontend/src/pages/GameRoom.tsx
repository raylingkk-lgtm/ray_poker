import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ActionPanel } from '../components/game/ActionPanel';
import { BuyInApprovals } from '../components/BuyInApprovals';
import { HandSettlementModal } from '../components/HandSettlementModal';
import { PokerTable } from '../components/PokerTable';
import { SettlementModal } from '../components/SettlementModal';
import { Toast } from '../components/Toast';
import { useGameSocket } from '../hooks/useGameSocket';
import { getApiBase } from '../lib/apiBase';
import { formatGamePhase, totalPotAmount } from '../lib/gameLabels';
import { PENDING_ROOM_PASSWORD_KEY } from '../lib/roomJoin';
import {
  clearStoredRoomPassword,
  getStoredRoomPassword,
  setStoredRoomPassword,
} from '../lib/roomPasswordStorage';
import type { PlayerSession } from '../lib/session';

export interface GameRoomProps {
  roomId: string;
  session: PlayerSession;
  onRenewSession: () => Promise<PlayerSession>;
  onNavigateToRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
}

type BuyInBbChoice = 40 | 60 | 100 | 'custom';

async function copyToClipboard(
  text: string,
): Promise<'ok' | 'fail'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'ok';
  } catch {
    return 'fail';
  }
}

function buyInAckToastMessage(p: {
  ok?: boolean;
  reason?: string;
}): string {
  if (p.ok === true) return '买入申请已提交，请等待房主审批';
  const code = p.reason ?? '';
  if (code === 'FINAL_HAND_NO_BUYIN') return '最后一手阶段无法申请买入';
  if (code === 'INVALID_AMOUNT') return '买入金额无效';
  return code ? `买入申请失败：${code}` : '买入申请失败';
}

function adminControlFailureToast(message?: string): string | null {
  if (!message) return '操作失败';
  const map: Record<string, string> = {
    HAND_IN_PROGRESS: '当前一手尚未结束，请等分池后再开下一手',
    FINAL_HAND_NO_NEW_HAND: '最后一手阶段不可再开局',
    NOT_HOST: '仅房主可操作',
    'Room.startNextHand: need at least 2 players with chips':
      '至少两名玩家有筹码才能开牌；输光者可申请买入后再开',
    'Room.startNextHand: need at least 2 seated players':
      '至少需要两位未暂离的玩家在座',
    MISSING_NEW_ROOM_PASSWORD: '请填写新密码或选择清除密码',
    PASSWORD_TOO_LONG: '密码过长',
  };
  return map[message] ?? message;
}

export function GameRoom({
  roomId,
  session,
  onRenewSession,
  onNavigateToRoom,
  onLeaveRoom,
}: GameRoomProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [buyInBbChoice, setBuyInBbChoice] = useState<BuyInBbChoice>(40);
  const [buyInCustomBb, setBuyInCustomBb] = useState(50);
  const [sessionPendingPwd] = useState(
    () => sessionStorage.getItem(PENDING_ROOM_PASSWORD_KEY) ?? '',
  );
  const [retryPwd, setRetryPwd] = useState<string | null>(null);
  const [joinNonce, setJoinNonce] = useState(0);
  const [pwdDraft, setPwdDraft] = useState('');
  const [newTableOpen, setNewTableOpen] = useState(false);
  const [newTablePwd, setNewTablePwd] = useState('');
  const [newTableBusy, setNewTableBusy] = useState(false);
  const [hostPwdOpen, setHostPwdOpen] = useState(false);
  const [hostPwdDraft, setHostPwdDraft] = useState('');
  const [hostPwdBusy, setHostPwdBusy] = useState(false);
  const [hostPwdClear, setHostPwdClear] = useState(false);

  const onSitDownAck = useCallback(
    (p: { ok?: boolean; message?: string }) => {
      if (p?.ok !== false) return;
      const code = p.message ?? '';
      const map: Record<string, string> = {
        ALREADY_SEATED: '你已在座位上',
        NOT_IN_LOBBY: '请先成功加入房间',
        TABLE_FULL: '座位已满',
        HAND_IN_PROGRESS: '本手进行中，请等分池后再入座',
        SHOWDOWN_GAP_ONLY: '仅未开局或上一手分池后可入座 / 换座',
        FINAL_HAND_NO_SIT: '最后一手阶段不可入座',
        INVALID_STACK: '带入筹码无效',
        INVALID_SEAT: '座位号无效',
        SEAT_OCCUPIED: '该座位有人',
        NOT_AT_TABLE: '你不在牌桌上',
        MOVE_SEAT_FAILED: '换座失败',
      };
      setToast(map[code] ?? (code ? `入座失败：${code}` : '入座失败'));
    },
    [],
  );

  const onRequestBuyInAck = useCallback(
    (p: { ok?: boolean; reason?: string }) => {
      setToast(buyInAckToastMessage(p));
    },
    [],
  );

  const pendingHostPwdAck = useRef(false);

  const onAdminControlAck = useCallback(
    (p: { ok?: boolean; message?: string }) => {
      if (pendingHostPwdAck.current) {
        pendingHostPwdAck.current = false;
        setHostPwdBusy(false);
        if (p.ok === false) {
          setToast(adminControlFailureToast(p.message) ?? '操作失败');
        } else {
          setToast('进房密码已更新');
          setHostPwdOpen(false);
          setHostPwdDraft('');
        }
        return;
      }
      if (p.ok === false) {
        setToast(adminControlFailureToast(p.message) ?? '操作失败');
      }
    },
    [],
  );

  const {
    connectionStatus,
    gameState,
    selfPlayer,
    selfPlayerId,
    hostPlayerId,
    joinRoom,
    clearLastSocketError,
    lastSocketError,
    sitDown,
    sendPlayerAction,
    requestBuyIn,
    sendAdminControl,
    gameEndedPayload,
    dismissGameEnded,
  } = useGameSocket({
    autoConnect: true,
    onSitDownAck,
    onRequestBuyInAck,
    onAdminControlAck,
    onAuthInvalid: onRenewSession,
    onSocketToast: (msg) => setToast(msg),
  });

  const effectiveRoomPassword = useMemo(() => {
    if (retryPwd !== null) return retryPwd || undefined;
    const st = getStoredRoomPassword(roomId);
    if (st?.password) return st.password;
    if (sessionPendingPwd) return sessionPendingPwd;
    return undefined;
  }, [retryPwd, roomId, sessionPendingPwd]);

  useEffect(() => {
    joinRoom({
      roomId,
      playerId: session.playerId,
      authToken: session.authToken,
      roomPassword: effectiveRoomPassword || undefined,
    });
  }, [
    joinRoom,
    roomId,
    session.playerId,
    session.authToken,
    joinNonce,
    effectiveRoomPassword,
  ]);

  useEffect(() => {
    if (lastSocketError === 'ROOM_PASSWORD_INVALID') {
      clearStoredRoomPassword(roomId);
    }
  }, [lastSocketError, roomId]);

  useEffect(() => {
    if (!gameState) return;
    if (sessionStorage.getItem(PENDING_ROOM_PASSWORD_KEY)) {
      sessionStorage.removeItem(PENDING_ROOM_PASSWORD_KEY);
    }
    const rev = gameState.joinPasswordRevision ?? 0;
    const pwd =
      (retryPwd !== null ? retryPwd : getStoredRoomPassword(roomId)?.password) ||
      sessionPendingPwd;
    const hid = gameState.hostPlayerId;
    if (pwd && session.playerId !== hid) {
      setStoredRoomPassword(roomId, pwd, rev);
    }
  }, [gameState, roomId, retryPwd, session.playerId, sessionPendingPwd]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<'root' | 'buyins'>('root');
  const [dismissedSettlementHandNo, setDismissedSettlementHandNo] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (!gameState?.lastHandSettlement) {
      setDismissedSettlementHandNo(null);
    }
  }, [gameState?.lastHandSettlement]);

  const effectiveHostId = gameState?.hostPlayerId ?? hostPlayerId ?? null;
  const isHost = !!(
    selfPlayerId &&
    effectiveHostId &&
    selfPlayerId === effectiveHostId
  );

  const needPasswordModal =
    lastSocketError === 'ROOM_PASSWORD_REQUIRED' ||
    lastSocketError === 'ROOM_PASSWORD_INVALID';

  useEffect(() => {
    if (needPasswordModal) {
      setPwdDraft(
        (retryPwd !== null ? retryPwd : getStoredRoomPassword(roomId)?.password ?? sessionPendingPwd) ||
          '',
      );
    }
  }, [needPasswordModal, retryPwd, roomId, sessionPendingPwd]);
  const pendingBuyIns = gameState?.pendingBuyIns ?? [];
  const showApprovalBadge = isHost && pendingBuyIns.length > 0;

  const isSeatedAtTable = useMemo(
    () =>
      !!(
        selfPlayerId &&
        (gameState?.players.some((p) => p.id === selfPlayerId) ?? false)
      ),
    [gameState?.players, selfPlayerId],
  );

  const resolveBuyInChips = useCallback(
    (bigBlind: number) => {
      const mult =
        buyInBbChoice === 'custom'
          ? Math.max(20, Math.floor(buyInCustomBb))
          : buyInBbChoice;
      return Math.max(100, bigBlind * mult);
    },
    [buyInBbChoice, buyInCustomBb],
  );

  const handsDealtCount = gameState?.handsDealtCount ?? 0;
  const seatedPlayers = gameState?.players ?? [];
  const onlineAtTable = seatedPlayers.filter((p) => p.isConnected !== false)
    .length;

  const potTotal = useMemo(() => totalPotAmount(gameState?.pots), [gameState?.pots]);
  const phaseLabel = gameState ? formatGamePhase(gameState.gameState) : '—';
  const blindsLabel = gameState
    ? `${gameState.smallBlind} / ${gameState.bigBlind}`
    : '—';

  const connectionLabel =
    connectionStatus === 'connected'
      ? '已连接'
      : connectionStatus === 'connecting'
        ? '连接中…'
        : connectionStatus === 'error'
          ? '连接异常'
          : '已断开';

  const openMenu = () => {
    setMenuOpen(true);
    setMenuView('root');
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setMenuView('root');
  };

  const handleRequestBuyIn = () => {
    if (!gameState) {
      setToast('尚未同步房间状态');
      return;
    }
    const amount = resolveBuyInChips(gameState.bigBlind);
    requestBuyIn({ roomId, amount });
    closeMenu();
  };

  const handleCloseRoom = () => {
    if (
      !window.confirm('确定结束房间并向全员展示战绩结算表？此操作将广播 game_ended。')
    ) {
      return;
    }
    sendAdminControl({ roomId, command: 'close_room' });
    closeMenu();
  };

  const handleStartNextHand = () => {
    sendAdminControl({ roomId, command: 'start_hand' });
    closeMenu();
  };

  const handleSubmitRoomPassword = (e: FormEvent) => {
    e.preventDefault();
    clearLastSocketError();
    const v = pwdDraft.trim();
    setRetryPwd(v.length > 0 ? v : null);
    setJoinNonce((n) => n + 1);
  };

  const handleOpenNewTable = useCallback(() => {
    setNewTablePwd('');
    setNewTableOpen(true);
    setMenuOpen(false);
    setMenuView('root');
  }, []);

  const handleConfirmNewTable = useCallback(async () => {
    setNewTableBusy(true);
    try {
      const base = getApiBase();
      const body: {
        playerId: string;
        authToken: string;
        fromRoomId: string;
        password?: string;
      } = {
        playerId: session.playerId,
        authToken: session.authToken,
        fromRoomId: roomId,
      };
      const p = newTablePwd.trim();
      if (p) body.password = p;

      const r = await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { roomId?: string; error?: string };
      if (!r.ok) {
        setToast(j.error ?? `再开一桌失败 (${r.status})`);
        return;
      }
      if (!j.roomId) {
        setToast('再开一桌失败：无房间号');
        return;
      }
      onNavigateToRoom(j.roomId);
    } catch {
      setToast('网络错误，请检查 VITE_SOCKET_URL');
    } finally {
      setNewTableBusy(false);
      setNewTableOpen(false);
    }
  }, [newTablePwd, onNavigateToRoom, roomId, session.authToken, session.playerId]);

  const friendInviteUrl = useMemo(() => {
    const q = new URLSearchParams();
    q.set('room', roomId);
    return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
  }, [roomId]);

  const lastHandSettlement = gameState?.lastHandSettlement ?? null;
  const showHandSettlementModal =
    lastHandSettlement !== null &&
    lastHandSettlement.handNumber !== dismissedSettlementHandNo;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-900 text-white">
      <header className="shrink-0 border-b border-white/10 bg-black/30 px-3 py-2">
        <div className="mx-auto flex max-w-lg items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {gameState?.roomDisplayName ? (
                <span className="truncate font-medium text-white">
                  {gameState.roomDisplayName}
                </span>
              ) : null}
              <span className="text-white/60">房间号</span>
              <span className="truncate font-mono text-white">{roomId}</span>
              <button
                type="button"
                className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/75 hover:bg-white/10"
                onClick={async () => {
                  const r = await copyToClipboard(roomId);
                  setToast(r === 'ok' ? '已复制房间号' : '复制失败，请手动选择复制');
                }}
              >
                复制房间号
              </button>
              <button
                type="button"
                className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/75 hover:bg-white/10"
                onClick={async () => {
                  const r = await copyToClipboard(friendInviteUrl);
                  setToast(r === 'ok' ? '已复制邀请链接' : '复制失败，请手动选择复制');
                }}
              >
                复制链接
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-500/15 text-emerald-300/95'
                    : connectionStatus === 'connecting'
                      ? 'bg-amber-500/15 text-amber-200/95'
                      : connectionStatus === 'error'
                        ? 'bg-red-500/20 text-red-300/95'
                        : 'bg-white/10 text-white/45'
                }`}
                title="与服务器的连接状态"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    connectionStatus === 'connected'
                      ? 'bg-emerald-400'
                      : connectionStatus === 'connecting'
                        ? 'animate-pulse bg-amber-400'
                        : connectionStatus === 'error'
                          ? 'bg-red-400'
                          : 'bg-white/35'
                  }`}
                  aria-hidden
                />
                {connectionLabel}
              </span>
              <span>
                盲注 <span className="font-mono text-white/80">{blindsLabel}</span>
              </span>
              <span>
                阶段 <span className="text-white/80">{phaseLabel}</span>
              </span>
              <span>
                底池{' '}
                <span className="font-mono text-emerald-400/90">{potTotal}</span>
              </span>
            </div>
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              className="relative rounded-lg border border-white/15 bg-white/5 p-2 text-white/80 hover:bg-white/10"
              aria-label="房间菜单"
              aria-expanded={menuOpen}
              onClick={() => (menuOpen ? closeMenu() : openMenu())}
            >
              {showApprovalBadge ? (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-gray-900"
                  aria-hidden
                />
              ) : null}
              <span className="block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-gray-950 py-1 text-sm shadow-xl">
                {menuView === 'root' ? (
                  <>
                    <div className="border-b border-white/10 px-3 py-2">
                      <div className="text-[10px] text-white/45">买入筹码（大盲倍数）</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {([40, 60, 100] as const).map((bb) => (
                          <button
                            key={bb}
                            type="button"
                            className={`rounded px-2 py-1 text-[11px] ${
                              buyInBbChoice === bb
                                ? 'bg-emerald-600 text-white'
                                : 'bg-white/10 text-white/80 hover:bg-white/15'
                            }`}
                            onClick={() => setBuyInBbChoice(bb)}
                          >
                            {bb}BB
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`rounded px-2 py-1 text-[11px] ${
                            buyInBbChoice === 'custom'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white/10 text-white/80 hover:bg-white/15'
                          }`}
                          onClick={() => setBuyInBbChoice('custom')}
                        >
                          自定义
                        </button>
                      </div>
                      {buyInBbChoice === 'custom' ? (
                        <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
                          <span className="shrink-0">倍数</span>
                          <input
                            type="number"
                            min={20}
                            max={500}
                            value={buyInCustomBb}
                            onChange={(e) =>
                              setBuyInCustomBb(Number(e.target.value) || 20)
                            }
                            className="w-20 rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-white"
                          />
                          <span>BB（≥20）</span>
                        </label>
                      ) : null}
                      <p className="mt-1.5 text-[10px] text-white/35">
                        本次申请：{' '}
                        <span className="font-mono text-amber-200/90">
                          {gameState
                            ? resolveBuyInChips(gameState.bigBlind)
                            : '—'}{' '}
                          筹码
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left hover:bg-white/10"
                      onClick={handleRequestBuyIn}
                    >
                      申请买入
                      <span className="mt-0.5 block text-[10px] text-white/40">
                        提交后需房主在「审批买入」中通过
                      </span>
                    </button>
                    {isHost ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-white/10"
                        onClick={() => setMenuView('buyins')}
                      >
                        <span>审批买入</span>
                        {pendingBuyIns.length > 0 ? (
                          <span className="rounded-full bg-red-500/90 px-1.5 text-[10px] font-bold text-white">
                            {pendingBuyIns.length}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    {isHost ? (
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left hover:bg-white/10"
                        onClick={handleStartNextHand}
                      >
                        开始 / 下一手牌
                        <span className="mt-0.5 block text-[10px] text-white/40">
                          分池后通常会自己续局；人手不足或卡住时点这里。第一手任意时刻可开。
                        </span>
                      </button>
                    ) : null}
                    {isHost ? (
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left hover:bg-white/10"
                        onClick={() => {
                          setHostPwdOpen(true);
                          setHostPwdDraft('');
                          setHostPwdClear(false);
                          closeMenu();
                        }}
                      >
                        修改进房密码
                        <span className="mt-0.5 block text-[10px] text-white/40">
                          可设新密码或清除密码（改密后他人需重新输入）
                        </span>
                      </button>
                    ) : null}
                    {isHost ? (
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left hover:bg-white/10"
                        onClick={handleOpenNewTable}
                      >
                        再开一桌
                        <span className="mt-0.5 block text-[10px] text-white/40">
                          新开房间并可设密码，无需重启服务
                        </span>
                      </button>
                    ) : null}
                    {isHost ? (
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left text-amber-200/90 hover:bg-white/10"
                        onClick={handleCloseRoom}
                      >
                        结束房间并生成战绩
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-white/50 hover:bg-white/10"
                      onClick={closeMenu}
                    >
                      关闭
                    </button>
                  </>
                ) : (
                  <div className="py-1">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 pb-2">
                      <span className="text-xs font-medium text-white/60">
                        待审买入
                      </span>
                      <button
                        type="button"
                        className="text-xs text-emerald-400/90 hover:underline"
                        onClick={() => setMenuView('root')}
                      >
                        返回
                      </button>
                    </div>
                    <BuyInApprovals
                      pending={pendingBuyIns}
                      players={gameState?.players ?? []}
                      onApprove={(requestId) => {
                        sendAdminControl({
                          roomId,
                          command: 'approve_buy_in',
                          requestId,
                        });
                      }}
                      onReject={(requestId) => {
                        sendAdminControl({
                          roomId,
                          command: 'reject_buy_in',
                          requestId,
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-2 pb-1 pt-2">
        <div className="mx-auto flex h-full w-full max-w-lg min-h-0 flex-col">
          {connectionStatus === 'connected' &&
          gameState &&
          !isSeatedAtTable ? (
            <div
              className="mb-2 rounded-lg border border-amber-400/35 bg-amber-950/50 px-3 py-2 text-center text-xs text-amber-100/95"
              role="status"
            >
              你正在<strong className="mx-1">旁观</strong>：请点击桌上虚线空位的
              <strong className="mx-1">「坐下」</strong>
              加入牌局。
            </div>
          ) : null}
          {connectionStatus === 'connected' &&
          gameState &&
          isSeatedAtTable &&
          handsDealtCount === 0 &&
          onlineAtTable < 2 ? (
            <div
              className="mb-2 rounded-lg border border-sky-400/30 bg-sky-950/40 px-3 py-2 text-center text-[11px] leading-snug text-sky-100/95"
              role="status"
            >
              等待<strong className="mx-1">至少两位玩家在座且在线</strong>
              后将自动发第一手。也可请房主在菜单里点「开始 / 下一手牌」。
            </div>
          ) : null}
          <PokerTable
            gameState={gameState}
            selfPlayerId={selfPlayerId}
            roomId={roomId}
            isSeatedAtTable={isSeatedAtTable}
            onSitDown={(seatIndex) => sitDown({ roomId, seatIndex })}
            onSeatOccupied={() => setToast('该位置已被占用')}
          />
        </div>
      </main>

      <ActionPanel
        roomId={roomId}
        gameState={gameState}
        selfPlayerId={selfPlayerId}
        selfPlayer={selfPlayer}
        onPlayerAction={sendPlayerAction}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
      {showHandSettlementModal && lastHandSettlement ? (
        <HandSettlementModal
          settlement={lastHandSettlement}
          communityCards={gameState?.communityCards ?? []}
          onDismiss={() =>
            setDismissedSettlementHandNo(lastHandSettlement.handNumber)
          }
        />
      ) : null}
      {gameEndedPayload ? (
        <SettlementModal
          payload={gameEndedPayload}
          onClose={() => {
            dismissGameEnded();
            onLeaveRoom();
          }}
        />
      ) : null}

      {lastSocketError === 'ROOM_NOT_FOUND' ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-gray-950/95 p-6 text-center">
          <p className="text-sm text-white">房间不存在或已关闭</p>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
            onClick={onLeaveRoom}
          >
            回大厅
          </button>
        </div>
      ) : null}

      {needPasswordModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-pwd-title"
        >
          <form
            onSubmit={handleSubmitRoomPassword}
            className="w-full max-w-sm rounded-xl border border-white/10 bg-gray-900 p-4 shadow-xl"
          >
            <h2
              id="room-pwd-title"
              className="text-base font-medium text-white"
            >
              进房密码
            </h2>
            <p className="mt-1 text-xs text-white/50">
              {lastSocketError === 'ROOM_PASSWORD_INVALID'
                ? '密码错误，请重试'
                : '该房间已设置密码，请输入后加入'}
            </p>
            <input
              type="password"
              autoComplete="off"
              value={pwdDraft}
              onChange={(e) => setPwdDraft(e.target.value)}
              className="mt-3 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
              placeholder="房间密码"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                onClick={onLeaveRoom}
              >
                回大厅
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                进入
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {hostPwdOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="host-pwd-title"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!hostPwdClear && !hostPwdDraft.trim()) {
                setToast('请输入新密码或勾选清除密码');
                return;
              }
              setHostPwdBusy(true);
              pendingHostPwdAck.current = true;
              sendAdminControl({
                roomId,
                command: 'set_room_password',
                newRoomPassword: hostPwdClear ? '' : hostPwdDraft.trim(),
              });
            }}
            className="w-full max-w-sm rounded-xl border border-white/10 bg-gray-900 p-4 shadow-xl"
          >
            <h2 id="host-pwd-title" className="text-base font-medium text-white">
              修改进房密码
            </h2>
            <p className="mt-1 text-xs text-white/50">
              留空并勾选「清除密码」可改为公开进房。
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={hostPwdClear}
                onChange={(e) => setHostPwdClear(e.target.checked)}
                className="rounded border-white/30"
              />
              清除进房密码
            </label>
            <input
              type="password"
              autoComplete="new-password"
              disabled={hostPwdClear}
              value={hostPwdDraft}
              onChange={(e) => setHostPwdDraft(e.target.value)}
              className="mt-3 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 disabled:opacity-40"
              placeholder="新密码"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={hostPwdBusy}
                className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
                onClick={() => {
                  setHostPwdOpen(false);
                  setHostPwdDraft('');
                  setHostPwdClear(false);
                }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={hostPwdBusy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {hostPwdBusy ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {newTableOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-table-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-gray-900 p-4 shadow-xl">
            <h2 id="new-table-title" className="text-base font-medium text-white">
              再开一桌
            </h2>
            <p className="mt-1 text-xs text-white/50">
              可选为新房间设置进房密码；提交后将跳转到新房间。
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={newTablePwd}
              onChange={(e) => setNewTablePwd(e.target.value)}
              className="mt-3 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
              placeholder="新房间进房密码（可选）"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={newTableBusy}
                className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
                onClick={() => setNewTableOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={newTableBusy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                onClick={() => void handleConfirmNewTable()}
              >
                {newTableBusy ? '创建中…' : '创建并进入'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
