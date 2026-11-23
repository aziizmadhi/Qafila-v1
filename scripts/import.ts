/**
 * npm run import -- <file.csv> [--yes] [--allow-removals] [--validate-only]
 *
 * Validates a content CSV, prints a dry-run diff against the database, asks
 * for confirmation, then upserts. Changed answer lists are applied
 * retroactively: affected responses are re-matched and rescored.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { riyadhDate } from "@/lib/time";
import { applyContent, RemovalBlockedError } from "@/server/content/apply";
import { diffContent, formatDiff, loadExisting } from "@/server/content/diff";
import { formatIssue } from "@/server/content/model";
import { hasErrors, parseContentCsv } from "@/server/content/validate";
import { closeDb, getDb } from "@/server/db";
import { color, confirm, fail, loadEnv } from "./lib/cli";

const USAGE = "Usage: npm run import -- <file.csv> [--yes] [--allow-removals] [--validate-only]";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: "boolean", short: "y", default: false },
      "allow-removals": { type: "boolean", default: false },
      "validate-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length !== 1) fail(USAGE, values.help ? 0 : 1);
  const file = positionals[0]!;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`Cannot read ${file}`);
  }
  loadEnv();

  let categories: Set<string> | undefined;
  if (!values["validate-only"]) {
    const db = getDb();
    const rows = await db<{ slug: string }[]>`select slug from categories`;
    categories = new Set(rows.map((r) => r.slug));
  }

  const parsed = parseContentCsv(text, { categories });
  const errors = parsed.issues.filter((i) => i.level === "error");
  const warnings = parsed.issues.filter((i) => i.level === "warning");
  for (const w of warnings) console.log(color.yellow(formatIssue(w)));
  if (hasErrors(parsed.issues)) {
    for (const e of errors) console.log(color.red(formatIssue(e)));
    fail(color.red(`\n${errors.length} error(s) in ${file}. Nothing was imported.`));
  }
  const answers = parsed.journeys.reduce((n, j) => n + j.questions.reduce((m, q) => m + q.answers.length, 0), 0);
  console.log(color.green(`✔ ${file}: ${parsed.dataRows} rows, ${parsed.journeys.length} journey(s), ${answers} accepted answers — valid.`));
  if (values["validate-only"]) return;

  const db = getDb();
  const existing = await loadExisting(db, parsed.journeys);
  const diff = diffContent(parsed.journeys, existing);
  console.log("\nDry run — changes that would be made:\n");
  console.log(formatDiff(diff, { today: riyadhDate() }));

  if (diff.journeys.length === 0) {
    console.log(color.green("\nNothing to do: the database already matches this file."));
    return;
  }
  if (diff.riskyRemovals.length > 0 && !values["allow-removals"]) {
    for (const r of diff.riskyRemovals) {
      console.log(color.red(`✖ ${r.journey.date} Q${r.position}: removing "${r.change.canonical}" — ${r.change.details.join("; ")}`));
    }
    fail(color.red("\nRemoving answers that players already matched needs --allow-removals."));
  }

  if (!values.yes) {
    if (!process.stdin.isTTY) fail("Not a terminal: re-run with --yes to apply.");
    if (!(await confirm("\nApply these changes?"))) fail("Aborted. Nothing was changed.", 0);
  }

  const sha256 = createHash("sha256").update(text).digest("hex");
  try {
    const s = await applyContent(db, diff, { fileName: basename(file), sha256, allowRemovals: values["allow-removals"] });
    console.log(color.green("\n✔ Imported."));
    console.log(
      `  journeys: ${s.journeysCreated} new, ${s.journeysChanged} changed · questions written: ${s.questionsWritten}` +
        `\n  answers: +${s.answersAdded} ~${s.answersUpdated} −${s.answersRemoved}` +
        `\n  retroactive: ${s.responsesRematched} response(s) re-matched (${s.newlyMatched} newly accepted, ${s.newlyUnmatched} no longer accepted), ${s.responsesRescored} rescored`,
    );
  } catch (e) {
    if (e instanceof RemovalBlockedError) fail(color.red(e.message));
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(color.red(`Import failed: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
