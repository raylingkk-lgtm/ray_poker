import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameCard, SanitizedGameState, SanitizedPlayer } from '../types/game';
import { computeEllipseSeatPositions, TABLE_SEAT_COUNT } from '../lib/ellipseSeats';
import { Seat } from './Seat';

function occupantsByFixedSeat(
  players: readonly SanitizedPlayer[],
  seatCount: number,
): (SanitizedPlayer | null)[] {
  const seats: (SanitizedPlayer | null)[] = Array.from(
    { length: seatCount },
    () => null,
  );
  for (const p of players) {
    const s = p.seatIndex;
    if (typeof s === 'number' && s >= 0 && s < seatCount) {
      seats[s] = p;
    }
  }
  return seats;
}

const BOARD_STAGGER_MS = 480;
const CARD_FLIP_MS = 420;

function CommunityCardBack() {
  return (
    <div
      className="flex h-8 w-6 flex-col items-center justify-center rounded border border-indigo-400/45 bg-gradient-to-br from-indigo-900 to-slate-900 text-[10px] font-bold text-indigo-200/90 shadow-inner"
      aria-hidden
    >
      ♠
    </div>
  );
}

/**
 * 新发公共牌：先背面，再 3D 翻转亮牌。
 */
function FlippingCommunityCard({
  card,
  index,
  boardLen,
  prevBoardLen,
}: {
  card: GameCard;
  index: number;
  boardLen: number;
  prevBoardLen: number;
}) {
  const isNew =
    boardLen > prevBoardLen && index >= prevBoardLen && index < boardLen;
  const [flipped, setFlipped] = useState(!isNew);

  useEffect(() => {
    if (!isNew) {
      setFlipped(true);
      return;
    }
    setFlipped(false);
    const start = window.setTimeout(() => setFlipped(true), 24);
    return () => window.clearTimeout(start);
  }, [isNew, card.rank, card.suit, index]);

  if (!isNew) {
    return <CommunityCard card={card} />;
  }

  return (
    <div
      className="h-8 w-6 shrink-0"
      style={{ perspective: 520 }}
    >
      <div
        className="relative h-full w-full ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transition: `transform ${CARD_FLIP_MS}ms ease-out`,
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <CommunityCardBack />
        </div>
        <div
          className="absolute inset-0"
          style={{
            transform: 'rotateY(180deg)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <CommunityCard card={card} />
        </div>
      </div>
    </div>
  );
}

/**
 * 全下等一次发满公共牌时，分步展示 flop → turn → river；正常每街只发一张时直接用服务端快照。
 */
function useStaggeredCommunityCards(
  gameState: SanitizedGameState | null,
): readonly GameCard[] {
  const phase = gameState?.gameState ?? null;
  const boardKey =
    gameState?.communityCards
      ?.map((c) => `${c.rank}:${c.suit}`)
      .join('|') ?? '';

  const prevRef = useRef<{
    phase: string | null;
    len: number;
  }>({ phase: null, len: 0 });

  const [override, setOverride] = useState<readonly GameCard[] | null>(null);
  const timersRef = useRef<number[]>([]);

  const auth = gameState?.communityCards ?? [];

  useEffect(() => {
    const clearTimers = () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };

    if (!gameState) {
      clearTimers();
      setOverride(null);
      return;
    }

    const full = [...(gameState.communityCards ?? [])];
    const len = full.length;
    const prev = prevRef.current;

    if (phase !== 'SHOWDOWN' || len !== 5) {
      clearTimers();
      setOverride(null);
      prevRef.current = { phase, len };
      return;
    }

    const jumped =
      len - prev.len >= 2 ||
      (prev.phase !== 'SHOWDOWN' && len === 5 && prev.len <= 3);

    const prevSnapshot = { ...prev };
    prevRef.current = { phase, len };

    if (!jumped) {
      clearTimers();
      setOverride(null);
      return;
    }

    clearTimers();
    const startLen = Math.min(prevSnapshot.len, full.length);
    const steps: number[] = [];
    if (startLen < 3) steps.push(3);
    if (startLen < 4) steps.push(4);
    if (startLen < 5) steps.push(5);

    if (steps.length === 0) {
      setOverride(null);
      return;
    }

    setOverride(full.slice(0, startLen));

    let delay = 0;
    const ids: number[] = [];
    for (const targetLen of steps) {
      delay += BOARD_STAGGER_MS;
      ids.push(
        window.setTimeout(() => {
          setOverride(full.slice(0, targetLen));
        }, delay),
      );
    }
    ids.push(
      window.setTimeout(() => {
        setOverride(null);
      }, delay + BOARD_STAGGER_MS),
    );
    timersRef.current = ids;

    return () => {
      clearTimers();
    };
  }, [gameState, phase, boardKey]);

  return override ?? auth;
}

function CommunityCard({ card }: { card: GameCard }) {
  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
  const s =
    card.suit === 'HEARTS'
      ? '♥'
      : card.suit === 'DIAMONDS'
        ? '♦'
        : card.suit === 'CLUBS'
          ? '♣'
          : '♠';
  return (
    <div
      className={`flex h-8 w-6 flex-col items-center justify-center rounded border border-white/25 bg-white text-[10px] font-bold leading-tight shadow ${red ? 'text-red-600' : 'text-slate-900'}`}
    >
      <span>{card.rank}</span>
      <span className="text-xs leading-none">{s}</span>
    </div>
  );
}

export interface PokerTableProps {
  gameState: SanitizedGameState | null;
  selfPlayerId: string | null;
  roomId: string;
  /** 已在座时空位显示「换座」，否则显示「坐下」 */
  isSeatedAtTable: boolean;
  onSitDown: (seatIndex: number) => void;
  onSeatOccupied: () => void;
  /** 点击自己的头像时打开改名（仅已入座且该位为自己时触发） */
  onSelfAvatarClick?: () => void;
  /** 站起围观（与头像菜单一起提供） */
  onSelfStandUp?: () => void;
}

export function PokerTable({
  gameState,
  selfPlayerId,
  roomId,
  isSeatedAtTable,
  onSitDown,
  onSeatOccupied,
  onSelfAvatarClick,
  onSelfStandUp,
}: PokerTableProps) {
  const positions = useMemo(
    () => computeEllipseSeatPositions(TABLE_SEAT_COUNT),
    [],
  );

  const seatOccupants = useMemo(
    () => occupantsByFixedSeat(gameState?.players ?? [], TABLE_SEAT_COUNT),
    [gameState?.players],
  );

  const dealerPlayerId =
    gameState &&
    gameState.dealerIndex >= 0 &&
    gameState.dealerIndex < gameState.players.length
      ? gameState.players[gameState.dealerIndex]!.id
      : null;

  const currentTurnId = gameState?.currentTurnPlayerId ?? null;
  const phase = gameState?.gameState ?? null;
  const community = useStaggeredCommunityCards(gameState);

  const boardLen = community.length;
  const prevBoardLenRef = useRef(0);
  const prevBoardLen =
    prevBoardLenRef.current > boardLen ? 0 : prevBoardLenRef.current;
  useEffect(() => {
    prevBoardLenRef.current = boardLen;
  }, [boardLen]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mx-auto w-full max-w-md flex-1 min-h-[22rem] sm:min-h-[26rem]">
        {/* 椭圆牌桌 */}
        <div
          className="pointer-events-none absolute left-1/2 top-[46%] w-[92%] max-w-[22rem] -translate-x-1/2 -translate-y-1/2 border-[5px] border-emerald-950/90 bg-gradient-to-b from-emerald-600 via-emerald-800 to-emerald-950 shadow-[inset_0_6px_32px_rgba(0,0,0,0.45),0_16px_48px_rgba(0,0,0,0.55)]"
          style={{
            aspectRatio: '1.55 / 1',
            borderRadius: '50% / 42%',
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/2 top-[46%] w-[88%] max-w-[21rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/15"
          style={{
            aspectRatio: '1.55 / 1',
            borderRadius: '50% / 42%',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
          aria-hidden
        />

        {/* 中央公共牌 + 底池 */}
        <div className="pointer-events-none absolute left-1/2 top-[46%] z-[5] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <div className="flex min-h-[2rem] flex-wrap justify-center gap-1">
            {community.map((c, i) => (
              <FlippingCommunityCard
                key={`${c.rank}-${c.suit}-${i}`}
                card={c}
                index={i}
                boardLen={boardLen}
                prevBoardLen={prevBoardLen}
              />
            ))}
          </div>
          {gameState && gameState.pots.length > 0 ? (
            <div className="rounded-full border border-amber-400/30 bg-black/35 px-3 py-1 font-mono text-xs text-amber-100/95 shadow backdrop-blur-sm">
              底池{' '}
              {gameState.pots.reduce((s, p) => s + p.amount, 0)}
            </div>
          ) : null}
        </div>

        {positions.map((pos, visualIndex) => {
          const occupant = seatOccupants[visualIndex] ?? null;
          const seatNumber = visualIndex + 1;
          const isSelf = !!(
            selfPlayerId &&
            occupant &&
            occupant.id === selfPlayerId
          );
          const emptySeatAction = occupant
            ? undefined
            : isSeatedAtTable
              ? ('move' as const)
              : ('sit' as const);
          const isDealer = !!(occupant && dealerPlayerId === occupant.id);
          const isActing = !!(
            occupant &&
            currentTurnId &&
            currentTurnId === occupant.id
          );
          const actionDeadlineAt =
            isActing && gameState?.actionDeadlineAt != null
              ? gameState.actionDeadlineAt
              : null;

          return (
            <Seat
              key={visualIndex}
              seatNumber={seatNumber}
              position={pos}
              occupant={occupant}
              isSelf={isSelf}
              isDealer={isDealer}
              isActing={isActing}
              gamePhase={phase}
              emptySeatAction={emptySeatAction}
              actionDeadlineAt={actionDeadlineAt}
              onSitDown={onSitDown}
              onSeatOccupied={onSeatOccupied}
              onSelfAvatarClick={onSelfAvatarClick}
              onSelfStandUp={onSelfStandUp}
            />
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        房间 {roomId}，共 {TABLE_SEAT_COUNT} 个座位
      </p>
    </div>
  );
}
