import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanAddresses, publicBaseUrl } from './url-utils.js';

test('lanAddresses: returns non-internal IPv4 addresses only', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [
      { family: 'IPv4', internal: false, address: '192.168.1.42' },
      { family: 'IPv6', internal: false, address: 'fe80::1' },
    ],
    tailscale0: [{ family: 'IPv4', internal: false, address: '100.64.0.5' }],
  };
  assert.deepEqual(lanAddresses(ifaces), ['192.168.1.42', '100.64.0.5']);
});

test('lanAddresses: accepts legacy numeric family (4)', () => {
  const ifaces = { eth0: [{ family: 4, internal: false, address: '10.0.0.9' }] };
  assert.deepEqual(lanAddresses(ifaces), ['10.0.0.9']);
});

test('lanAddresses: dedupes and tolerates junk input', () => {
  const ifaces = {
    a: [{ family: 'IPv4', internal: false, address: '10.0.0.1' }],
    b: [{ family: 'IPv4', internal: false, address: '10.0.0.1' }],
    c: null,
    d: [null, { internal: false }],
  };
  assert.deepEqual(lanAddresses(ifaces), ['10.0.0.1']);
  assert.deepEqual(lanAddresses(undefined), []);
  assert.deepEqual(lanAddresses('nope'), []);
});

test('publicBaseUrl: PUBLIC_URL wins and trailing slashes are stripped', () => {
  assert.equal(
    publicBaseUrl({ publicUrl: 'https://mc.example.com/', hostHeader: 'x:1', port: 8765 }),
    'https://mc.example.com'
  );
});

test('publicBaseUrl: falls back to Host header, honoring x-forwarded-proto', () => {
  assert.equal(
    publicBaseUrl({ hostHeader: 'server.local:8765', port: 8765 }),
    'http://server.local:8765'
  );
  assert.equal(
    publicBaseUrl({ hostHeader: 'mc.example.com', forwardedProto: 'https', port: 8765 }),
    'https://mc.example.com'
  );
});

test('publicBaseUrl: last-resort localhost with port', () => {
  assert.equal(publicBaseUrl({ port: 9000 }), 'http://localhost:9000');
  assert.equal(publicBaseUrl({}), 'http://localhost:8765');
  assert.equal(publicBaseUrl(), 'http://localhost:8765');
});

test('publicBaseUrl: blank/whitespace publicUrl is ignored', () => {
  assert.equal(
    publicBaseUrl({ publicUrl: '   ', hostHeader: 'h:1', port: 8765 }),
    'http://h:1'
  );
});
