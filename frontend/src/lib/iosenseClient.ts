// Thin HTTP client for IOsense.
//
// Build target: static export (no Node runtime / no proxy routes available).
// `ioFetch` targets connector.iosense.io; `ioFetchApp` targets appserver.
// CORS: IOsense must allow the deployed origin (currently *.iocompute.ai).
// If CORS blocks, every call from the deployed build fails before it leaves
// the browser — fix is upstream (allow-list our origin) or switch the
// platform back to SSR mode and restore the proxy routes.

const BASE_URL = "https://connector.iosense.io";
const BASE_URL_APP = "https://appserver.iosense.io";
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

/**
 * Direct email + password login (legacy `userLogin`). Bypasses the SSO portal
 * detour for users who'd rather sign in inline. On success, stores the
 * Bearer JWT exactly like `bootstrapAuth` does.
 *
 * NOTE: We deliberately do NOT call setOrg() here. The login endpoint requires
 * `organisation: https://iosense.io` on its own request, but stuffing that
 * value into every subsequent appserver call confuses appserver and yields
 * wrong-org responses (same comment as in buildHeaders below).
 */
export async function loginWithCredentials(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof window === "undefined") return { ok: false, message: "no-browser" };

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        organisation: "https://iosense.io",
        "ngsw-bypass": "true",
      },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, message: (e as Error).message || "Network error" };
  }

  let body: { authorization?: string; success?: boolean; message?: string; errors?: string[] } = {};
  try {
    body = await resp.json();
  } catch {
    /* non-JSON */
  }

  if (!resp.ok || !body?.authorization) {
    const msg =
      body?.message ??
      (Array.isArray(body?.errors) ? body.errors.join("; ") : null) ??
      (resp.status === 401 ? "Invalid email or password" : `${resp.status} ${resp.statusText}`);
    return { ok: false, message: msg };
  }

  setStoredToken(body.authorization);
  return { ok: true };
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
