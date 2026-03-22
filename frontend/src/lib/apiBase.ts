export function getApiBase(): string {
  return import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';
}
