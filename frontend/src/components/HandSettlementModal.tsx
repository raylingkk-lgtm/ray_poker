import { useMemo } from 'react';
import type { GameCard, LastHandSettlementView } from '../types/game';

function potLabel(level: number): string {
  return level === 0 ? '主池' : `边池 ${level}`;
}

function cardLine(cards: readonly GameCard[]): string {
  if (cards.length === 0) return '—';
  return cards
    .map((c) => {
      const s =
        c.suit === 'HEARTS'
          ? '♥'
          : c.suit === 'DIAMONDS'
            ? '♦'
            : c.suit === 'CLUBS'
              ? '♣'
              : '♠';
      return `${c.rank}${s}`;
    })
    .join(' ');
}

export interface HandSettlementModalProps {
  settlement: LastHandSettlementView;
  communityCards: readonly GameCard[];
  onDismiss: () => void;
}

export function HandSettlementModal({
  settlement,
  communityCards,
  onDismiss,
}: HandSettlementModalProps) {
  const totalsByPlayer = useMemo(() => {
    const m = new Map<string, { nickname: string; total: number }>();
    for (const a of settlement.awards) {
      const cur = m.get(a.playerId) ?? { nickname: a.nickname, total: 0 };
      cur.total += a.amount;
      m.set(a.playerId, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [settlement.awards]);

  return (
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hand-settlement-title"
    >
      <div className="mx-2 mb-6 w-full max-w-md rounded-2xl border border-white/15 bg-gray-950 shadow-2xl sm:mb-0">
        <div className="border-b border-white/10 px-4 py-3">
          <h2
            id="hand-settlement-title"
            className="text-center text-lg font-semibold text-white"
          >
            本手结算
          </h2>
          <p className="mt-1 text-center text-xs text-white/45">
            第 {settlement.handNumber} 手 · 公共牌 {cardLine(communityCards)}
          </p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
          {totalsByPlayer.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/50">暂无分池记录</p>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-400/80">
                赢取筹码
              </p>
              <ul className="mb-4 space-y-2">
                {totalsByPlayer.map(([id, { nickname, total }]) => (
                  <li
                    key={id}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <span className="font-medium text-white/90">{nickname}</span>
                    <span className="font-mono text-lg font-semibold text-emerald-400">
                      +{total}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
                各池分配
              </p>
              <ul className="space-y-1.5 text-sm">
                {settlement.awards.map((a, i) => (
                  <li
                    key={`${a.playerId}-${a.potLevel}-${i}`}
                    className="flex justify-between gap-2 text-white/75"
                  >
                    <span>
                      {potLabel(a.potLevel)} → {a.nickname}
                    </span>
                    <span className="shrink-0 font-mono text-amber-200/90">
                      +{a.amount}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            className="w-full rounded-xl bg-emerald-700/80 py-3 text-sm font-semibold text-white hover:bg-emerald-600/80"
            onClick={onDismiss}
          >
            知道了
          </button>
          <p className="mt-2 text-center text-[10px] text-white/35">
            约 4.5 秒后将自动开始下一手（两人均在线时）
          </p>
        </div>
      </div>
    </div>
  );
}
