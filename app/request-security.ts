export const PRIVATE_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
} as const;

export function jsonNoStore(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) headers.set(name, value);
  return Response.json(data, { ...init, headers });
}

export function isSameOriginRequest(request: Request) {
  const targetOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (origin) return safeOrigin(origin) === targetOrigin;

  const referer = request.headers.get("referer");
  if (referer) return safeOrigin(referer) === targetOrigin;

  return fetchSite === "same-origin";
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
