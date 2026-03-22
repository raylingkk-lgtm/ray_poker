import { useEffect, useMemo, useState } from 'react';
import type {
  PlayerActionPayload,
  SanitizedGameState,
  SanitizedPlayer,
} from '../../types/game';

export interface ActionPanelProps {
  roomId: string;
  gameState: SanitizedGameState | null;
  selfPlayerId: string | null;
  selfPlayer: SanitizedPlayer | null;
  onPlayerAction: (p: PlayerActionPayload) => void;
}

function deriveHighestBet(gs: SanitizedGameState): number {
  if (typeof gs.currentHighestBet === 'number') return gs.currentHighestBet;
  return gs.players.reduce((m, p) => Math.max(m, p.bet), 0);
}

function deriveMinRaiseTo(gs: SanitizedGameState, high: number): number {
  if (typeof gs.minRaiseTo === 'number') return gs.minRaiseTo;
  const bb = gs.bigBlind;
  if (high === 0) return bb;
  return Math.max(high + bb, high * 2);
}

function computeCustomBetRange(
  gs: SanitizedGameState,
  self: SanitizedPlayer,
): { mode: 'BET' | 'RAISE'; min: number; max: number } | null {
  const high = deriveHighestBet(gs);
  const minRaiseTo = deriveMinRaiseTo(gs, high);
  const bb = gs.bigBlind;
  const street = self.bet;
  const stack = self.stack;
  const maxTotal = street + stack;

  if (high === 0) {
    const minOpen = Math.max(minRaiseTo, bb * 2);
    if (stack < minOpen) return null;
    return { mode: 'BET', min: minOpen, max: stack };
  }

  if (maxTotal <= high) return null;
  if (maxTotal < minRaiseTo) return null;
  return { mode: 'RAISE', min: minRaiseTo, max: maxTotal };
}

type QuickKind = 'm2' | 'm3' | 'm4';

function quickActionPayload(
  kind: QuickKind,
  gs: SanitizedGameState,
  self: SanitizedPlayer,
  roomId: string,
): PlayerActionPayload | null {
  const bb = gs.bigBlind;
  const high = deriveHighestBet(gs);
  const minRaiseTo = deriveMinRaiseTo(gs, high);
  const street = self.bet;
  const stack = self.stack;
  const maxTotal = street + stack;
  const mult = kind === 'm2' ? 2 : kind === 'm3' ? 3 : 4;

  if (high === 0) {
    const raw = mult * bb;
    const amount = Math.min(stack, Math.max(bb, raw));
    if (stack < bb) return null;
    return { roomId, action: 'BET', amount };
  }

  if (maxTotal <= high) return null;

  if (maxTotal < minRaiseTo) {
    return { roomId, action: 'ALL_IN' };
  }

  const idealTotal = mult * high;
  const targetTotal = Math.min(
    maxTotal,
    Math.max(minRaiseTo, idealTotal),
  );

  if (targetTotal <= high) {
    return { roomId, action: 'ALL_IN' };
  }

  return { roomId, action: 'RAISE', amount: targetTotal };
}

/** 将 2×/3×/4× 预设映射为滑块目标金额（总注）；All-in 用 max */
function presetSliderAmount(
  kind: QuickKind,
  gs: SanitizedGameState,
  self: SanitizedPlayer,
  roomId: string,
  customRange: { min: number; max: number } | null,
): number | null {
  const p = quickActionPayload(kind, gs, self, roomId);
  if (!p) return null;
  if (p.action === 'ALL_IN') return customRange?.max ?? null;
  if (p.action === 'BET' || p.action === 'RAISE') {
    const v = p.amount ?? 0;
    if (!customRange) return null;
    return Math.min(customRange.max, Math.max(customRange.min, v));
  }
  return null;
}

