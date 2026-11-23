import type { NextResponse } from "next/server";

/**
 * Per-request timing for hot endpoints: a `Server-Timing` header (visible in
 * the browser's network panel) and one JSON log line per request with the
 * region the function ran in. No user data is logged.
 */
export class ServerTiming {
  private readonly start = performance.now();
  private readonly parts: Array<[string, number]> = [];

  constructor(private readonly route: string) {}

  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.parts.push([name, performance.now() - t0]);
    }
  }

  apply(res: NextResponse): NextResponse {
    const total = performance.now() - this.start;
    const region = process.env.VERCEL_REGION ?? "local";
    const header = [...this.parts, ["total", total] as [string, number]]
      .map(([n, ms]) => `${n};dur=${ms.toFixed(1)}`)
      .join(", ");
    res.headers.set("Server-Timing", `${header}, region;desc="${region}"`);
    console.log(
      JSON.stringify({
        timing: this.route,
        region,
        ...Object.fromEntries(this.parts.map(([n, ms]) => [`${n}_ms`, Math.round(ms * 10) / 10])),
        total_ms: Math.round(total * 10) / 10,
      }),
    );
    return res;
  }
}
