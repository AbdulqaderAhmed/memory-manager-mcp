/**
 * Low-level filesystem helpers: crash-safe atomic JSON writes, tolerant JSON
 * reads, JSONL append/read with partial-line recovery, and cross-process
 * advisory locking.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

/**
 * Atomically write `data` to `filePath`:
 *   write temp file (same directory) -> flush (fsync) -> rename over target.
 * A crash at any point leaves either the old file or the new file intact.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  // Best-effort: fsync the directory so the rename itself is durable.
  await fs.open(dir, 'r').then(async (dh) => {
    try {
      await dh.sync();
    } catch {
      /* fsync on directories is not supported everywhere (e.g. Windows) */
    } finally {
      await dh.close();
    }
  }).catch(() => {});
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Tolerant reads
// ---------------------------------------------------------------------------

/** Read and parse JSON. Returns null when the file is missing or corrupt. */
export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt file: keep the system alive instead of crashing.
    return null;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  return existsSync(filePath);
}

// ---------------------------------------------------------------------------
// JSONL (append-only log)
// ---------------------------------------------------------------------------

/**
 * Append a single JSON line with fsync. Uses O_APPEND so concurrent
 * appends from multiple processes do not interleave mid-line for
 * reasonably-sized records.
 */
export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const line = `${JSON.stringify(value)}\n`;
  const handle = await fs.open(filePath, 'a');
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Read a JSONL file, skipping blank and corrupt/partial lines (the final
 * line of a file may be truncated after a crash; everything before it is
 * still valid).
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Partial/corrupt line — skip it.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross-process advisory locking
// ---------------------------------------------------------------------------

export interface LockHandle {
  release(): Promise<void>;
}

const LOCK_STALE_MS = 30_000;

/**
 * Acquire an exclusive advisory lock backed by a lock file created with
 * O_EXCL. Retries until `timeoutMs`. Stale locks (older than 30s) are
 * reclaimed, which keeps the system usable if a process died while holding
 * a lock.
 */
export async function acquireLock(
  lockPath: string,
  timeoutMs = 10_000,
): Promise<LockHandle> {
  const dir = path.dirname(lockPath);
  await fs.mkdir(dir, { recursive: true });
  const started = Date.now();
  const token = `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;

  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(token, 'utf8');
      await handle.close();
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try {
            const current = await fs.readFile(lockPath, 'utf8');
            if (current.trim() === token) {
              await fs.rm(lockPath, { force: true });
            }
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Lock exists — check staleness.
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // disappeared between attempts
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out acquiring lock: ${lockPath}`);
      }
      await sleep(25 + Math.floor(Math.random() * 50));
    }
  }
}

/**
 * Run `fn` while holding the lock at `lockPath`.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const lock = await acquireLock(lockPath, timeoutMs);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
