import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

// Lightweight endpoint the Angular shell polls to know whether a session exists
// and which roles it has — never returns the access_token itself.
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    name: session.name,
    email: session.email,
    roles: session.roles,
  });
}
