// Thin HTTP client for IOsense.
//
// Calls go through one of two same-origin proxies (CORS-bypass):
//   /api/iosense/...      → connector.iosense.io  (auth/SSO + legacy routes)
//   /api/iosense-app/...  → appserver.iosense.io  (MDE V2 routes)
//
// `ioFetch` targets connector; `ioFetchApp` targets appserver.

const BASE_URL = "/api/iosense";
const BASE_URL_APP = "/api/iosense-app";
const TOKEN_KEY = "authorization";
const ORG_KEY = "iosense.organisation";

export type IOsenseError = {
  status: number;
  message: string;
  errors?: string[];
};

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

function getOrg(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_KEY);
}

function setOrg(org: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORG_KEY, org);
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ORG_KEY);
}

export function hasAuth(): boolean {
  return !!getStoredToken();
}

/**
 * SSO bootstrap. Reads a one-time SSO token from the URL `?token=…`, exchanges
 * it for a Bearer JWT, stores both, then strips the param from the URL so it
 * can't be replayed. Idempotent — does nothing if no `?token=` is present or
 * if we already have a stored Bearer.
 *
 * Returns true when we ended up with a valid stored token (either pre-existing
 * or freshly exchanged), false when the user needs to come from the IOsense
 * portal.
 */
export async function bootstrapAuth(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (hasAuth()) return true;

  const url = new URL(window.location.href);
  const ssoToken = url.searchParams.get("token");
  if (!ssoToken) return false;

  try {
    const resp = await fetch(`${BASE_URL}/api/retrieve-sso-token/${encodeURIComponent(ssoToken)}`, {
      method: "GET",
      headers: {
        organisation: "https://iosense.io",
        "ngsw-bypass": "true",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const body = await resp.json();
    if (!resp.ok || !body?.success || !body?.token) {
      console.warn("SSO exchange failed", body);
      return false;
    }
    setStoredToken(body.token);
    if (body.organisation) setOrg(body.organisation);

    // Strip the one-time token from the URL so refresh doesn't re-fire
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    return true;
  } catch (e) {
    console.warn("SSO exchange threw", e);
    return false;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
};

async function buildHeaders(custom?: Record<string, string>): Promise<Record<string, string>> {
  const token = getStoredToken();
  if (!token) {
    throw {
      status: 401,
      message: "Not signed in. Open this app via the IOsense portal to generate an SSO token.",
    } as IOsenseError;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    "ngsw-bypass": "true",
    ...(custom ?? {}),
  };
  // Only attach organisation if SSO actually returned one. The working MDE V2
  // app sends an empty organisation header, which is equivalent to not sending
  // it — and any non-empty fallback (e.g. "https://iosense.io") confuses
  // appserver and produces wrong-org responses.
  const org = getOrg();
  if (!headers.organisation && org) headers.organisation = org;
  return headers;
}

async function rawFetch<T>(base: string, path: string, opts: RequestOptions): Promise<T> {
  const headers = await buildHeaders(opts.headers);
  const resp = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    /* empty / non-JSON */
  }

  if (!resp.ok) {
    const err: IOsenseError = {
      status: resp.status,
      message:
        (body as { message?: string })?.message ??
        (Array.isArray((body as { errors?: string[] })?.errors)
          ? ((body as { errors?: string[] }).errors as string[]).join("; ")
          : `${resp.status} ${resp.statusText}`),
      errors: (body as { errors?: string[] })?.errors,
    };
    if (resp.status === 401) clearAuth();
    throw err;
  }

  return body as T;
}

export function ioFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  return rawFetch<T>(BASE_URL, path, opts);
}

// Same shape as ioFetch but routed through the appserver.iosense.io proxy.
// All MDE V2 routes (section list, getData, uploadData) live here.
export function ioFetchApp<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  return rawFetch<T>(BASE_URL_APP, path, opts);
}
