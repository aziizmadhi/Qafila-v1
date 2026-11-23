export interface AnswerInput {
  canonical: string;
  key: string;
  /** Variants as written in the sheet (deduplicated, excluding the canonical). */
  variants: string[];
  /** Normalized keys of the variants that differ from `key` (deduplicated). */
  variantKeys: string[];
  seedFrequency: number;
  row: number;
}

export interface QuestionInput {
  position: number;
  category: string;
  text: string;
  answers: AnswerInput[];
  rows: number[];
}

export interface JourneyInput {
  date: string;
  track: string;
  questions: QuestionInput[]; // sorted by position, exactly 7 when valid
}

export interface Issue {
  level: "error" | "warning";
  rows: number[];
  message: string;
}

export function formatIssue(issue: Issue): string {
  const where =
    issue.rows.length === 0 ? "" : issue.rows.length === 1 ? `Row ${issue.rows[0]}: ` : `Rows ${issue.rows.join(", ")}: `;
  return `${issue.level === "error" ? "✖" : "⚠"} ${where}${issue.message}`;
}
