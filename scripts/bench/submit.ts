/**
 * npm run bench:submit
 *
 * Times the answer endpoint's database work (submitAnswer → game.submit,
 * including the per-IP limit) against a throwaway copy of the seed, through a
 * TCP proxy that adds a fixed round-trip time to every exchange with Postgres.
 * Reports database round trips and server time per answer.
 *
 * Needs a Postgres you can create databases on: TEST_DATABASE_URL (default
 * postgres://postgres@127.0.0.1:55432/postgres), like `npm run test:db`.
 * Auth (Supabase getClaims) is not included; see README → Performance.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { setDb } from "@/server/db";
import { beginRun, startRun, submitAnswer } from "@/server/game/runs";
import { createTestDb } from "../../tests/db/harness";
import { startLatencyProxy } from "./latency-proxy";

const DATE = "2026-11-23";
process.env.QAFILA_FAKE_TODAY = DATE;

async function main() {
  const t = await createTestDb();
  const parsed = parseContentCsv(readFileSync("content/seed/seed_14_days.csv", "utf8"));
  await applyContent(t.db, diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys)), {
    fileName: "seed",
    sha256: "bench",
    allowRemovals: false,
  });
  const answers = await t.db<{ position: number; canonical: string }[]>`
    select distinct on (q.position) q.position, a.canonical
    from questions q join journeys j on j.id = q.journey_id join answers a on a.question_id = q.id
    where j.play_date = ${DATE} order by q.position, a.seed_frequency desc`;

  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/postgres");
  const proxy = await startLatencyProxy({ host: url.hostname, port: Number(url.port || 5432) });
  url.host = `127.0.0.1:${proxy.port}`;
  url.pathname = `/${t.name}`;
  // Same client settings as production (src/server/db.ts): no prepared statements (pooler).
  const db = postgres(url.toString(), { max: 3, prepare: false, onnotice: () => {} });
  setDb(db);
  await db`select 1`;

  const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]!;
  console.log("added RTT | answer  | submits | round trips | median ms | p90 ms");
  for (const rtt of [0, 2, 150]) {
    proxy.setRtt(0);
    const stats = { correct: { ms: [] as number[], trips: [] as number[] }, wrong: { ms: [] as number[], trips: [] as number[] } };
    const players = rtt === 150 ? 3 : 12;
    for (let i = 0; i < players; i++) {
      const u = await t.createUser();
      const run = await startRun(db, u, { mode: "daily" });
      const t0 = Date.now();
      await beginRun(db, u, run.id, new Date(t0));
      proxy.setRtt(rtt);
      for (let p = 1; p <= 7; p++) {
        // Simulated clock: a wrong try 1 s in, the right answer 2 s in; the next question starts 3 s later.
        const served = t0 + (p - 1) * 5000;
        for (const [kind, text, at] of [
          ["wrong", "إجابة خاطئة تماما", served + 1000],
          ["correct", answers[p - 1]!.canonical, served + 2000],
        ] as const) {
          const w0 = proxy.writes();
          const s0 = performance.now();
          await submitAnswer(db, u, run.id, p, text, new Date(at), { ipKey: `ip:bench-${rtt}-${i}`, ipLimit: 240 });
          stats[kind].ms.push(performance.now() - s0);
          stats[kind].trips.push(proxy.writes() - w0);
        }
        if (rtt === 150 && p >= 3) break;
      }
      proxy.setRtt(0);
    }
    for (const kind of ["correct", "wrong"] as const) {
      const s = stats[kind];
      console.log(
        `${`${rtt} ms`.padEnd(9)} | ${kind.padEnd(7)} | ${String(s.ms.length).padEnd(7)} | ${String(q(s.trips, 0.5)).padEnd(11)} | ${q(s.ms, 0.5).toFixed(1).padEnd(9)} | ${q(s.ms, 0.9).toFixed(1)}`,
      );
    }
  }
  await db.end();
  await proxy.close();
  setDb(t.db);
  await t.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
