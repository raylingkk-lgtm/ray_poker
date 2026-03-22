import 'socket.io';

declare module 'socket.io' {
  interface SocketData {
    roomId?: string;
    playerId?: string;
  }
}
