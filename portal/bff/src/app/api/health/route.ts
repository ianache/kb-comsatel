import { NextResponse } from "next/server";

// The BFF's own liveness check, used by the shell's "Estado de servicios" popup
// to report the "BFF Gateway" row. No auth required — this never reveals
// anything beyond process liveness.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" });
}
