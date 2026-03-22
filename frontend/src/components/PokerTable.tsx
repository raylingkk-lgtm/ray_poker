import { useMemo } from 'react';
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
}

export function PokerTable({
  gameState,
  selfPlayerId,
  roomId,
  isSeatedAtTable,
  onSitDown,
  onSeatOccupied,
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
  const community = gameState?.communityCards ?? [];

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
              <CommunityCard key={`${c.rank}-${c.suit}-${i}`} card={c} />
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
              onSitDown={onSitDown}
              onSeatOccupied={onSeatOccupied}
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
