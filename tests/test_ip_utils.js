#!/usr/bin/env node
/**
 * Tests for tools/mission-control/ip-utils.js — allowlist IP matching,
 * including IPv6 handling (::1, ::ffff: mapped addresses).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ipToInt, normalizeIp, ipAllowed } from '../tools/mission-control/ip-utils.js';

test('ipToInt parses valid IPv4', () => {
  assert.equal(ipToInt('192.168.1.1'), (192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
  assert.equal(ipToInt('0.0.0.0'), 0);
  assert.equal(ipToInt('255.255.255.255'), 0xFFFFFFFF);
});

test('ipToInt rejects non-IPv4 input', () => {
  assert.equal(ipToInt('::1'), null);
  assert.equal(ipToInt('not-an-ip'), null);
  assert.equal(ipToInt('1.2.3'), null);
  assert.equal(ipToInt('1.2.3.4.5'), null);
  assert.equal(ipToInt('256.1.1.1'), null);
});

test('normalizeIp strips ::ffff: mapping from IPv4-mapped addresses', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('::FFFF:10.0.0.5'), '10.0.0.5');
});

test('normalizeIp leaves genuine IPv6 addresses untouched', () => {
  assert.equal(normalizeIp('::1'), '::1');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
});

test('ipAllowed: empty allowlist allows everything', () => {
  assert.equal(ipAllowed('8.8.8.8', []), true);
  assert.equal(ipAllowed('::1', []), true);
});

test('ipAllowed: loopback always allowed regardless of allowlist contents', () => {
  assert.equal(ipAllowed('127.0.0.1', ['10.0.0.0/8']), true);
  assert.equal(ipAllowed('::1', ['10.0.0.0/8']), true);
  assert.equal(ipAllowed('::ffff:127.0.0.1', ['10.0.0.0/8']), true);
});

test('ipAllowed: exact IPv4 match', () => {
  assert.equal(ipAllowed('192.168.1.50', ['192.168.1.50']), true);
  assert.equal(ipAllowed('192.168.1.51', ['192.168.1.50']), false);
});

test('ipAllowed: IPv4 CIDR match', () => {
  assert.equal(ipAllowed('192.168.1.99', ['192.168.1.0/24']), true);
  assert.equal(ipAllowed('192.168.2.1', ['192.168.1.0/24']), false);
  assert.equal(ipAllowed('10.1.2.3', ['10.0.0.0/8']), true);
});

test('ipAllowed: ::ffff: mapped IPv4 address matches an IPv4 CIDR entry', () => {
  assert.equal(ipAllowed('::ffff:192.168.1.5', ['192.168.1.0/24']), true);
  assert.equal(ipAllowed('::ffff:10.0.0.1', ['192.168.1.0/24']), false);
});

test('ipAllowed: exact IPv6 literal match', () => {
  assert.equal(ipAllowed('2001:db8::1', ['2001:db8::1']), true);
  assert.equal(ipAllowed('2001:DB8::1', ['2001:db8::1']), true); // case-insensitive
  assert.equal(ipAllowed('2001:db8::2', ['2001:db8::1']), false);
});

test('ipAllowed: unmatched IPv6 address is rejected when allowlist is non-empty', () => {
  assert.equal(ipAllowed('2001:db8::dead:beef', ['192.168.1.0/24']), false);
});
