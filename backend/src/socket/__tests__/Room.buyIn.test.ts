import { describe, expect, it } from 'vitest';
import { Room } from '../Room.js';
import { PlayerStatus } from '../../types/poker.js';

describe('Room buy-in approval', () => {
  it('房主批准后目标玩家 stack 立即增加（供快照 occupant.stack 展示）', () => {
    const room = new Room({
      roomId: 'r1',
      hostPlayerId: 'host',
      smallBlind: 1,
      bigBlind: 2,
      initialPlayers: [
        {
          id: 'host',
          nickname: 'host',
          stack: 1000,
          bet: 0,
          status: PlayerStatus.Alive,
          seatIndex: 0,
        },
        {
          id: 'guest',
          nickname: 'guest',
          stack: 0,
          bet: 0,
          status: PlayerStatus.Alive,
          seatIndex: 1,
        },
      ],
    });

    const { ok, requestId } = room.requestBuyIn('guest', 300);
    expect(ok).toBe(true);
    expect(requestId).toBeDefined();

    const approved = room.approveBuyIn(requestId!, 'host');
    expect(approved.ok).toBe(true);

    const guest = room.engine.getPlayers().find((p) => p.id === 'guest');
    expect(guest?.stack).toBe(300);
    expect(room.getApprovedCreditsPending().length).toBe(0);
  });
});
