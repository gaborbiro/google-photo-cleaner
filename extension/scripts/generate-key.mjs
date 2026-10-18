// One-off: generates the manifest "key" that pins the unpacked extension's ID, so it stays the
// same wherever it is loaded from. The private key is not needed for unpacked installs and is
// discarded.
import { generateKeyPairSync, createHash } from 'node:crypto';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const key = der.toString('base64');
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
  .join('');

console.log(JSON.stringify({ key, id }, null, 2));
