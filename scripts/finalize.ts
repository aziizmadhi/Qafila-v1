/**
 * npm run finalize
 *
 * Makes the scores of every finished day final (same job as the nightly
 * Vercel Cron). Safe to run any time.
 */
import { finalizeDueJourneys } from "@/server/scoring/finalize";
import { closeDb, getDb } from "@/server/db";
import { color, loadEnv } from "./lib/cli";

async function main() {
  loadEnv();
  const done = await finalizeDueJourneys(getDb());
  console.log(done.length ? color.green(`✔ Finalized: ${done.join(", ")}`) : "Nothing to finalize.");
}

main()
  .catch((e) => {
    console.error(color.red(`Finalize failed: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
