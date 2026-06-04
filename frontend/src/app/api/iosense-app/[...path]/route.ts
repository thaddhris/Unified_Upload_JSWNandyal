// Server-side proxy for IOsense App Server (appserver.iosense.io).
// Same shape as the /api/iosense/... proxy but points at the V2 MDE host.

import type { NextRequest } from "next/server";

const UPSTREAM = "https://appserver.iosense.io";

async function forward(req: NextRequest, params: { path: string[] }) {
  const segments = params.path ?? [];
  const path = "/" + segments.map(encodeURIComponent).join("/");
  const search = req.nextUrl.search ?? "";
  const upstreamUrl = `${UPSTREAM}${path}${search}`;

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

  const respHeaders = new Headers();
  const ct = upstreamResp.headers.get("content-type");
  if (ct) respHeaders.set("content-type", ct);
  const text = await upstreamResp.text();

  // eslint-disable-next-line no-console
  console.log(
    `[iosense-app-proxy] ${req.method} ${path} → ${upstreamResp.status} (${text.length} bytes)` +
      (text.length < 400 ? ` body=${text}` : ` head=${text.slice(0, 300)}…`),
  );
  // Also log the request body for upload calls so we can verify the exact
  // payload we send (helps diagnose "backend says success but data doesn't
  // appear" issues).
  if (req.method === "POST" && path.includes("/manualDataEntry/upload/") && body) {
    const bodyStr = typeof body === "string" ? body : String(body);
    // eslint-disable-next-line no-console
    console.log(
      `[iosense-app-proxy] ⬆ upload payload (${bodyStr.length} bytes) ${
        bodyStr.length < 800 ? bodyStr : bodyStr.slice(0, 600) + "…"
      }`,
    );
  }

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
