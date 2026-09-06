import { NextResponse } from "next/server";
import { buildEndSessionUrl } from "@/lib/keycloak";
import { clearSessionCookieOn, getSession } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();

  const response = session
    ? NextResponse.redirect(buildEndSessionUrl(session.idToken))
    : NextResponse.redirect(process.env.BFF_BASE_URL ?? "http://localhost:3000");
  await clearSessionCookieOn(response);
  return response;
}
