// RTW: pickle uyumluluk vektoru URETICISI. vodozemac surumu yukseltilmeden ONCE, eski
// surumun pkg-node derlemesiyle kosar ve uygulamanin gercekte sakladigi her durumu
// pickle'lar. `verify-pickle-compat.mjs` yeni surumde bu pickle'lari acar ve yazismayi
// kaldigi yerden surdurur. Telefon ve webapp kasalarinda duran pickle'lar ayni bicimdedir
// (vodozemac'in serde JSON pickle'i), bu yuzden vektor iki istemciyi birlikte kapsar.
//
// Run: node scripts/generate-pickle-compat.mjs <cikti.json>
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const v = require('../pkg-node/kinsh_vodozemac_wasm.js');
const out = process.argv[2];
assert.ok(out, 'cikti yolu gerekli');

const curve = (acc) => JSON.parse(acc.identityKeys()).curve25519;
const ed = (acc) => JSON.parse(acc.identityKeys()).ed25519;

// Telefon (ana cihaz) ve tarayici (bagli cihaz).
const phone = new v.Account();
const browser = new v.Account();

// Telefonun havuzu: 3 anahtar yayimlandi, 2'si yayimlanmadi; yedek anahtar var.
phone.generateOneTimeKeys(3);
const publishedOtks = Object.values(JSON.parse(phone.oneTimeKeys()).curve25519);
phone.generateFallbackKey();
// Yedek anahtar yalniz YAYIMLANMADAN once okunabilir (sonra `fallbackKey()` bos doner).
const fallbackKey = Object.values(JSON.parse(phone.fallbackKey()).curve25519)[0];
assert.ok(fallbackKey, 'yedek anahtar uretilmedi');
phone.markKeysAsPublished();
phone.generateOneTimeKeys(2);
const unpublishedBefore = phone.oneTimeKeys();

// 1) Tarayici -> telefon: kurulmus ve iki yonde ilerlemis oturum.
const b2p = browser.createOutboundSession(curve(phone), publishedOtks[0]);
const first = JSON.parse(b2p.encrypt('tarayici: ilk'));
const phoneInbound = phone.createInboundSession(first.body);
assert.equal(phoneInbound.plaintext, 'tarayici: ilk');
const p2b = phoneInbound.takeSession();
const r1 = JSON.parse(p2b.encrypt('telefon: cevap'));
assert.equal(b2p.decrypt(r1.type, r1.body), 'telefon: cevap');
const r2 = JSON.parse(b2p.encrypt('tarayici: ikinci'));
assert.equal(p2b.decrypt(r2.type, r2.body), 'tarayici: ikinci');

// 2) Iletilmis ama henuz OKUNMAMIS mesajlar: yukseltmeden sonra cozulmeli.
const pendingToPhone = JSON.parse(b2p.encrypt('tarayici: yukseltmeden once gonderildi'));
const pendingToBrowser = JSON.parse(p2b.encrypt('telefon: yukseltmeden once gonderildi'));

// 3) Henuz acilmamis prekey mesaji: yukseltmeden sonra eski hesapla gelen oturum acilmali
//    (ikinci yayimlanmis tek kullanimlik anahtar) ve yedek anahtarla bir tane daha.
const stranger = new v.Account();
const prekeyOtk = JSON.parse(
  stranger.createOutboundSession(curve(phone), publishedOtks[1]).encrypt('yabanci: tek kullanimlik anahtarla'),
);
const fallbackSender = new v.Account();
const prekeyFallback = JSON.parse(
  fallbackSender.createOutboundSession(curve(phone), fallbackKey).encrypt('yabanci: yedek anahtarla'),
);

// 4) Megolm: giden oturum 5 mesaj ilerledi; gelen oturum ilk 3'u okudu.
const outbound = new v.GroupSession();
const inbound = new v.InboundGroupSession(outbound.sessionKey());
const groupMessages = ['g0', 'g1', 'g2', 'g3', 'g4'].map((text, index) => ({
  index,
  plaintext: text,
  ciphertext: outbound.encrypt(text),
}));
for (const m of groupMessages.slice(0, 3)) {
  assert.equal(JSON.parse(inbound.decrypt(m.ciphertext)).plaintext, m.plaintext);
}

const vector = {
  description:
    'RTW pickle uyumluluk vektoru: eski vodozemac surumunde uretilen pickle\'lar yeni surumde acilmali ve yazisma kaldigi yerden surmeli.',
  generatedWith: { package: '@kinsh/vodozemac-wasm (rtw-vodozemac-build pkg-node)', vodozemac: process.env.VODOZEMAC_VERSION ?? 'unknown' },
  phone: {
    accountPickle: phone.pickle(),
    curve25519: curve(phone),
    ed25519: ed(phone),
    unpublishedOneTimeKeys: unpublishedBefore,
    signedProbe: { message: 'rtw-sign-probe', signature: phone.sign('rtw-sign-probe') },
  },
  browser: { accountPickle: browser.pickle(), curve25519: curve(browser) },
  olm: {
    browserToPhoneSession: b2p.pickle(),
    phoneToBrowserSession: p2b.pickle(),
    phoneToBrowserSessionId: p2b.sessionId(),
    pendingToPhone: { ...pendingToPhone, plaintext: 'tarayici: yukseltmeden once gonderildi' },
    pendingToBrowser: { ...pendingToBrowser, plaintext: 'telefon: yukseltmeden once gonderildi' },
    prekeyWithOneTimeKey: { ...prekeyOtk, plaintext: 'yabanci: tek kullanimlik anahtarla', sender: curve(stranger) },
    prekeyWithFallbackKey: { ...prekeyFallback, plaintext: 'yabanci: yedek anahtarla', sender: curve(fallbackSender) },
  },
  megolm: {
    sessionId: outbound.sessionId(),
    outboundPickle: outbound.pickle(),
    inboundPickle: inbound.pickle(),
    messages: groupMessages,
    readUpTo: 2,
  },
};

writeFileSync(out, JSON.stringify(vector, null, 2) + '\n');
console.log(`pickle uyumluluk vektoru yazildi: ${out}`);
