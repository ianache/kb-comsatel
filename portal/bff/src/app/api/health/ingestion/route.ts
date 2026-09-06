import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

// Proxies ingestion-api's own /health (not under /api/v1 — that prefix is
// only for the authenticated domain routes) so the shell's "Estado de
// servicios" popup can report the "Microservicios" row.
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ status: "down" }, { status: 401 });

  try {
    const response = await fetch(`${upstream}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return NextResponse.json({ status: "down" }, { status: 502 });
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "down" }, { status: 502 });
  }
}
