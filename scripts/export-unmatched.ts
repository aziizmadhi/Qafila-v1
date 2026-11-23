/**
 * npm run export-unmatched -- --since=YYYY-MM-DD [--until=YYYY-MM-DD] [--out=file.csv] [--min-count=1]
 *
 * Writes every attempt that matched nothing (players may retry, so this is
 * every wrong answer, not just final ones), grouped per question by its
 * normalized form and sorted by how many players typed it, so you can copy
 * the valid ones into the sheet as variants and re-import.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { levenshtein } from "@/lib/matching";
import { addDays, isIsoDate, riyadhDate, riyadhMidnight } from "@/lib/time";
import { toCsv } from "@/server/content/csv";
import { closeDb, getDb } from "@/server/db";
import { color, fail, loadEnv } from "./lib/cli";

const USAGE = "Usage: npm run export-unmatched -- --since=YYYY-MM-DD [--until=YYYY-MM-DD] [--out=file.csv] [--min-count=1]";

async function main() {
  const { values } = parseArgs({
    options: {
      since: { type: "string" },
      until: { type: "string" },
      out: { type: "string" },
      "min-count": { type: "string", default: "1" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) fail(USAGE, 0);
  if (!values.since || !isIsoDate(values.since)) fail(`--since must be a date like 2026-11-16.\n${USAGE}`);
  const until = values.until ?? riyadhDate();
  if (!isIsoDate(until)) fail(`--until must be a date like 2026-11-30.\n${USAGE}`);
  const minCount = Number(values["min-count"]);
  if (!Number.isInteger(minCount) || minCount < 1) fail("--min-count must be a positive whole number.");
  loadEnv();
  const db = getDb();

  const from = riyadhMidnight(values.since);
  const to = riyadhMidnight(addDays(until, 1));
  const rows = await db<
    {
      question_id: string;
      date: string;
      track: string;
      position: number;
      question: string;
      norm_text: string;
      count: number;
      total: number;
      raws: string[];
      first_seen: Date;
      last_seen: Date;
    }[]
  >`
    select a.question_id, j.play_date::text as date, j.track, q.position, q.text as question, a.norm_text,
      count(*)::int as count,
      (select count(*)::int from responses x where x.question_id = a.question_id and x.match is not null) as total,
      array_agg(a.raw_text order by a.created_at) as raws,
      min(a.created_at) as first_seen, max(a.created_at) as last_seen
    from attempts a
    join questions q on q.id = a.question_id
    join journeys j on j.id = q.journey_id
    where a.match = 'none' and a.norm_text <> ''
      and a.created_at >= ${from} and a.created_at < ${to}
    group by a.question_id, j.play_date, j.track, q.position, q.text, a.norm_text
    having count(*) >= ${minCount}
    order by count(*) desc, j.play_date, q.position, a.norm_text`;

  // Closest accepted answer, to speed up review.
  const qids = [...new Set(rows.map((r) => r.question_id))];
  const keys =
    qids.length === 0
      ? []
      : await db<{ question_id: string; key: string; canonical: string }[]>`
    select k.question_id, k.key, a.canonical from answer_keys k join answers a on a.id = k.answer_id
    where k.question_id = any(${qids}::uuid[])`;
  const keysByQ = new Map<string, { key: string; canonical: string }[]>();
  for (const k of keys) {
    const arr = keysByQ.get(k.question_id) ?? [];
    arr.push(k);
    keysByQ.set(k.question_id, arr);
  }

  const out: (string | number)[][] = [
    [
      "date",
      "question_number",
      "question_text",
      "answer",
      "normalized",
      "count",
      "share_of_players",
      "spellings",
      "closest_canonical",
      "edit_distance",
      "first_seen",
      "last_seen",
    ],
  ];
  for (const r of rows) {
    const tally = new Map<string, number>();
    for (const raw of r.raws) tally.set(raw.trim(), (tally.get(raw.trim()) ?? 0) + 1);
    const spellings = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    let best: { canonical: string; d: number } | null = null;
    for (const k of keysByQ.get(r.question_id) ?? []) {
      const d = levenshtein(r.norm_text, k.key);
      if (!best || d < best.d) best = { canonical: k.canonical, d };
    }
    out.push([
      r.track === "daily" ? r.date : `${r.date} [${r.track}]`,
      r.position,
      r.question,
      spellings[0] ?? r.norm_text,
      r.norm_text,
      r.count,
      r.total > 0 ? (r.count / r.total).toFixed(4) : "",
      spellings.slice(0, 8).join(" | "),
      best?.canonical ?? "",
      best?.d ?? "",
      r.first_seen.toISOString(),
      r.last_seen.toISOString(),
    ]);
  }
  const file = values.out ?? `unmatched-${values.since}-to-${until}.csv`;
  writeFileSync(file, toCsv(out), "utf8");
  console.log(color.green(`✔ ${rows.length} unmatched answer(s) written to ${file}`));
}

main()
  .catch((e) => {
    console.error(color.red(`Export failed: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
