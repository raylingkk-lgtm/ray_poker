import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashRoomPassword(plain: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, 64);
  return { salt, hash: derived.toString('hex') };
}

export function verifyRoomPassword(plain: string, salt: string, hashHex: string): boolean {
  try {
    const derived = scryptSync(plain, salt, 64);
    const stored = Buffer.from(hashHex, 'hex');
    if (derived.length !== stored.length) return false;
    return timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}
