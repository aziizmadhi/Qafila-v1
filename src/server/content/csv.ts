/**
 * Minimal RFC 4180 CSV reader/writer (what Google Sheets exports).
 * `row` is the 1-based spreadsheet row of each record (the header is row 1),
 * so error messages point at the row you see in Sheets.
 */
export interface CsvRecord {
  row: number;
  fields: string[];
}

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    public readonly row: number,
  ) {
    super(`Row ${row}: ${message}`);
  }
}

export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let row = 1;
  let fieldStarted = false;

  const endRecord = () => {
    fields.push(field);
    // Skip completely empty lines (Sheets sometimes leaves trailing blank rows).
    if (!(fields.length === 1 && fields[0] === "")) records.push({ row, fields });
    fields = [];
    field = "";
    fieldStarted = false;
    row++;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (fieldStarted && field.trim() !== "") {
        throw new CsvSyntaxError('unexpected quote inside an unquoted field', row);
      }
      field = "";
      inQuotes = true;
      fieldStarted = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
      fieldStarted = false;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
    } else if (c === "\n") {
      endRecord();
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new CsvSyntaxError("a quoted field is never closed", row);
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}

function quote(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a UTF-8 BOM so spreadsheet apps open Arabic correctly. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return "﻿" + rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}
