// Round-trips an encrypted settings export.
//
// A bug in this path is invisible until someone tries to restore a backup, by
// which point the machine that produced it is usually gone — so it is checked
// against the real module rather than a copy of the logic. The module is
// compiled on the fly because the app's TypeScript is not built at test time.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-crypto-'));

// CommonJS output: tsc emits extension-less specifiers, which Node's ESM
// resolver rejects but its CJS resolver handles.
function compileCryptoModule() {
  const tsc = path.join(repoRoot, 'node_modules', '.bin', 'tsc');
  execFileSync(tsc, [
    path.join(repoRoot, 'app', 'settings-crypto.main.ts'),
    '--outDir', outDir,
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--skipLibCheck'
  ], { stdio: 'pipe' });

  return path.join(outDir, 'app', 'settings-crypto.main.js');
}

const { encryptSettings, decryptSettings, MIN_PASSPHRASE_LENGTH } =
  createRequire(import.meta.url)(compileCryptoModule());

const meta = { appVersion: '4.1.10', exportedAt: '2026-08-03T02:00:00.000Z', source: 'manual' };
const settings = {
  commonConfig: {
    labID: 'LAB001',
    mysqlHost: '127.0.0.1',
    mysqlPassword: 'ENC(0011:2233:4455)',
    encryptionKey: 'a'.repeat(64)
  },
  lisApiConfig: { url: 'https://lis.example.test', credentials: { token: 'secret-token' } },
  instrumentsConfig: [{ instrumentId: 'ROCHE-1', port: 4001 }],
  encryptionKey: 'b'.repeat(64),
  unicodeCheck: 'Laboratoire — Ébola ✓'
};

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

try {
  const passphrase = 'correct horse battery staple';
  const envelope = encryptSettings(settings, passphrase, meta);

  check('the correct passphrase restores the settings exactly', () => {
    assert.deepEqual(decryptSettings(envelope, passphrase), settings);
  });

  check('credentials are not readable in the written file', () => {
    const onDisk = JSON.stringify(envelope);
    assert.ok(!onDisk.includes('secret-token'), 'LIS token appears in the exported file');
    assert.ok(!onDisk.includes('ENC(0011:2233:4455)'), 'MySQL password appears in the exported file');
    assert.ok(!onDisk.includes('LAB001'), 'lab identity appears in the exported file');
  });

  check('a wrong passphrase throws rather than returning partial data', () => {
    assert.throws(() => decryptSettings(envelope, 'wrong passphrase entirely'));
  });

  check('a passphrase differing by one character throws', () => {
    assert.throws(() => decryptSettings(envelope, 'correct horse battery stapl3'));
  });

  check('tampering with the ciphertext is detected', () => {
    const tampered = JSON.parse(JSON.stringify(envelope));
    const bytes = Buffer.from(tampered.payload, 'base64');
    bytes[0] ^= 0xff;
    tampered.payload = bytes.toString('base64');
    assert.throws(() => decryptSettings(tampered, passphrase));
  });

  check('tampering with the auth tag is detected', () => {
    const tampered = JSON.parse(JSON.stringify(envelope));
    const tag = Buffer.from(tampered.cipher.authTag, 'base64');
    tag[0] ^= 0xff;
    tampered.cipher.authTag = tag.toString('base64');
    assert.throws(() => decryptSettings(tampered, passphrase));
  });

  check('each export uses a fresh salt and IV', () => {
    const second = encryptSettings(settings, passphrase, meta);
    assert.notEqual(envelope.kdf.salt, second.kdf.salt);
    assert.notEqual(envelope.cipher.iv, second.cipher.iv);
    assert.notEqual(envelope.payload, second.payload);
  });

  check('the envelope records the parameters needed to decrypt it later', () => {
    assert.equal(envelope.kdf.name, 'scrypt');
    assert.equal(envelope.cipher.name, 'aes-256-gcm');
    assert.ok(envelope.kdf.N > 0 && envelope.kdf.r > 0 && envelope.kdf.p > 0);
    assert.equal(envelope.kdf.keyLength, 32);
    assert.equal(envelope.encrypted, true);
    assert.equal(typeof envelope.schemaVersion, 'number');
  });

  check('decryption follows the parameters recorded in the file', () => {
    // If a future build raises the default cost, old files must still open —
    // which only works if decryption reads N from the envelope rather than
    // from the current constant. Changing the recorded N derives a different
    // key, so this must fail.
    const rewritten = { ...envelope, kdf: { ...envelope.kdf, N: 16384 } };
    assert.throws(() => decryptSettings(rewritten, passphrase));
  });

  check('the minimum passphrase length is enforced somewhere sane', () => {
    assert.ok(MIN_PASSPHRASE_LENGTH >= 8);
  });

  console.log(`\nsettings crypto: ${passed} checks passed`);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
