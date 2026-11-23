/** JSON shapes exchanged between the game API and the browser. */
import type { TierId } from "@/lib/tiers";

export type RunMode = "daily" | "unlimited";

export interface AnsweredQuestion {
  position: number;
  category: string;
  score: number;
  correct: boolean;
  timedOut: boolean;
  answer: string | null;
  /** Canonical spelling the answer matched (the player's own answer only). */
  matched: string | null;
}

export interface CurrentQuestion {
  position: number;
  text: string;
  category: string;
  servedAt: string;
  /** Display deadline (served + 30 s). The server accepts 2 s of network grace on top. */
  deadline: string;
  serverNow: string;
  /** Wrong answers already tried on this question (distinct spellings). */
  attempts: number;
}

export interface RunState {
  id: string;
  mode: RunMode;
  date: string;
  journeyNumber: number;
  totalKm: number;
  finished: boolean;
  answered: AnsweredQuestion[];
  current: CurrentQuestion | null;
  questionCount: number;
}

export interface AnswerResult {
  position: number;
  correct: boolean;
  timedOut: boolean;
  /** Wrong, and the same answer (after normalization) was already tried: not counted. */
  duplicate?: boolean;
  /** Attempts left on this question after a wrong answer. */
  attemptsLeft?: number;
  score: number;
  tier: TierId | null;
  matched: string | null;
  totalKm: number;
  finished: boolean;
}

export interface RevealedAnswer {
  canonical: string;
  /** Blended share of all players, in percent with one decimal. */
  sharePct: number;
  score: number;
  yours: boolean;
}

export interface ResultsQuestion {
  position: number;
  text: string;
  category: string;
  answer: string | null;
  matched: string | null;
  score: number;
  correct: boolean;
  timedOut: boolean;
  answers: RevealedAnswer[];
  responses: number;
}

export interface RunResults {
  id: string;
  mode: RunMode;
  date: string;
  journeyNumber: number;
  totalKm: number;
  /** True until the day's scores are made final at midnight Riyadh. */
  provisional: boolean;
  questions: ResultsQuestion[];
}

export interface TodayInfo {
  today: string;
  nextResetAt: string;
  journey: { exists: boolean; number: number | null };
  run: { id: string; finished: boolean; answered: number; totalKm: number } | null;
  streak: number;
}

export interface PastJourney {
  date: string;
  number: number;
  daily: { runId: string; totalKm: number; finished: boolean } | null;
  bestUnlimited: number | null;
}

export interface HistoryItem {
  runId: string;
  date: string;
  number: number;
  mode: RunMode;
  totalKm: number;
  finished: boolean;
  startedAt: string;
}

export interface ProfileInfo {
  isAnonymous: boolean;
  email: string | null;
  streak: number;
  bestStreak: number;
  bestKm: number;
  journeys: number;
  averageKm: number;
  history: HistoryItem[];
}

export interface ApiErrorBody {
  error: string;
  code: string;
}
