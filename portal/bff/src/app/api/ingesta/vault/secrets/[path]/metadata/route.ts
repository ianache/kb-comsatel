import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { path } = await params;
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/vault/secrets/${path}/metadata`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
