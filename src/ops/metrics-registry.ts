import type { MetricLabels } from "./observability-types.js";

const metricDefinitions = {
  kcp_mcp_requests_total: { type: "counter", labels: ["transport", "operation", "outcome"] },
  kcp_mcp_request_duration_ms: { type: "histogram", labels: ["transport", "operation"] },
  kcp_mcp_errors_total: { type: "counter", labels: ["transport", "operation", "error_code"] },
  kcp_mcp_denials_total: { type: "counter", labels: ["operation", "reason"] },
  kcp_dependency_health: { type: "gauge", labels: ["dependency"] },
  kcp_dependency_requests_total: { type: "counter", labels: ["dependency", "operation", "outcome"] },
  kcp_dependency_duration_ms: { type: "histogram", labels: ["dependency", "operation"] },
  kcp_audit_events_total: { type: "counter", labels: ["operation", "outcome"] },
} as const;

type MetricName = keyof typeof metricDefinitions;

export interface MetricsRegistry {
  increment(name: string, labels: MetricLabels, value?: number): void;
  observe(name: string, labels: MetricLabels, value: number): void;
  set(name: string, labels: MetricLabels, value: number): void;
  renderPrometheus(): string;
}

type Sample = { labels: string; value: number };

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function labelKey(labels: MetricLabels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}="${escapeLabel(labels[key] ?? "")}"`)
    .join(",");
}

function assertMetric(name: string): asserts name is MetricName {
  if (!(name in metricDefinitions)) {
    throw new Error(`Unknown metric: ${name}`);
  }
}

function assertLabels(name: MetricName, labels: MetricLabels): void {
  const allowed = new Set(metricDefinitions[name].labels);
  for (const key of Object.keys(labels)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown label: ${key}`);
    }
  }
  for (const key of metricDefinitions[name].labels) {
    if (labels[key] === undefined) {
      throw new Error(`Missing label: ${key}`);
    }
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  const samples = new Map<string, Sample>();

  function update(name: string, labels: MetricLabels, value: number, mode: "add" | "set") {
    assertMetric(name);
    assertLabels(name, labels);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid metric value: ${name}`);
    }
    const key = `${name}|${labelKey(labels)}`;
    const previous = samples.get(key)?.value ?? 0;
    samples.set(key, { labels: labelKey(labels), value: mode === "add" ? previous + value : value });
  }

  return {
    increment: (name, labels, value = 1) => update(name, labels, value, "add"),
    observe: (name, labels, value) => update(name, labels, value, "add"),
    set: (name, labels, value) => update(name, labels, value, "set"),
    renderPrometheus: () => {
      const lines: string[] = [];
      for (const [name, definition] of Object.entries(metricDefinitions)) {
        lines.push(`# TYPE ${name} ${definition.type}`);
        const matching = [...samples.entries()].filter(([key]) => key.startsWith(`${name}|`));
        for (const [key, sample] of matching) {
          const suffix = definition.type === "histogram" ? "_count" : "";
          lines.push(`${key.split("|", 1)[0]}${suffix}{${sample.labels}} ${sample.value}`);
        }
      }
      return `${lines.join("\n")}\n`;
    },
  };
}
