export function PortraitLockOverlay() {
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black px-6 text-center"
      role="alertdialog"
      aria-live="polite"
      aria-label="请竖屏游玩"
    >
      <p className="max-w-sm text-lg font-medium leading-relaxed text-white">
        为了最佳游戏体验，请锁定竖屏方向游玩
      </p>
    </div>
  );
}
