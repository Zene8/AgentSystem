/**
 * url-utils.js — pure helpers for advertising reachable URLs.
 *
 * Kept dependency-free and side-effect-free so they can be unit-tested without
 * starting the webhook server (which listens + reads the key file on import).
 */

/**
 * Non-internal IPv4 addresses of this host, from os.networkInterfaces() output.
 * On a headless Linux server these are the LAN / Tailscale addresses a phone or
 * laptop would actually dial — the old hardcoded WSL/Windows IPs never applied.
 *
 * @param {Record<string, Array<{family?: string|number, internal?: boolean, address?: string}>>} interfaces
 * @returns {string[]} unique external IPv4 addresses
 */
export function lanAddresses(interfaces) {
  if (!interfaces || typeof interfaces !== 'object') return [];
  const out = [];
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!Array.isArray(addrs)) continue;
    for (const a of addrs) {
      if (!a || a.internal) continue;
      // Node reports family as 'IPv4' (modern) or 4 (older) — accept both.
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (isV4 && a.address && !out.includes(a.address)) out.push(a.address);
    }
  }
  return out;
}

/**
 * Resolve the base URL a remote client should use to reach this server, in
 * priority order:
 *   1. PUBLIC_URL env (explicit; e.g. "https://mc.example.com" behind a proxy)
 *   2. the request's Host header (so a client that reached us gets a URL that
 *      routes back the same way) — scheme inferred from x-forwarded-proto
 *   3. http://localhost:<port> as a last resort
 *
 * Never returns a trailing slash.
 *
 * @param {{ publicUrl?: string, hostHeader?: string, forwardedProto?: string, port?: number|string }} opts
 * @returns {string}
 */
export function publicBaseUrl({ publicUrl, hostHeader, forwardedProto, port } = {}) {
  if (publicUrl && typeof publicUrl === 'string' && publicUrl.trim()) {
    return publicUrl.trim().replace(/\/+$/, '');
  }
  if (hostHeader && typeof hostHeader === 'string' && hostHeader.trim()) {
    const proto = forwardedProto === 'https' ? 'https' : 'http';
    return `${proto}://${hostHeader.trim()}`.replace(/\/+$/, '');
  }
  return `http://localhost:${port || 8765}`;
}
