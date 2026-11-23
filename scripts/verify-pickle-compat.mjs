// RTW: pickle uyumluluk DOGRULAYICISI. `test-vectors/pickle-compat-*.json` (eski vodozemac
// surumunde uretildi) mevcut pkg-node derlemesinde acilir ve yazisma kaldigi yerden surer.
// Telefon ve webapp kasalarindaki pickle'lar ayni bicimde oldugu icin bu test, surum
// yukseltmesinden sonra kullanicilarin mevcut kimlik ve oturumlarinin bozulmadigini kanitlar.
//
// Run: node scripts/verify-pickle-compat.mjs [vektor.json ...]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const v = require('../pkg-node/kinsh_vodozemac_wasm.js');

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-vectors');
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(dir)
        .filter((f) => f.startsWith('pickle-compat-') && f.endsWith('.json'))
        .map((f) => join(dir, f));
assert.ok(files.length > 0, 'pickle uyumluluk vektoru yok');

for (const file of files) {
  const t = JSON.parse(readFileSync(file, 'utf8'));
  const ids = (acc) => JSON.parse(acc.identityKeys());

  // Hesap: kimlik, imza ve yayimlanmamis anahtarlar korunur.
  const phone = () => v.Account.fromPickle(t.phone.accountPickle);
  const p = phone();
  assert.equal(ids(p).curve25519, t.phone.curve25519, 'telefon curve25519');
  assert.equal(ids(p).ed25519, t.phone.ed25519, 'telefon ed25519');
  // Ed25519 imzasi deterministiktir (RFC 8032): ayni anahtar ayni imzayi uretmeli.
  assert.equal(p.sign(t.phone.signedProbe.message), t.phone.signedProbe.signature, 'imza');
  assert.equal(p.oneTimeKeys(), t.phone.unpublishedOneTimeKeys, 'yayimlanmamis tek kullanimlik anahtarlar');
  assert.equal(ids(v.Account.fromPickle(t.browser.accountPickle)).curve25519, t.browser.curve25519, 'tarayici curve25519');

  // Olm: yukseltmeden once gonderilmis mesajlar cozulur, yazisma iki yonde surer.
  const b2p = v.Session.fromPickle(t.olm.browserToPhoneSession);
  const p2b = v.Session.fromPickle(t.olm.phoneToBrowserSession);
  assert.equal(p2b.sessionId(), t.olm.phoneToBrowserSessionId, 'Olm oturum kimligi');
  assert.equal(p2b.decrypt(t.olm.pendingToPhone.type, t.olm.pendingToPhone.body), t.olm.pendingToPhone.plaintext);
  assert.equal(b2p.decrypt(t.olm.pendingToBrowser.type, t.olm.pendingToBrowser.body), t.olm.pendingToBrowser.plaintext);
  for (let i = 0; i < 3; i++) {
    const a = JSON.parse(b2p.encrypt(`sonra tarayici ${i}`));
    assert.equal(p2b.decrypt(a.type, a.body), `sonra tarayici ${i}`);
    const b = JSON.parse(p2b.encrypt(`sonra telefon ${i}`));
    assert.equal(b2p.decrypt(b.type, b.body), `sonra telefon ${i}`);
  }

  // Eski hesapla prekey: tek kullanimlik anahtarla ve yedek anahtarla gelen oturum acilir.
  for (const pk of [t.olm.prekeyWithOneTimeKey, t.olm.prekeyWithFallbackKey]) {
    const result = phone().createInboundSession(pk.body);
    assert.equal(result.plaintext, pk.plaintext, 'prekey duz metni');
    assert.equal(result.senderIdentityKey, pk.sender, 'prekey gondericisi');
  }

  // Megolm: giden oturum kaldigi indeksten, gelen oturum okunmamis mesajlardan surer.
  const outbound = v.GroupSession.fromPickle(t.megolm.outboundPickle);
  const inbound = v.InboundGroupSession.fromPickle(t.megolm.inboundPickle);
  assert.equal(outbound.sessionId(), t.megolm.sessionId);
  assert.equal(inbound.sessionId(), t.megolm.sessionId);
  assert.equal(outbound.messageIndex(), t.megolm.messages.length, 'Megolm indeksi');
  for (const m of t.megolm.messages) {
    const out = JSON.parse(inbound.decrypt(m.ciphertext));
    assert.equal(out.plaintext, m.plaintext);
    assert.equal(out.messageIndex, m.index);
  }
  const next = outbound.encrypt('sonra grup');
  assert.equal(JSON.parse(inbound.decrypt(next)).plaintext, 'sonra grup');

  console.log(`pickle uyumluluk dogrulandi: ${file} (uretildigi surum: ${t.generatedWith?.vodozemac})`);
}
