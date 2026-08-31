'use strict';
// secret-shield-detect.test.js — CommonJS, node:test + node:assert.
// Run: node --test hooks/lib/secret-shield-detect.test.js
//
// ALL fixture secrets below are SYNTHETIC — obviously fake, but shape-correct so the regexes
// exercise real matching logic. Never a live credential.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, PATTERNS, luhn, shannonEntropy } = require('./secret-shield-detect.cjs');

// Every secret-SHAPED fixture is assembled at runtime in one place — see
// secret-shield-fixtures.cjs for why a literal here fails the push and the required checks.
const { FIXTURES } = require('./secret-shield-fixtures.cjs');

function typesOf(detections) {
  return detections.map((d) => d.type);
}

// -------------------------------------------------------------------------------------------
// Live-format (fake) secret fixtures
// -------------------------------------------------------------------------------------------

test('detects a fake Stripe live key', () => {
  const text = `STRIPE_KEY=${FIXTURES.stripeKey}`;
  const found = detect(text).filter((d) => d.type === 'SECRET_STRIPE_KEY');
  assert.equal(found.length, 1);
});

test('detects a fake GitHub token', () => {
  const text = `token: ${FIXTURES.githubToken}`;
  const found = detect(text).filter((d) => d.type === 'SECRET_GITHUB_TOKEN');
  assert.equal(found.length, 1);
});

test('detects a fake AWS access key id and secret key', () => {
  const text = [
    `aws_access_key_id = ${FIXTURES.awsAccessKey}`,
    `aws_secret_access_key = ${FIXTURES.awsSecretKey}`,
  ].join('\n');
  const found = detect(text);
  assert.ok(typesOf(found).includes('SECRET_AWS_ACCESS_KEY'));
  assert.ok(typesOf(found).includes('SECRET_AWS_SECRET_KEY'));
});

test('detects a fake PEM private key block', () => {
  const text = [
    FIXTURES.pemHeader,
    'MIIFAKEKEYDATANOTREALoooooooooooooooooooooooooo0000000000000',
    'MOREFAKEBASE64FAKEBASE64FAKEBASE64FAKEBASE64FAKEBASE64FAKE0000',
    FIXTURES.pemFooter,
  ].join('\n');
  const found = detect(text).filter((d) => d.type === 'SECRET_PEM_PRIVATE_KEY');
  assert.equal(found.length, 1);
  assert.ok(found[0].value.includes('BEGIN RSA PRIVATE KEY'));
});

test('detects a fake JWT', () => {
  // Header/payload/signature are dummy base64url segments, not a real signed token.
  const text =
    `Authorization: Bearer ${FIXTURES.jwt}`;
  const found = detect(text).filter((d) => d.type === 'SECRET_JWT');
  assert.equal(found.length, 1);
});

test('detects a fake postgres connection string with inline credentials', () => {
  const text = 'DATABASE_URL=postgres://appuser:hunter2fake@db.example.internal:5432/appdb';
  const found = detect(text).filter((d) => d.type === 'SECRET_CONNECTION_STRING');
  assert.equal(found.length, 1);
});

// -------------------------------------------------------------------------------------------
// PII / PHI fixtures
// -------------------------------------------------------------------------------------------

test('detects an SSN', () => {
  const found = detect('SSN: 123-45-6789').filter((d) => d.type === 'PII_SSN');
  assert.equal(found.length, 1);
});

test('detects a Luhn-valid card number', () => {
  // 4111111111111111 is the well-known synthetic Visa test number (Luhn-valid, not a real card).
  const found = detect('card 4111 1111 1111 1111').filter((d) => d.type === 'PII_CARD');
  assert.equal(found.length, 1);
});

test('rejects a Luhn-invalid 16-digit number as PII_CARD', () => {
  const found = detect('number 1234567890123456').filter((d) => d.type === 'PII_CARD');
  assert.equal(found.length, 0);
});

