# Content workflow: Google Sheets → CSV → database

There is no admin panel. You write questions in a spreadsheet, export CSV, and run the importer.

## 1. Set up the sheet (once)

1. Create a new Google Sheet.
2. **File → Import → Upload** `content/template/qafila_template.csv` and choose **Replace current sheet**. You get the header row:

   | date | question_number | category | question_text | canonical_answer | variants | seed_frequency |
   |---|---|---|---|---|---|---|

3. Format the `date` column as plain text (**Format → Number → Plain text**) so Sheets doesn't reformat dates.
4. Optional: add your own columns (notes, source, reviewer). The importer ignores unknown columns and only prints a warning.

## 2. One row per accepted answer

| Column | What to write | Example |
|---|---|---|
| `date` | Riyadh calendar date of the journey, `YYYY-MM-DD` | `2026-12-01` |
| `question_number` | 1–7, the order in the journey | `3` |
| `category` | one of `geography, history, sports, food, culture, science, nature, language` | `food` |
| `question_text` | the question in simple MSA. **Repeat it on every row** of the question | `اذكر نوعًا من الخبز.` |
| `canonical_answer` | the spelling shown to players after the journey | `المسمن` |
| `variants` | other spellings, separated by `\|` | `الملوي\|الرغايف\|Msemen` |
| `seed_frequency` | your estimate of the share of **all** players who will give this answer (0–1) | `0.03` |

Rules the importer enforces (errors point at the sheet row):

- Exactly 7 questions per date, numbered 1–7.
- The same `question_text` and `category` on every row of a question.
- No duplicate canonicals in a question, and no spelling that would match two canonicals.
- `seed_frequency` between 0 and 1, and the frequencies of one question add up to **1 or less**: they are shares of all players, including those who answer wrongly or run out of time. `25%`, `0,25` and Arabic-Indic digits are accepted.

### What you do *not* need to list as variants

The matcher normalizes both sides before comparing, so these already match the canonical:

- Hamza forms (أ إ آ ٱ → ا), ة/ه, ى/ي, ؤ → و, ئ → ي, tashkeel and tatweel.
- Persian/Urdu/Maghrebi letters: ک ی گ ڤ ڨ پ چ ژ ھ.
- A leading `ال` or `و` on any word: `المغرب` = `مغرب` = `والمغرب`.
- A final ء after ا: `صحراء` = `صحرا`.
- `عبد ال…` written split or joined.
- Punctuation, extra spaces, Arabic-Indic digits, Latin case and accents (`Pelé` = `pele`).
- One typo in answers of 5+ letters, provided it can't match two canonicals.

### What you *do* need as variants

- Different words for the same thing: `البطيخ|الدلاع|الحبحب|الرقي`.
- Other transliterations: `كوبنهاغن|كوبنهاجن|كوبنهاقن`.
- Latin spellings players might type: `Messi`, `Casablanca`.
- Common longer forms: `نهر النيل` for `النيل`.

> **Symbols are stripped.** `C++` and `C#` both normalize to `c`, so list `CPP`/`سي بلس بلس` and `C Sharp` instead.

## 3. Export and import

1. **File → Download → Comma-separated values (.csv)**. Sheets exports UTF-8, which the importer expects.
2. Validate without touching the database:

   ```bash
   npm run import -- ~/Downloads/qafila.csv --validate-only
   ```

3. Import. You get a dry-run diff first, then a confirmation prompt:

   ```bash
   npm run import -- ~/Downloads/qafila.csv
   ```

   - The file can hold any number of days and can be re-imported as often as you like. Unchanged days are skipped.
   - Add `--yes` to skip the prompt (CI, scripts).
   - Removing an answer that players have already matched is refused unless you add `--allow-removals`.

The diff marks each day as `past`, `LIVE TODAY` or `upcoming`. Changing a past or live day is allowed: scores are recalculated, see below.

## 4. Review unmatched answers

Players can retry a question until they get it right or run out of time, and every wrong attempt is kept (a spelling repeated by the same player on the same question is kept once). Export them, most frequent first:

```bash
npm run export-unmatched -- --since=2026-11-16
# → unmatched-2026-11-16-to-<today>.csv
```

| Column | Meaning |
|---|---|
| `answer`, `spellings` | what players typed (most common spelling first) |
| `normalized` | the matching key |
| `count`, `share_of_players` | how many players typed it (each player counts once per spelling, however many times they retried) |
| `closest_canonical`, `edit_distance` | the nearest accepted answer, to spot near-misses |

Options: `--until=YYYY-MM-DD`, `--min-count=3`, `--out=file.csv`.

For each valid answer, add it to the sheet, either as a variant of an existing canonical or as a new canonical row. Then re-import.

## 5. Retroactive acceptance

When an import changes which spellings a question accepts, the importer, in the same transaction:

1. re-matches every stored attempt at that question (daily and Unlimited). For each player, the earliest attempt that now matches becomes their answer, so a wrong attempt made before their accepted one can still win, and a timeout can become correct;
2. rebuilds the live rarity counters;
3. recomputes every affected score and journey total.

Players who typed a newly accepted answer get their distance back, and everyone else's rarity is adjusted to match. Changing only `seed_frequency` rescores too.

If you ever change the normalizer itself, run `npm run rescore -- --all --renormalize`.

## 6. Seed content

`content/seed/seed_14_days.csv` holds 14 days (2026-11-16 → 2026-11-29): 98 questions in eight categories, each with 10–40 accepted answers and regional variants. Import it like any other file. To re-date it for testing, set `QAFILA_FAKE_TODAY` in `.env.local` instead of editing dates.

## Later: per-category journeys

The schema already supports them. Add an optional `track` column with a category slug (e.g. `sports`); empty means the mixed daily journey. Nothing else changes.
