/** Small shared utilities: ids, timestamps, clamping. */
import crypto from 'node:crypto';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function clamp01(value: unknown, fallback = 0.5): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Format an ISO timestamp as a short human relative time. */
export function relativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = now.getTime() - then;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (minutes < 1) label = 'just now';
  else if (minutes < 60) label = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  else if (hours < 24) label = `${hours} hour${hours === 1 ? '' : 's'}`;
  else label = `${days} day${days === 1 ? '' : 's'}`;
  if (label === 'just now') return label;
  return diffMs >= 0 ? `${label} ago` : `in ${label}`;
}
