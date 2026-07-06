#!/usr/bin/env node
/**
 * Pure IP-matching helpers for the Mission Control webhook server's
 * allowlist check. Extracted from webhook-server.js so they can be unit
 * tested without importing the server module (which has side effects at
 * load time — reads the key file, opens a listening socket, etc.).
 */

/** Parse a dotted-quad IPv4 string into a 32-bit unsigned int, or null. */
export function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/**
 * Normalize an IPv4-mapped IPv6 address ("::ffff:1.2.3.4") down to plain
 * IPv4 ("1.2.3.4"). Leaves genuine IPv6 addresses (including "::1") untouched.
 */
export function normalizeIp(rawIp) {
  const ip = String(rawIp || '');
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}

/**
 * Check whether a raw socket-remoteAddress-style IP is allowed by an
 * allowlist of exact IPs / IPv4 CIDR ranges / exact IPv6 literals.
 * @param {string} rawIp - as seen on req.socket.remoteAddress
 * @param {string[]} allowlist - empty array means "no filtering, allow all"
 * @returns {boolean}
 */
export function ipAllowed(rawIp, allowlist) {
  if (!allowlist || !allowlist.length) return true;
  const ip = normalizeIp(rawIp);
  if (ip === '::1' || ip === '127.0.0.1') return true; // loopback always allowed
  const ipInt = ipToInt(ip);
  for (const entry of allowlist) {
    if (entry === ip) return true;
    // IPv4 CIDR (only meaningful for IPv4-shaped client IPs)
    const m = entry.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
    if (m && ipInt !== null) {
      const base = ipToInt(m[1]); const bits = parseInt(m[2], 10);
      if (base !== null && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((ipInt & mask) === (base & mask)) return true;
      }
    }
    // Plain IPv6 literal match (no CIDR support for v6 yet — exact match only).
    if (ipInt === null && entry.includes(':') && entry.toLowerCase() === ip.toLowerCase()) return true;
  }
  return false;
}
