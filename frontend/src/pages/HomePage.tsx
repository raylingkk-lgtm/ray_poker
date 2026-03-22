import { GamePhase } from '@ray-poker/shared';
import { useSocket } from '../hooks/useSocket';

export function HomePage() {
  const { status, lastAckAt, lastPongAt } = useSocket();

  return (
    <div className="flex min-h-full flex-col bg-slate-950 px-4 py-6 text-slate-100">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ray Poker</h1>
        <p className="mt-1 text-sm text-slate-400">H5 脚手架 · Socket 心跳联调</p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-medium text-slate-300">实时连接</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">状态</dt>
            <dd className="font-mono text-emerald-400">{status}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">连接 ack 时间</dt>
            <dd className="font-mono text-slate-300">
              {lastAckAt != null ? new Date(lastAckAt).toLocaleTimeString() : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">最近 pong</dt>
            <dd className="font-mono text-slate-300">
              {lastPongAt != null ? new Date(lastPongAt).toLocaleTimeString() : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="text-sm font-medium text-slate-300">共享包示例</h2>
        <p className="mt-2 text-xs text-slate-500">
          GamePhase 来自 <code className="text-slate-400">@ray-poker/shared</code>
        </p>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {Object.values(GamePhase).map((phase) => (
            <li
              key={phase}
              className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 font-mono text-slate-300"
            >
              {phase}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
