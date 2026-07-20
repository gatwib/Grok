import assert from 'node:assert/strict';
import { generateKeyB64, parseKeyB64, sealUtf8, unsealUtf8 } from './seal-crypto.js';

const key = parseKeyB64(generateKeyB64());
const plain = "Object.defineProperty(MouseEvent.prototype, 'screenX', { value: 1 });\n";
const blob = sealUtf8(plain, key, 'test');
assert.equal(blob.v, 1);
assert.equal(blob.alg, 'AES-256-GCM');
assert.equal(unsealUtf8(blob, key), plain);

const bad = Buffer.from(key);
bad[0] ^= 0xff;
assert.throws(() => unsealUtf8(blob, bad));
console.log('seal-crypto selfcheck ok');
