import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_API = new Set(["/api", "/api/auth/login", "/api/auth/logout", "/api/public/login-context", "/api/public/daily-motivation", "/api/public/access-request"]);
const SESSION_COOKIE = "dp_session";
const isDev = process.env.NODE_ENV !== "production";

function securityHeaders(res: NextResponse, csp: string) {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (!isDev) {
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  if (process.env.ENABLE_HSTS === "true") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  try {
    decodeURIComponent(pathname);
  } catch {
    const requestId = crypto.randomUUID();
    return securityHeaders(
      NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "The request path is not valid.", requestId } },
        { status: 400, headers: { "cache-control": "no-store", "x-request-id": requestId } },
      ),
      "default-src 'none'; frame-ancestors 'none'",
    );
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    if (!isDev && !PUBLIC_API.has(path) && !req.cookies.get(SESSION_COOKIE)?.value) {
      const requestId = crypto.randomUUID();
      return securityHeaders(
        NextResponse.json(
          { error: { code: "UNAUTHENTICATED", message: "Authentication required.", requestId } },
          { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } },
        ),
        "default-src 'none'; frame-ancestors 'none'",
      );
    }
    return securityHeaders(NextResponse.next(), "default-src 'none'; frame-ancestors 'none'");
  }

  const nonce = btoa(crypto.randomUUID());
  const devReload = isDev ? " ws://localhost:* ws://127.0.0.1:*" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${devReload}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  return securityHeaders(NextResponse.next({ request: { headers } }), csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg|icon.svg|apple-icon.png|logo.svg|robots.txt).*)"],
};
