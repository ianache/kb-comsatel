import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/connectors`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });

  const body = await response.json();
  return NextResponse.json(body, { status: response.status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/connectors`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return NextResponse.json(body, { status: response.status });
}
