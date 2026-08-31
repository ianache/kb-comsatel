import fastify from "fastify";

export interface HealthServer {
  close(): Promise<void>;
}

export interface CreateHealthServerOptions {
  host: string;
  port: number;
  isReady: () => boolean;
}

function assertLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Health server host must be a loopback address");
  }
}

export async function createHealthServer({
  host,
  port,
  isReady,
}: CreateHealthServerOptions): Promise<HealthServer> {
  assertLoopbackHost(host);

  const app = fastify({ exposeHeadRoutes: false });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    if (!isReady()) {
      return reply.code(503).send({ status: "not_ready" });
    }

    return { status: "ready" };
  });

  await app.listen({ host, port });

  return {
    close: async () => app.close(),
  };
}
