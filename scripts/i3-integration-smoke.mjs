const enabled = process.env.KCP_I3_INTEGRATION === "true";
if (!enabled) {
  console.log(
    "I3 integration smoke skipped; set KCP_I3_INTEGRATION=true to enable",
  );
  process.exit(0);
}

const qdrantUrl = process.env.KCP_I3_QDRANT_URL ?? "http://127.0.0.1:6333";
const collection = process.env.KCP_I3_QDRANT_COLLECTION ?? "knowledge_chunks";
const response = await fetch(
  `${qdrantUrl.replace(/\/$/u, "")}/collections/${encodeURIComponent(collection)}`,
);
if (!response.ok) {
  console.error(`I3 Qdrant health failed with status ${response.status}`);
  process.exit(1);
}
const body = await response.json();
const vectors = body?.result?.config?.params?.vectors;
console.log(
  JSON.stringify({
    status: "ready",
    collection,
    dimension: vectors?.size,
    distance: vectors?.distance,
  }),
);
