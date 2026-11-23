/**
 * Client-side gate for answer attempts. The server enforces the same rules
 * (game.submit); this only makes them instant:
 *  - an empty answer is ignored;
 *  - a wrong answer already tried on this question (after normalization) is
 *    rejected at once, with no request;
 *  - attempts closer than MIN_ATTEMPT_GAP_MS are delayed, not dropped.
 */
import { normalizeAnswer } from "@/lib/normalize";
import { MIN_ATTEMPT_GAP_MS } from "@/lib/timing";

export type AttemptCheck =
  | { kind: "empty" }
  | { kind: "duplicate"; raw: string; norm: string }
  | { kind: "send"; raw: string; norm: string; waitMs: number };

export const cleanAnswer = (s: string) => s.replace(/\s+/g, " ").trim();

export class AttemptGate {
  private readonly tried = new Map<number, Set<string>>();
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly minGapMs = MIN_ATTEMPT_GAP_MS) {}

  check(position: number, text: string, now: number): AttemptCheck {
    const raw = cleanAnswer(text);
    if (!raw) return { kind: "empty" };
    const norm = normalizeAnswer(raw);
    if (this.tried.get(position)?.has(norm)) return { kind: "duplicate", raw, norm };
    return { kind: "send", raw, norm, waitMs: Math.max(0, this.lastSentAt + this.minGapMs - now) };
  }

  /** Call when the request actually leaves. */
  sent(now: number): void {
    this.lastSentAt = now;
  }

  /** The server said wrong: the same answer again is a duplicate. */
  wrong(position: number, norm: string): void {
    let set = this.tried.get(position);
    if (!set) this.tried.set(position, (set = new Set()));
    set.add(norm);
  }
}
