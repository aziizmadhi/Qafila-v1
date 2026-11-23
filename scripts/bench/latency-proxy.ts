/** TCP proxy that adds a fixed round-trip delay and counts client → server writes. */
import net from "node:net";

export interface LatencyProxy {
  port: number;
  setRtt(ms: number): void;
  writes(): number;
  close(): Promise<void>;
}

export async function startLatencyProxy(target: { host: string; port: number }, rttMs = 0): Promise<LatencyProxy> {
  let rtt = rttMs;
  let count = 0;
  const sockets = new Set<net.Socket>();
  const delay = (fn: () => void) => (rtt > 0 ? setTimeout(fn, rtt / 2) : fn());
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    client.on("data", (d) => {
      count++;
      delay(() => upstream.write(d));
    });
    upstream.on("data", (d) => delay(() => client.write(d)));
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", end);
    upstream.on("close", end);
    client.on("error", end);
    upstream.on("error", end);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    setRtt: (ms) => (rtt = ms),
    writes: () => count,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
