import { useEffect, useRef, useState } from 'react';
import type { GameCard, PokerGamePhase, SanitizedPlayer } from '../types/game';

const ACTING_DURATION_MS = 60_000;
const RING_R = 34;
const RING_STROKE = 3;
const RING_C = 2 * Math.PI * RING_R;

function cardLabel(c: GameCard): string {
  const s =
    c.suit === 'HEARTS'
      ? '♥'
      : c.suit === 'DIAMONDS'
        ? '♦'
        : c.suit === 'CLUBS'
          ? '♣'
          : '♠';
  return `${c.rank}${s}`;
}

function PlayingCardBack({ small }: { small?: boolean }) {
  const cls = small ? 'h-8 w-5 text-[8px]' : 'h-9 w-6 text-[9px]';
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded border border-indigo-400/50 bg-gradient-to-br from-indigo-900 to-slate-900 font-bold text-indigo-200/90 shadow-inner ${cls}`}
      aria-hidden
    >
      ♠
    </div>
  );
}

function PlayingCardFace({ card, small }: { card: GameCard; small?: boolean }) {
  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
  const cls = small ? 'h-8 w-5 text-[10px]' : 'h-9 w-6 text-[11px]';
  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center rounded border border-white/20 bg-white font-semibold leading-none shadow ${cls} ${red ? 'text-red-600' : 'text-slate-900'}`}
    >
      {cardLabel(card)}
    </div>
  );
}

