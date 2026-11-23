/**
 * Creates a throwaway database, makes it look enough like Supabase (roles,
 * auth.users, auth.uid()) when run on plain Postgres, and applies every
 * migration in supabase/migrations. Point TEST_DATABASE_URL at any Postgres
 * server you can create databases on (default: local cluster on port 55432).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { setDb, type Db } from "@/server/db";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";

const SUPABASE_STUB = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

export interface TestDb {
  db: Db;
  name: string;
  createUser(opts?: { email?: string; anonymous?: boolean }): Promise<string>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `qafila_test_${process.pid}_${Date.now()}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const db = postgres(url.toString(), { max: 4, onnotice: () => {}, prepare: false });
  await db.unsafe(SUPABASE_STUB);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.unsafe(readFileSync(join(dir, file), "utf8"));
  }
  setDb(db);

  return {
    db,
    name,
    async createUser(opts = {}) {
      const [row] = await db<{ id: string }[]>`
        insert into auth.users (email, is_anonymous) values (${opts.email ?? null}, ${opts.anonymous ?? true})
        returning id`;
      return row!.id;
    },
    async close() {
      setDb(undefined);
      await db.end({ timeout: 5 });
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** A valid 7-question day for tests. answersFor(q) returns [canonical, variants, seed][] */
export function dayCsv(
  date: string,
  answersFor: (q: number) => Array<[string, string, number]> = (q) => [
    [`جواب أول ${q}`, `alpha${q}`, 0.4],
    [`جواب ثان ${q}`, "", 0.1],
    [`جواب ثالث ${q}`, "", 0.05],
  ],
): string {
  const lines = ["date,question_number,category,question_text,canonical_answer,variants,seed_frequency"];
  for (let q = 1; q <= 7; q++) {
    for (const [canonical, variants, seed] of answersFor(q)) {
      lines.push(`${date},${q},geography,سؤال الاختبار رقم ${q}؟,${canonical},${variants},${seed}`);
    }
  }
  return lines.join("\n");
}
