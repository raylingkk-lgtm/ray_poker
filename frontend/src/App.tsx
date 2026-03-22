import { useMemo } from 'react';
import { PortraitLockOverlay } from './components/PortraitLockOverlay';
import { useIsLandscape } from './hooks/usePortraitLock';
import { GameRoom } from './pages/GameRoom';

function useLaunchTableParams() {
  return useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      roomId: q.get('room') ?? q.get('roomId') ?? 'demo',
      playerId: q.get('player') ?? q.get('playerId') ?? 'host-1',
    };
  }, []);
}

export default function App() {
  const landscape = useIsLandscape();
  const { roomId, playerId } = useLaunchTableParams();

  return (
    <>
      {landscape ? <PortraitLockOverlay /> : null}
      {!landscape ? (
        <div className="min-h-full min-w-full">
          <GameRoom roomId={roomId} playerId={playerId} />
        </div>
      ) : null}
    </>
  );
}
