import { useCallback, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { SettlementTableBlock } from './SettlementTableBlock';
import type { GameEndedPayload } from '../types/game';

export interface SettlementModalProps {
  payload: GameEndedPayload;
  onClose: () => void;
}

export function SettlementModal({ payload, onClose }: SettlementModalProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const saveImage = useCallback(async () => {
    const el = tableRef.current;
    if (!el) return;
    setBusy(true);
    setErr(null);
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#030712',
        scale: Math.min(2, (window.devicePixelRatio || 1) * 1.5),
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `ray-poker-settlement-${payload.roomId}.png`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'EXPORT_FAILED');
    } finally {
      setBusy(false);
    }
  }, [payload.roomId]);

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-title"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 id="settlement-title" className="text-base font-semibold text-white">
          战绩结算
        </h2>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          关闭
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <SettlementTableBlock
          containerRef={tableRef}
          roomId={payload.roomId}
          rows={payload.rows}
        />
      </div>

      <div className="shrink-0 border-t border-white/10 bg-gray-950/90 px-4 py-3">
        {err ? (
          <p className="mb-2 text-center text-xs text-red-400/90">{err}</p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="mx-auto block w-full max-w-md rounded-xl border border-emerald-500/40 bg-emerald-800/50 py-3 text-sm font-semibold text-emerald-50 hover:bg-emerald-700/50 disabled:opacity-50"
          onClick={() => void saveImage()}
        >
          {busy ? '生成中…' : '保存到相册（导出 PNG）'}
        </button>
        <p className="mt-2 text-center text-[10px] text-white/35">
          移动端可长按图片保存；桌面端将下载 PNG 文件。
        </p>
      </div>
    </div>
  );
}
