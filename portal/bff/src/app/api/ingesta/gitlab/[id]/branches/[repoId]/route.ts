import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; repoId: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, repoId } = await params;
  const response = await fetch(`${upstream}/api/v1/gitlab/connectors/${id}/repos/${repoId}/branches`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
