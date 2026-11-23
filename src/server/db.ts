import postgres from "postgres";

/** A connection pool or an open transaction — both run tagged-template queries. */
export type Db = postgres.Sql;

const globalForDb = globalThis as unknown as { __qafilaSql?: postgres.Sql };

/**
 * Shared postgres.js client. In production DATABASE_URL should point at the
 * Supabase transaction pooler (port 6543); prepared statements are disabled
 * for that reason.
 */
export function getDb(): Db {
  if (!globalForDb.__qafilaSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
    globalForDb.__qafilaSql = postgres(url, {
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return globalForDb.__qafilaSql;
}

/** Tests and scripts can inject their own client. */
export function setDb(client: postgres.Sql | undefined): void {
  globalForDb.__qafilaSql = client;
}

export async function closeDb(): Promise<void> {
  const c = globalForDb.__qafilaSql;
  globalForDb.__qafilaSql = undefined;
  if (c) await c.end({ timeout: 5 });
}

/** Run `fn` in a transaction. */
export function transaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.begin((tx) => fn(tx as unknown as Db)) as Promise<T>;
}
