import { useEffect, useState } from 'react';

/**
 * 检测是否处于横屏（需提示用户竖屏游玩）。
 * 结合视口宽高与 orientation / screen.orientation。
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(() => computeLandscape());

  useEffect(() => {
    const update = () => setLandscape(computeLandscape());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const mq = window.matchMedia?.('(orientation: landscape)');
    mq?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);

  return landscape;
}

function computeLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w > h) return true;
  const o = window.orientation;
  if (typeof o === 'number' && (o === 90 || o === -90)) return true;
  const so = window.screen?.orientation?.type;
  if (so === 'landscape-primary' || so === 'landscape-secondary') return true;
  return false;
}