function ActingRing({
  active,
  startedAt,
  deadlineAt,
}: {
  active: boolean;
  startedAt: number | null;
  deadlineAt: number | null;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  let remaining: number;
  if (deadlineAt != null) {
    remaining = Math.max(0, deadlineAt - Date.now());
  } else if (startedAt != null) {
    remaining = Math.max(0, ACTING_DURATION_MS - (Date.now() - startedAt));
  } else {
    remaining = ACTING_DURATION_MS;
  }
  const frac = Math.min(1, Math.max(0, remaining / ACTING_DURATION_MS));
  const dash = RING_C * frac;
  const urgent = remaining <= 10_000;
  const sec = Math.ceil(remaining / 1000);

  const strokeColor = urgent
    ? '#f87171'
    : remaining <= 30_000
      ? '#fbbf24'
      : '#34d399';

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center"
      aria-live="polite"
    >
      <svg
        className={urgent ? 'animate-pulse' : ''}
        width={88}
        height={88}
        aria-hidden
      >
        <circle
          cx={44}
          cy={44}
          r={RING_R}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={44}
          cy={44}
          r={RING_R}
          fill="none"
          stroke={strokeColor}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${RING_C}`}
          transform="rotate(-90 44 44)"
          style={{ transition: 'stroke 0.2s ease' }}
        />
      </svg>
      <span className="-mt-1 text-[10px] font-semibold tabular-nums text-white/90">
        {sec}s
      </span>
    </div>
  );
}

export interface SeatProps {
  /** 1..10 展示号 */
  seatNumber: number;
  position: { topPct: number; leftPct: number };
  occupant: SanitizedPlayer | null;
  isSelf: boolean;
  isDealer: boolean;
  isActing: boolean;
  gamePhase: PokerGamePhase | null;
  /** 空位时可执行：入座或换座 */
  emptySeatAction?: 'sit' | 'move';
  /** 服务端行动截止时间（与托管一致）；无则仅靠本地 60s 估算 */
  actionDeadlineAt: number | null;
  onSitDown: (seatIndex: number) => void;
  onSeatOccupied: () => void;
  onSelfAvatarClick?: () => void;
  /** 站起围观；与头像菜单一并展示 */
  onSelfStandUp?: () => void;
}

export function Seat({
  seatNumber,
  position,
  occupant,
  isSelf,
  isDealer,
  isActing,
  gamePhase,
  emptySeatAction,
  actionDeadlineAt,
  onSitDown,
  onSeatOccupied,
  onSelfAvatarClick,
  onSelfStandUp,
}: SeatProps) {
  const [actingStartedAt, setActingStartedAt] = useState<number | null>(null);
  const [selfMenuOpen, setSelfMenuOpen] = useState(false);
  const selfMenuWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selfMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = selfMenuWrapRef.current;
      if (el && !el.contains(e.target as Node)) setSelfMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [selfMenuOpen]);

  useEffect(() => {
    if (isActing) {
      setActingStartedAt(Date.now());
    } else {
      setActingStartedAt(null);
    }
  }, [isActing]);

  const handleSitClick = () => {
    if (occupant) {
      onSeatOccupied();
      return;
    }
    if (!emptySeatAction) return;
    onSitDown(seatNumber - 1);
  };

  const inStreetPhase =
    gamePhase === 'PRE_FLOP' ||
    gamePhase === 'FLOP' ||
    gamePhase === 'TURN' ||
    gamePhase === 'RIVER';

  const stillInPot =
    occupant &&
    occupant.status !== 'FOLDED' &&
    occupant.status !== 'SITTING_OUT';

  const showRealCards =
    !!(
      occupant?.holeCards &&
      (isSelf ||
        gamePhase === 'SHOWDOWN' ||
        gamePhase === 'FINAL_HAND')
    );

  const showBacks =
    !!(
      occupant &&
      stillInPot &&
      !showRealCards &&
      !isSelf &&
      inStreetPhase
    );

  const initial = occupant?.nickname?.charAt(0)?.toUpperCase() ?? '?';

  return (
    <div
      className="absolute z-10 w-[4.5rem] -translate-x-1/2 -translate-y-1/2 sm:w-[5rem]"
      style={{ left: `${position.leftPct}%`, top: `${position.topPct}%` }}
    >
      <div
        className={`relative flex flex-col items-center gap-1 ${
          isActing ? 'drop-shadow-[0_0_12px_rgba(52,211,153,0.85)]' : ''
        }`}
      >
        <div
          className={`relative flex shrink-0 items-center justify-center ${
            isActing
              ? 'h-[5.5rem] w-[5.5rem] sm:h-[5.75rem] sm:w-[5.75rem]'
              : ''
          }`}
        >
          <ActingRing
            active={isActing}
            startedAt={actingStartedAt}
            deadlineAt={actionDeadlineAt}
          />
          <div className="relative z-[2]">
            {occupant ? (
              <>
                {isSelf && onSelfStandUp ? (
                  <div className="relative" ref={selfMenuWrapRef}>
                    <button
                      type="button"
                      aria-label="座位菜单"
                      aria-expanded={selfMenuOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelfMenuOpen((o) => !o);
                      }}
                      className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border-2 text-lg font-bold shadow-lg transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-emerald-400/70 sm:h-14 sm:w-14 ${
                        isActing
                          ? 'border-emerald-400 bg-emerald-900/80 ring-2 ring-emerald-400/60'
                          : 'border-white/25 bg-gradient-to-br from-slate-600 to-slate-800'
                      }`}
                    >
                      {initial}
                    </button>
                    {selfMenuOpen ? (
                      <div
                        className="absolute left-1/2 top-full z-[40] mt-1 w-max min-w-[7.5rem] -translate-x-1/2 rounded-lg border border-white/15 bg-gray-950/98 py-1 shadow-xl backdrop-blur-sm"
                        role="menu"
                      >
                        {onSelfAvatarClick ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-2 text-left text-[11px] font-medium text-white/90 hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelfMenuOpen(false);
                              onSelfAvatarClick();
                            }}
                          >
                            修改昵称
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2 text-left text-[11px] font-medium text-amber-100/95 hover:bg-white/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelfMenuOpen(false);
                            onSelfStandUp();
                          }}
                        >
                          站起围观
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : isSelf && onSelfAvatarClick ? (
                  <button
                    type="button"
                    aria-label="修改昵称"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelfAvatarClick();
                    }}
                    className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border-2 text-lg font-bold shadow-lg transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-emerald-400/70 sm:h-14 sm:w-14 ${
                      isActing
                        ? 'border-emerald-400 bg-emerald-900/80 ring-2 ring-emerald-400/60'
                        : 'border-white/25 bg-gradient-to-br from-slate-600 to-slate-800'
                    }`}
                  >
                    {initial}
                  </button>
                ) : (
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-bold shadow-lg sm:h-14 sm:w-14 ${
                      isActing
                        ? 'border-emerald-400 bg-emerald-900/80 ring-2 ring-emerald-400/60'
                        : 'border-white/25 bg-gradient-to-br from-slate-600 to-slate-800'
                    }`}
                  >
                    {initial}
                  </div>
                )}
                {isDealer ? (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-500 text-[10px] font-black text-amber-950 shadow"
                    title="庄家"
                  >
                    D
                  </span>
                ) : null}
              </>
            ) : emptySeatAction ? (
              <button
                type="button"
                onClick={handleSitClick}
                className="rounded-full border border-dashed border-emerald-400/50 bg-emerald-950/40 px-2 py-2 text-[10px] font-medium text-emerald-200/90 hover:bg-emerald-900/50 sm:text-xs"
              >
                {emptySeatAction === 'move' ? '换座' : '坐下'}
              </button>
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/20 sm:h-14 sm:w-14"
                aria-hidden
              />
            )}
          </div>
        </div>

        {occupant ? (
          <>
            <div className="max-w-full truncate text-center text-[10px] font-medium text-white/90 sm:text-xs">
              {occupant.nickname}
            </div>
            <div className="font-mono text-[10px] text-amber-200/90 sm:text-[11px]">
              {occupant.stack}
            </div>
            {occupant.status === 'FOLDED' && occupant.stack === 0 ? (
              <span className="text-[9px] text-amber-300/90">等待买入</span>
            ) : occupant.status === 'FOLDED' ? (
              <span className="text-[9px] text-red-400/80">已弃牌</span>
            ) : null}
            <div className="flex gap-0.5">
              {showRealCards && occupant.holeCards ? (
                <>
                  <PlayingCardFace card={occupant.holeCards[0]} small />
                  <PlayingCardFace card={occupant.holeCards[1]} small />
                </>
              ) : showBacks ? (
                <>
                  <PlayingCardBack small />
                  <PlayingCardBack small />
                </>
              ) : null}
            </div>
          </>
        ) : (
          <span className="text-[9px] text-white/35">#{seatNumber}</span>
        )}
      </div>
    </div>
  );
}
