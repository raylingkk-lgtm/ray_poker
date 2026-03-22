/** Backend-specific types; prefer shared types for wire protocol. */

export type SocketMeta = {
  connectedAt: number;
};

export * from './poker.js';
