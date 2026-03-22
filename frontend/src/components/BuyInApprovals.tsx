import type { PendingBuyInView, SanitizedPlayer } from '../types/game';

export interface BuyInApprovalsProps {
  pending: readonly PendingBuyInView[];
  players: readonly SanitizedPlayer[];
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

function nick(
  players: readonly SanitizedPlayer[],
  playerId: string,
): string {
  return players.find((p) => p.id === playerId)?.nickname ?? playerId;
}

export function BuyInApprovals({
  pending,
  players,
  onApprove,
  onReject,
}: BuyInApprovalsProps) {
  if (pending.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-xs text-white/45">暂无待审买入</p>
    );
  }

  return (
    <ul className="max-h-56 divide-y divide-white/10 overflow-y-auto text-sm">
      {pending.map((req) => (
        <li
          key={req.id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-white/90">
              {nick(players, req.playerId)}
            </div>
            <div className="font-mono text-xs text-amber-200/80">
              +{req.amount} 筹码
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              className="rounded-md border border-emerald-500/40 bg-emerald-900/40 px-2.5 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-800/50"
              onClick={() => onApprove(req.id)}
            >
              同意
            </button>
            <button
              type="button"
              className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
              onClick={() => onReject(req.id)}
            >
              拒绝
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