test('detects an email', () => {
  const found = detect('contact jane.doe@example.com for details').filter(
    (d) => d.type === 'PII_EMAIL'
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].value, 'jane.doe@example.com');
});

test('detects a phone number', () => {
  const found = detect('call me at 555-123-4567').filter((d) => d.type === 'PII_PHONE');
  assert.equal(found.length, 1);
});

test('detects a DOB', () => {
  const found = detect('DOB 1974-03-02').filter((d) => d.type === 'PII_DOB');
  assert.equal(found.length, 1);
});

test('detects an MRN', () => {
  const found = detect('MRN 4482910').filter((d) => d.type === 'PHI_MRN');
  assert.equal(found.length, 1);
});

// -------------------------------------------------------------------------------------------
// Free-text PHI sentence
// -------------------------------------------------------------------------------------------

test('free-text PHI sentence: finds DOB and MRN, honestly misses the bare name', () => {
  const text = 'patient Jane Doe, DOB 1974-03-02, MRN 4482910';
  const found = detect(text);
  const types = typesOf(found);
  assert.ok(types.includes('PII_DOB'));
  assert.ok(types.includes('PHI_MRN'));
  // HONEST GAP: this detector pack is regex-only and has no name/NER model, so "Jane Doe" is
  // NOT found here and cannot be found by pattern matching alone. A bare person name has no
  // distinguishing shape (unlike an SSN, DOB, or MRN which sit next to explicit context words
  // or fixed digit patterns), so it is not, and cannot be, in the output of this module.
  assert.ok(!types.includes('PII_NAME'), 'PII_NAME is not a type this module defines — by design');
});

// -------------------------------------------------------------------------------------------
// Overlap resolution
// -------------------------------------------------------------------------------------------

test('overlap resolution: overlapping matches collapse to one, longer wins', () => {
  // The connection-string regex's credentials segment ("hunter2fake@db.example.internal") also
  // shape-matches PII_EMAIL ("local@domain"). The two candidate ranges genuinely overlap; the
  // longer SECRET_CONNECTION_STRING match (spanning the whole URL) must be the one kept, and the
  // shorter, fully-contained PII_EMAIL candidate must be dropped rather than reported separately.
  const text = 'DATABASE_URL=postgres://appuser:hunter2fake@db.example.internal:5432/appdb';
  const found = detect(text);
  const overlapping = found.filter(
    (d) => d.type === 'SECRET_CONNECTION_STRING' || d.type === 'PII_EMAIL'
  );
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0].type, 'SECRET_CONNECTION_STRING');
});

test('detect output is sorted ascending by start and ranges never overlap (mixed fixture)', () => {
  const text = [
    `AWS: ${FIXTURES.awsAccessKey2}`,
    `stripe: ${FIXTURES.stripeKey}`,
    'email: jane.doe@example.com',
    'ssn: 123-45-6789',
    'card: 4111 1111 1111 1111',
    'phone: 555-123-4567',
    'dob: DOB 1974-03-02',
    'mrn: MRN 4482910',
    `API_KEY=${FIXTURES.highEntropy}`,
  ].join('\n');
  const found = detect(text);
  assert.ok(found.length > 0);
  for (let i = 0; i < found.length; i++) {
    assert.ok(found[i].end > found[i].start, 'end must be after start');
    if (i > 0) {
      assert.ok(found[i].start >= found[i - 1].start, 'must be sorted ascending by start');
      assert.ok(found[i].start >= found[i - 1].end, 'ranges must not overlap');
    }
  }
});

// -------------------------------------------------------------------------------------------
// Entropy detector
// -------------------------------------------------------------------------------------------

test('entropy detector: high-entropy string assigned to API_KEY is caught as SECRET_ENTROPY', () => {
  const text = `API_KEY=${FIXTURES.highEntropy}`;
  const found = detect(text).filter((d) => d.type === 'SECRET_ENTROPY');
  assert.equal(found.length, 1);
  assert.equal(found[0].detector, 'entropy');
});

