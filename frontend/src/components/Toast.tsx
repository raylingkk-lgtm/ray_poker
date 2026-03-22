import { useEffect } from 'react';

export function Toast({
  message,
  onDismiss,
  durationMs = 2800,
}: {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-24 left-1/2 z-[200] max-w-[min(90vw,20rem)] -translate-x-1/2 rounded-lg border border-white/15 bg-gray-950/95 px-4 py-2.5 text-center text-sm text-white shadow-xl backdrop-blur-sm"
      role="status"
    >
      {message}
    </div>
  );
}
