import type { Ref } from 'react';
import type { SettlementRow } from '../types/game';

export interface SettlementTableBlockProps {
  roomId: string;
  rows: readonly SettlementRow[];
  /** 供 html2canvas 包裹导出 */
  containerRef?: Ref<HTMLDivElement>;
}

export function SettlementTableBlock({
  roomId,
  rows,
  containerRef,
}: SettlementTableBlockProps) {
  return (
    <div
      ref={containerRef}
      className="mx-auto max-w-md rounded-xl border border-white/10 bg-gray-950 p-4 shadow-2xl"
    >
      <p className="mb-3 text-center text-xs text-white/50">
        房间 <span className="font-mono text-white/70">{roomId}</span>
      </p>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/15 text-xs uppercase tracking-wide text-white/45">
            <th className="pb-2 pr-2 font-medium">玩家</th>
            <th className="pb-2 pr-2 text-right font-medium">总买入</th>
            <th className="pb-2 pr-2 text-right font-medium">剩余筹码</th>
            <th className="pb-2 text-right font-medium">盈亏</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.playerId}
              className="border-b border-white/5 text-white/90 last:border-0"
            >
              <td className="py-2 pr-2 font-medium">{r.nickname}</td>
              <td className="py-2 pr-2 text-right font-mono text-white/80">
                {r.totalBuyIn}
              </td>
              <td className="py-2 pr-2 text-right font-mono text-white/80">
                {r.finalStack}
              </td>
              <td
                className={`py-2 text-right font-mono font-semibold ${
                  r.profit > 0
                    ? 'text-emerald-400'
                    : r.profit < 0
                      ? 'text-red-400'
                      : 'text-white/60'
                }`}
              >
                {r.profit > 0 ? `+${r.profit}` : r.profit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
