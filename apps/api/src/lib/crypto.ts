import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** New UUIDv4 primary key. */
export const newId = (): string => randomUUID();

/** 256-bit random token, URL-safe. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** Tokens are stored only as SHA-256 hashes, so a database leak cannot be replayed as sessions. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

// Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON_OPTS);

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}

/** A real hash used to equalise timing when the account does not exist (prevents user enumeration). */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equaliser-not-a-real-password');
  await verifyPassword(await dummyHash, password);
}
