import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";

/** Load .env.local / .env if present (Node ≥ 21.7). Existing env vars win. */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        /* ignore malformed files; the DB client reports missing vars */
      }
    }
  }
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

export const color = {
  red: (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};
