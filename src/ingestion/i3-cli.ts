import { loadConfig } from "../config.js";
import { createI3Runtime } from "../retrieval/i3-runtime.js";
import { createRuntimeDependencies } from "../ops/runtime-dependencies.js";

export async function runI3Indexing(
  environment: Record<string, string | undefined>,
  args: readonly string[],
): Promise<number> {
  const sourceArgument = args.indexOf("--source-dir");
  const configuredEnvironment = { ...environment };
  if (sourceArgument >= 0 && args[sourceArgument + 1]) {
    configuredEnvironment.KCP_I3_SOURCE_DIR = args[sourceArgument + 1];
  }
  const config = loadConfig(configuredEnvironment);
  if (!config.i3Enabled) {
    console.error("I3 indexing is disabled; set KCP_I3_ENABLED=true");
    return 2;
  }
  const dependencies = await createRuntimeDependencies(config);
  let runtime: Awaited<ReturnType<typeof createI3Runtime>> | undefined;
  try {
    runtime = await createI3Runtime(config, dependencies);
    console.log(JSON.stringify(await runtime.indexer.ingest()));
  } finally {
    await runtime?.close();
    await dependencies.close();
  }
  return 0;
}

if (process.argv[1]?.endsWith("i3-cli.ts")) {
  process.exitCode = await runI3Indexing(
    process.env as Record<string, string | undefined>,
    process.argv.slice(2),
  );
}
