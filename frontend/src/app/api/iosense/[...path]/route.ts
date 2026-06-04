// Server-side proxy for IOsense API calls.
//
// The browser can't talk to connector.iosense.io directly because the IOsense
// CORS allow-list only includes IOsense-owned origins (iosense.io, dashboards).
// All other origins get a CORS preflight failure and the request is blocked
// before it even leaves the browser.
//
// This proxy lives on the same origin as the app, so the browser is happy.
// The Next.js server then forwards the call to connector.iosense.io with the
// same headers (Authorization, organisation) and returns the response.

import type { NextRequest } from "next/server";

const UPSTREAM = "https://connector.iosense.io";

async function forward(req: NextRequest, params: { path: string[] }) {
  const segments = params.path ?? [];
  const path = "/" + segments.map(encodeURIComponent).join("/");
  const search = req.nextUrl.search ?? "";
  const upstreamUrl = `${UPSTREAM}${path}${search}`;

  // Pass through any headers the client set that the upstream cares about.
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "organisation", "ngsw-bypass"]) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
    if (!body) body = undefined;
  }

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        success: false,
        errors: [`Proxy: upstream fetch failed: ${(e as Error).message}`],
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  // Mirror upstream status, content-type, and body back to the browser.
  const respHeaders = new Headers();
  const ct = upstreamResp.headers.get("content-type");
  if (ct) respHeaders.set("content-type", ct);
  const text = await upstreamResp.text();

  // Lightweight server-side log so we can see exactly what IOsense returned
  // without exposing it to the browser console. Always log a short snippet so
  // shape mismatches stay debuggable even on large responses.
  // eslint-disable-next-line no-console
  console.log(
    `[iosense-proxy] ${req.method} ${path} → ${upstreamResp.status} (${text.length} bytes)` +
      (text.length < 400
        ? ` body=${text}`
        : ` head=${text.slice(0, 300)}…`),
  );

  return new Response(text, { status: upstreamResp.status, headers: respHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, await ctx.params);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return forward(req, await ctx.params);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, await ctx.params);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forward(req, await ctx.params);
}
