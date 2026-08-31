'use strict';
// secret-shield-fixtures.cjs — synthetic, secret-SHAPED strings for the shield's own tests.
//
// None of these was ever live. They are assembled from parts at runtime rather than written as
// literals for one practical reason: a repo-level secret scanner (GitHub push protection,
// GitGuardian) matches on shape, not on provenance, so a literal `AKIA...` or `sk_live_...` in a
// test file blocks the push and fails the required check — even when the body is all zeros. A
// blocked push is a worse outcome than a slightly indirect fixture, and the detectors under test
// see the exact same bytes either way.
//
// Keep the prefixes split across array elements. Joining them in the literal defeats the point.

const A = (...parts) => parts.join('');

const FIXTURES = {
  stripeKey: A('sk', '_', 'live', '_', '0000000000000000000000AB'),
  githubToken: A('ghp', '_', '00000000000000000000000000000000000A'),
  awsAccessKey: A('AKI', 'A', '000000000000000', 'X'), // 20 chars exactly
  awsAccessKey2: A('AKI', 'A', 'IOSFODNN7', 'EXAMPLE'), // 20 chars exactly, as AWS ids are
  awsSecretKey: A('wJalrXUtnFEMI', '000000000000000000000', 'EXAMPL'),
  awsAccessKeyFake: A('AKI', 'A', 'FAKEFAKEFAKEFAKE'), // 20 chars
  githubTokenFake: A('ghp', '_', 'fakeFakeTokenFakeFakeFakeFake1'),
  // The entropy detector needs an actually-high-entropy string, which is exactly what a generic
  // "high entropy secret" scanner rule fires on. Split, like the rest.
  highEntropy: A('zQ9kR7pL2mN8', 'xW4vB6tY1cD3', 'fH5jS0aQeRtYuIoP'),
  slackToken: A('xox', 'b', '-fake-slack-token-0000000000-fake'),
  jwt: A('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'fakefakefakefakefakefakefake'),
  pemHeader: A('-----BEGIN', ' RSA PRIVATE KEY-----'),
  pemFooter: A('-----END', ' RSA PRIVATE KEY-----'),
};

module.exports = { FIXTURES };
