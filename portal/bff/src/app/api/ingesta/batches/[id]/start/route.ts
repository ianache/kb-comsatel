import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const response = await fetch(`${upstream}/api/v1/batches/${id}/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