export function ActionPanel({
  roomId,
  gameState,
  selfPlayerId,
  selfPlayer,
  onPlayerAction,
}: ActionPanelProps) {
  const betting = useMemo(() => {
    if (!gameState) return null;
    const high = deriveHighestBet(gameState);
    const minRaiseTo = deriveMinRaiseTo(gameState, high);
    return { high, minRaiseTo, bb: gameState.bigBlind };
  }, [gameState]);

  const customRange = useMemo(() => {
    if (!gameState || !selfPlayer) return null;
    return computeCustomBetRange(gameState, selfPlayer);
  }, [gameState, selfPlayer]);

  const [sliderVal, setSliderVal] = useState(0);

  const noBettingPhase =
    gameState?.gameState === 'SHOWDOWN' ||
    gameState?.gameState === 'FINAL_HAND';

  const canAct = Boolean(
    gameState &&
      selfPlayer &&
      selfPlayerId &&
      gameState.currentTurnPlayerId === selfPlayerId &&
      selfPlayer.status === 'ALIVE',
  );

  useEffect(() => {
    if (customRange) {
      setSliderVal(customRange.min);
    }
  }, [
    customRange?.min,
    customRange?.max,
    gameState?.currentTurnPlayerId,
    selfPlayer?.bet,
    selfPlayer?.stack,
  ]);

  const toCall =
    gameState && selfPlayer && betting
      ? Math.max(0, betting.high - selfPlayer.bet)
      : 0;

  const canCheck = canAct && toCall === 0;
  const canCall = canAct && toCall > 0 && selfPlayer && selfPlayer.stack >= 0;
  const canFold = canAct;

  const quick = useMemo(() => {
    if (!gameState || !selfPlayer || !canAct || !betting) {
      return { m2: null, m3: null, m4: null, allIn: true } as const;
    }
    return {
      m2: quickActionPayload('m2', gameState, selfPlayer, roomId),
      m3: quickActionPayload('m3', gameState, selfPlayer, roomId),
      m4: quickActionPayload('m4', gameState, selfPlayer, roomId),
      allIn: selfPlayer.stack > 0,
    };
  }, [gameState, selfPlayer, canAct, betting, roomId]);

  const submitCustomAmount = () => {
    if (!customRange) return;
    const v = Math.min(
      customRange.max,
      Math.max(customRange.min, sliderVal),
    );
    if (customRange.mode === 'BET') {
      onPlayerAction({ roomId, action: 'BET', amount: v });
      return;
    }
    if (v >= customRange.max) {
      onPlayerAction({ roomId, action: 'ALL_IN' });
      return;
    }
    onPlayerAction({ roomId, action: 'RAISE', amount: v });
  };

  const applyPreset = (kind: QuickKind) => {
    if (!gameState || !selfPlayer || !customRange) return;
    const v = presetSliderAmount(
      kind,
      gameState,
      selfPlayer,
      roomId,
      customRange,
    );
    if (v != null) setSliderVal(v);
  };

  const applyAllInPreset = () => {
    if (!customRange || !quick.allIn) return;
    setSliderVal(customRange.max);
  };

  if (!gameState || !selfPlayer) {
    return (
      <div className="shrink-0 border-t border-white/10 bg-black/40 px-3 py-3">
        <p className="text-center text-xs text-white/45">入座后可操作</p>
      </div>
    );
  }

  if (noBettingPhase) {
    return (
      <div className="shrink-0 border-t border-white/10 bg-black/40 px-3 py-3">
        <p className="text-center text-xs text-white/50">本手已结束，等待下一手</p>
      </div>
    );
  }

  if (!canAct) {
    return (
      <div className="shrink-0 border-t border-white/10 bg-black/40 px-3 py-3">
        <p className="text-center text-xs text-white/50">等待其他玩家行动…</p>
      </div>
    );
  }

  const primaryBetLabel =
    customRange?.mode === 'BET' ? `Bet ${sliderVal}` : `Raise to ${sliderVal}`;

  return (
    <div className="shrink-0 border-t border-white/10 bg-black/50 px-2 py-2">
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        <div className="flex flex-wrap justify-center gap-2">
          {canFold ? (
            <button
              type="button"
              className="min-w-[4.25rem] rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white shadow hover:bg-red-500"
              onClick={() => onPlayerAction({ roomId, action: 'FOLD' })}
            >
              Fold
            </button>
          ) : null}
          {canCheck ? (
            <button
              type="button"
              className="min-w-[4.25rem] rounded-lg bg-slate-600 px-3 py-2.5 text-sm font-semibold text-white shadow hover:bg-slate-500"
              onClick={() => onPlayerAction({ roomId, action: 'CHECK' })}
            >
              Check
            </button>
          ) : null}
          {canCall && toCall > 0 ? (
            <button
              type="button"
              className="min-w-[4.25rem] rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow hover:bg-amber-400"
              onClick={() => onPlayerAction({ roomId, action: 'CALL' })}
            >
              Call {toCall}
            </button>
          ) : null}
        </div>

        {customRange && betting ? (
          <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-950/25 px-2 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-white/55">
              <span>
                {customRange.mode === 'BET' ? 'Bet' : 'Raise to'}（{customRange.min}{' '}
                – {customRange.max}）
              </span>
              <span className="shrink-0 font-mono text-sm font-semibold text-emerald-300">
                {sliderVal}
              </span>
            </div>
            <input
              type="range"
              min={customRange.min}
              max={customRange.max}
              step={1}
              value={sliderVal}
              aria-label="Bet or raise amount"
              onChange={(e) => setSliderVal(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-500"
            />
            <div className="flex flex-wrap items-stretch justify-center gap-1.5">
              {(['m2', 'm3', 'm4'] as const).map((k) => {
                const payload = quick[k];
                const mult = k === 'm2' ? 2 : k === 'm3' ? 3 : 4;
                const disabled = !payload;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={disabled}
                    title={
                      disabled
                        ? '筹码不足或未达到最小加注'
                        : `Set slider to ${mult}× preset`
                    }
                    className="min-w-[3rem] rounded-lg border border-white/35 bg-transparent px-2 py-2 text-xs font-semibold text-white/90 disabled:cursor-not-allowed disabled:opacity-35 hover:enabled:border-white/55 hover:enabled:bg-white/5"
                    onClick={() => applyPreset(k)}
                  >
                    {mult}×
                  </button>
                );
              })}
              <button
                type="button"
                disabled={!quick.allIn}
                className="min-w-[3.25rem] rounded-lg border border-rose-400/50 bg-transparent px-2 py-2 text-xs font-semibold text-rose-100/90 disabled:opacity-35 hover:enabled:border-rose-300/70 hover:enabled:bg-rose-500/10"
                onClick={() => applyAllInPreset()}
              >
                All-in
              </button>
              <button
                type="button"
                className="min-w-[6.5rem] flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow hover:bg-emerald-500 sm:min-w-[8rem]"
                onClick={() => submitCustomAmount()}
              >
                {primaryBetLabel}
              </button>
            </div>
          </div>
        ) : quick.allIn ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="rounded-lg border border-rose-400/50 bg-transparent px-4 py-2 text-xs font-semibold text-rose-100/90 hover:bg-rose-500/10"
              onClick={() => onPlayerAction({ roomId, action: 'ALL_IN' })}
            >
              All-in
            </button>
          </div>
        ) : null}

        {betting ? (
          <p className="text-center text-[10px] text-white/35">
            最高注 {betting.high} · 最小加注至 {betting.minRaiseTo} · 跟注额 {toCall}
          </p>
        ) : null}
      </div>
    </div>
  );
}