test('entropy detector: ordinary English sentence of similar length is NOT flagged even in an assignment', () => {
  const sentence = 'the quick brown fox jumps over the lazy dog again and again';
  const text = `API_KEY=${sentence.slice(0, 42)}`;
  const found = detect(text).filter((d) => d.type === 'SECRET_ENTROPY');
  assert.equal(found.length, 0);
});

test('entropy detector: opts.entropy = false suppresses it', () => {
  const text = `API_KEY=${FIXTURES.highEntropy}`;
  const found = detect(text, { entropy: false }).filter((d) => d.type === 'SECRET_ENTROPY');
  assert.equal(found.length, 0);
});

test('false-positive discipline: a bare high-entropy string in prose (no key/token/secret assignment) is NOT flagged', () => {
  // Same high-entropy payload as above, but with no assignment-to-a-secret-shaped-name context.
  const text = 'the random value zQ9!kR7pL2mN8xW4vB6tY1cD3fH5jS0aQeRtYuIoP appeared in the log';
  const found = detect(text).filter((d) => d.type === 'SECRET_ENTROPY');
  assert.equal(found.length, 0);
});

// -------------------------------------------------------------------------------------------
// opts.detectors allowlist
// -------------------------------------------------------------------------------------------

test('opts.detectors allowlist filters output to only listed types', () => {
  const text = [
    'email: jane.doe@example.com',
    'ssn: 123-45-6789',
    `API_KEY=${FIXTURES.highEntropy}`,
  ].join('\n');
  const found = detect(text, { detectors: ['PII_EMAIL'] });
  assert.equal(found.length, 1);
  assert.equal(found[0].type, 'PII_EMAIL');
});

// -------------------------------------------------------------------------------------------
// luhn / shannonEntropy unit checks
// -------------------------------------------------------------------------------------------

test('luhn validates and rejects correctly', () => {
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('1234567890123456'), false);
});

test('shannonEntropy is higher for random-looking strings than for repetitive ones', () => {
  const low = shannonEntropy('aaaaaaaaaaaaaaaaaaaa');
  const high = shannonEntropy('zQ9!kR7pL2mN8xW4vB6t');
  assert.ok(high > low);
});

// -------------------------------------------------------------------------------------------
// Real-source false-positive check: detect() over hooks/guard-secrets.js must not fire any
// high-confidence detection. If this fails, the patterns are too loose — tighten them, don't
// weaken this test.
// -------------------------------------------------------------------------------------------

test('detect() over hooks/guard-secrets.js source yields zero high-confidence detections', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'guard-secrets.js'), 'utf8');
  const found = detect(src);
  const highConfidence = found.filter((d) => d.confidence === 'high');
  assert.deepEqual(
    highConfidence,
    [],
    `unexpected high-confidence detections in real source: ${JSON.stringify(
      highConfidence.map((d) => ({ type: d.type, start: d.start, end: d.end }))
    )}`
  );
});

// PATTERNS export sanity: exact type strings from the contract must all be represented (except
// SECRET_ENTROPY, which is synthesized separately, not a PATTERNS entry).
test('PATTERNS exports the documented pattern-based types', () => {
  const documented = [
    'SECRET_AWS_ACCESS_KEY',
    'SECRET_AWS_SECRET_KEY',
    'SECRET_GCP_KEY',
    'SECRET_AZURE_KEY',
    'SECRET_GITHUB_TOKEN',
    'SECRET_SLACK_TOKEN',
    'SECRET_STRIPE_KEY',
    'SECRET_OPENAI_KEY',
    'SECRET_ANTHROPIC_KEY',
    'SECRET_PEM_PRIVATE_KEY',
    'SECRET_JWT',
    'SECRET_CONNECTION_STRING',
    'PII_SSN',
    'PII_CARD',
    'PII_EMAIL',
    'PII_PHONE',
    'PII_DOB',
    'PHI_MRN',
  ];
  const actual = PATTERNS.map((p) => p.type);
  for (const t of documented) {
    assert.ok(actual.includes(t), `missing pattern type ${t}`);
  }
});
