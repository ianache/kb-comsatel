import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { ContextEngine } from "./engine/context-engine.js";
import { createMcpServer } from "./mcp/adapter.js";
import { createHttpMcpServer, type HttpMcpServer } from "./mcp/http-server.js";
import { localPrincipal } from "./mcp/tools.js";
import { createHealthServer, type HealthServer } from "./ops/health-server.js";
import { createMetricsRegistry } from "./ops/metrics-registry.js";
import { createObservabilityContext } from "./ops/observability-context.js";
import { createStructuredLogger } from "./ops/structured-logger.js";
import { createRuntimeDependencies } from "./ops/runtime-dependencies.js";
import { createI3Runtime, type I3Runtime } from "./retrieval/i3-runtime.js";

export interface Application {
  start(): Promise<void>;
  close(): Promise<void>;
}

function createRuntime(enableStdio: boolean): Application {
  const config = loadConfig(process.env as Record<string, string | undefined>);
  const metrics = createMetricsRegistry();
  const logger = createStructuredLogger({
    service: config.otelServiceName,
    environment: config.otelEnvironment,
  });
  const observability = createObservabilityContext({ metrics, logger });
  let healthServer: HealthServer | undefined;
  let closeMcpServer: (() => Promise<void>) | undefined;
  let httpServer: HttpMcpServer | undefined;
  let closeDependencies: (() => Promise<void>) | undefined;
  let i3Runtime: I3Runtime | undefined;
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
      await httpServer?.close();
      httpServer = undefined;
      await i3Runtime?.close();
      i3Runtime = undefined;
      await closeDependencies?.();
      closeDependencies = undefined;
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
            metrics,
            logger,
          });

          const dependencies = await createRuntimeDependencies(config);
          closeDependencies = dependencies.close;
          i3Runtime = config.i3Enabled
            ? await createI3Runtime(config, dependencies)
            : undefined;
          const engine = new ContextEngine(
            i3Runtime?.repository ?? dependencies.repository,
            dependencies.auditSink,
          );

          if (enableStdio) {
            const server = createMcpServer(engine, undefined, observability, "stdio");
            const transport = new StdioServerTransport();
            await server.connect(transport);
            closeMcpServer = () => server.close();
          }

          if (config.httpEnabled) {
            httpServer = createHttpMcpServer({
              host: config.host,
              port: config.httpPort,
              maxBodyBytes: config.httpMaxBodyBytes,
              engine,
              principalResolver: dependencies.principalResolver,
              localPrincipal: config.httpLocalMode ? localPrincipal : undefined,
            });
            await httpServer.app.listen({
              host: config.host,
              port: config.httpPort,
            });
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
