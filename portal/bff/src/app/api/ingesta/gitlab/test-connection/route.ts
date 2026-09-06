import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/gitlab/test-connection`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
