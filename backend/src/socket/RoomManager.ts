import type { HostTransferredEvent, RoomCreateOptions } from './Room.js';
import { Room } from './Room.js';

export type RoomCreateHooks = {
  onHostTransferred?: (e: HostTransferredEvent) => void;
};

/**
 * 多房间注册表：创建、查询、销毁房间。
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private hostTransferHandler?: (e: HostTransferredEvent) => void;
  private roomStateBroadcaster?: (room: Room) => void;

  /** 全局房主变更通知（例如向房间广播 `admin_changed`） */
  registerHostTransferredHandler(handler: (e: HostTransferredEvent) => void): void {
    this.hostTransferHandler = handler;
  }

  /** 牌局状态变更后广播（托管超时、自动下一手等不经 socket handler 的路径） */
  registerRoomStateBroadcaster(fn: (room: Room) => void): void {
    this.roomStateBroadcaster = fn;
  }

  createRoom(opts: RoomCreateOptions, hooks?: RoomCreateHooks): Room {
    if (this.rooms.has(opts.roomId)) {
      throw new Error(`RoomManager: room "${opts.roomId}" already exists`);
    }
    const room = new Room({
      ...opts,
      onHostTransferred: (e) => {
        hooks?.onHostTransferred?.(e);
        this.hostTransferHandler?.(e);
      },
      onRoomStateChanged: (r) => {
        this.roomStateBroadcaster?.(r);
      },
    });
    this.rooms.set(opts.roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** 销毁房间并清理定时器 */
  removeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.destroy();
      this.rooms.delete(roomId);
    }
  }

  listRoomIds(): string[] {
    return [...this.rooms.keys()];
  }

  /** 进行中房间摘要（供 GET /api/rooms） */
  listActiveRoomSummaries(): ReturnType<Room['getListingSummary']>[] {
    return [...this.rooms.values()].map((room) => room.getListingSummary());
  }
}
