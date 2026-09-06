import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/vault/secrets`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
