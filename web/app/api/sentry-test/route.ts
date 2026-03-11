import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

// Test endpoint to verify Sentry is working
// GET /api/sentry-test — triggers a test error in Sentry
export async function GET() {
  try {
    throw new Error("[Sentry Test] Next.js server-side error — PERS-216 verification");
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({
      ok: true,
      message: "Test error sent to Sentry (server-side)",
      timestamp: new Date().toISOString(),
    });
  }
}

// POST /api/sentry-test — accepts { side: "client" | "server" } for testing
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body.side === "throw") {
    // This will be caught by the global error handler and sent to Sentry automatically
    throw new Error("[Sentry Test] Unhandled server error — PERS-216 verification");
  }

  Sentry.captureMessage(`[Sentry Test] Manual capture — side: ${body.side || "unknown"}`, "warning");

  return NextResponse.json({
    ok: true,
    message: "Test event sent to Sentry",
    side: body.side || "server",
    timestamp: new Date().toISOString(),
  });
}
