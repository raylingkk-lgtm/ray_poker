/** Shared types, enums, and constants used by frontend and backend. */

export enum GamePhase {
  Idle = 'idle',
  Waiting = 'waiting',
  Preflop = 'preflop',
  Flop = 'flop',
  Turn = 'turn',
  River = 'river',
  Showdown = 'showdown',
}
