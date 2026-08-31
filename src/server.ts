import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeedRepository } from "./catalog/seed.js";
import { loadConfig } from "./config.js";
import { ContextEngine, MemoryAuditSink } from "./engine/context-engine.js";
import { createMcpServer } from "./mcp/adapter.js";
import { createHealthServer, type HealthServer } from "./ops/health-server.js";

export interface Application {
  start(): Promise<void>;
  close(): Promise<void>;
}

function createRuntime(enableStdio: boolean): Application {
  const config = loadConfig(process.env as Record<string, string | undefined>);
  let healthServer: HealthServer | undefined;
  let closeMcpServer: (() => Promise<void>) | undefined;
  let isReady = false;
  let started = false;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;

  async function cleanup(): Promise<void> {
    isReady = false;

    try {
      await closeMcpServer?.();
    } finally {
      closeMcpServer = undefined;
      await healthServer?.close();
      healthServer = undefined;
      started = false;
    }
  }

  return {
    async start() {
      if (started) {
        return;
      }

      startPromise ??= (async () => {
        try {
          healthServer = await createHealthServer({
            host: config.host,
            port: config.port,
            isReady: () => isReady,
          });

          const repository = createSeedRepository();
          const auditSink = new MemoryAuditSink();
          const engine = new ContextEngine(repository, auditSink);

          if (enableStdio) {
            const server = createMcpServer(engine);
            const transport = new StdioServerTransport();
            await server.connect(transport);
            closeMcpServer = () => server.close();
          }

          isReady = true;
          started = true;

          if (enableStdio) {
            console.error(
              `knowledge-context-mcp stdio ready with log level ${config.logLevel}`,
            );
          }
        } catch (error) {
          await cleanup();
          throw error;
        }
      })();

      await startPromise;
    },
    async close() {
      closePromise ??= (async () => {
        try {
          await startPromise;
        } catch {}

        await cleanup();
      })();

      await closePromise;
    },
  };
}

export async function createApplication(): Promise<Application> {
  return createRuntime(false);
}

export async function createStdioApplication(): Promise<Application> {
  return createRuntime(true);
}

const entryPoint = process.argv[1];

if (
  entryPoint !== undefined &&
  fileURLToPath(import.meta.url) === resolve(entryPoint)
) {
  let application: Application | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??=
      application
        ?.close()
        .catch(() => undefined)
        .then(() => process.exit(0)) ?? Promise.resolve();
  };

  try {
    application = process.argv.includes("--stdio")
      ? await createStdioApplication()
      : await createApplication();

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    if (process.argv.includes("--stdio")) {
      process.stdin.once("end", shutdown);
    }
    await application.start();
  } catch (error) {
    await application?.close().catch(() => undefined);
    console.error("Startup failed");
    process.exit(1);
  }
}
