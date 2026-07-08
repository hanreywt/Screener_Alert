import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Password-gate the dashboard with HTTP Basic Auth.
 *
 * Everything is protected EXCEPT `/api/cron/alert`, which authenticates the
 * external scheduler with its own CRON_SECRET. Once a browser authenticates,
 * it reuses the credentials for same-origin fetches (e.g. /api/analysis), so
 * the dashboard keeps working behind the gate.
 *
 * Set SITE_USER and SITE_PASSWORD env vars to enable. If either is unset,
 * the gate is disabled (fail-open) so a misconfig can't lock everyone out.
 */
export function proxy(request: NextRequest) {
  // Let machine endpoints through — the cron scheduler (CRON_SECRET) and the
  // Discord interactions webhook (Ed25519 signature) authenticate themselves.
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/discord/")
  ) {
    return NextResponse.next();
  }

  const user = process.env.SITE_USER;
  const pass = process.env.SITE_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const sep = decoded.indexOf(":");
    if (decoded.slice(0, sep) === user && decoded.slice(sep + 1) === pass) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Screener", charset="UTF-8"' },
  });
}

export const config = {
  // Run on all routes except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
