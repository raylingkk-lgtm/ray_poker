import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionPanel } from '../components/game/ActionPanel';
import { BuyInApprovals } from '../components/BuyInApprovals';
import { HandSettlementModal } from '../components/HandSettlementModal';
import { PokerTable } from '../components/PokerTable';
import { SettlementModal } from '../components/SettlementModal';
import { Toast } from '../components/Toast';
import { useGameSocket } from '../hooks/useGameSocket';
import { formatGamePhase, totalPotAmount } from '../lib/gameLabels';

export interface GameRoomProps {
  /** 默认对齐后端 `server.ts` 示例桌 */
  roomId?: string;
  playerId?: string;
  /** 服务端尚未在快照中带 host 时，用于显示房主菜单的本地假定 id */
  assumedHostPlayerId?: string;
}

/** 固定「一手」买入：100 个大盲（可随房间配置扩展） */
function defaultBuyInAmount(bigBlind: number): number {
  return Math.max(100, bigBlind * 100);
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
  };
  return map[message] ?? message;
}

export function GameRoom({
  roomId = 'demo',
  playerId = 'host-1',
  assumedHostPlayerId = 'host-1',
}: GameRoomProps) {
  const [toast, setToast] = useState<string | null>(null);

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

  const onAdminControlAck = useCallback(
    (p: { ok?: boolean; message?: string }) => {
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
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<'root' | 'buyins'>('root');
  const [dismissedSettlementHandNo, setDismissedSettlementHandNo] = useState<
    number | null
  >(null);

  useEffect(() => {
    joinRoom({ roomId, playerId });
  }, [joinRoom, roomId, playerId]);

  useEffect(() => {
    if (!gameState?.lastHandSettlement) {
      setDismissedSettlementHandNo(null);
    }
  }, [gameState?.lastHandSettlement]);

  const effectiveHostId =
    gameState?.hostPlayerId ?? hostPlayerId ?? assumedHostPlayerId;
  const isHost = !!selfPlayerId && selfPlayerId === effectiveHostId;
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

  const potTotal = useMemo(() => totalPotAmount(gameState?.pots), [gameState?.pots]);
  const phaseLabel = gameState ? formatGamePhase(gameState.gameState) : '—';
  const blindsLabel = gameState
    ? `${gameState.smallBlind} / ${gameState.bigBlind}`
    : '—';

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
    const amount = defaultBuyInAmount(gameState.bigBlind);
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

  const friendInviteUrl = useMemo(() => {
    const q = new URLSearchParams();
    q.set('room', roomId);
    q.set('player', 'guest-1');
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
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="text-white/60">房间</span>
              <span className="truncate font-mono text-white">{roomId}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-white/55">
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
            <p className="text-[10px] uppercase tracking-wide text-white/35">
              Socket: {connectionStatus}
              {lastSocketError ? ` · ${lastSocketError}` : ''}
            </p>
            <p className="text-[9px] leading-snug text-white/30">
              好友试玩（同 Wi‑Fi 请见{' '}
              <span className="text-white/40">docs/NETWORK_PLAY.md</span>
              ）：{' '}
              <span className="break-all font-mono text-white/45">{friendInviteUrl}</span>
              <span className="text-white/25">
                （房主 + 好友均入座且在线会自动开第一手；远程需在 frontend/.env.local 配置
              VITE_SOCKET_URL）
              </span>
            </p>
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
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left hover:bg-white/10"
                      onClick={handleRequestBuyIn}
                    >
                      申请买入
                      <span className="mt-0.5 block text-[10px] text-white/40">
                        固定 {gameState ? defaultBuyInAmount(gameState.bigBlind) : '—'}{' '}
                        筹码（100BB）
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
                          一般自动续局；若卡住可手动开
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
          onClose={dismissGameEnded}
        />
      ) : null}
    </div>
  );
}
