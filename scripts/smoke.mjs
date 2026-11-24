// Olm + Megolm smoke test against pkg-node. Run: node scripts/smoke.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const v = require('../pkg-node/kinsh_vodozemac_wasm.js');

// ── Olm (1:1) ───────────────────────────────────────────────────────────────

{
  const alice = new v.Account();
  const bob = new v.Account();
  bob.generateOneTimeKeys(1);
  const bobIdentity = JSON.parse(bob.identityKeys()).curve25519;
  const bobOtk = Object.values(JSON.parse(bob.oneTimeKeys()).curve25519)[0];
  bob.markKeysAsPublished();

  const aliceSession = alice.createOutboundSession(bobIdentity, bobOtk);
  const enc = JSON.parse(aliceSession.encrypt('hello bob'));
  assert.equal(enc.type, 0); // prekey

  const inbound = bob.createInboundSession(enc.body);
  assert.equal(inbound.plaintext, 'hello bob');
  assert.equal(
    inbound.senderIdentityKey,
    JSON.parse(alice.identityKeys()).curve25519,
  );

  const bobSession = inbound.takeSession();
  const reply = JSON.parse(bobSession.encrypt('hi alice'));
  assert.equal(aliceSession.decrypt(reply.type, reply.body), 'hi alice');

  // Pickle round-trips.
  const aliceRestored = v.Session.fromPickle(aliceSession.pickle());
  const enc2 = JSON.parse(aliceRestored.encrypt('after pickle'));
  assert.equal(bobSession.decrypt(enc2.type, enc2.body), 'after pickle');
  assert.equal(
    v.Account.fromPickle(alice.pickle()).identityKeys(),
    alice.identityKeys(),
  );
  console.log('olm smoke: all checks passed');
}

// ── RTW: forgetFallbackKey ──────────────────────────────────────────────────

{
  const bob = new v.Account();
  const bobId = JSON.parse(bob.identityKeys()).curve25519;
  const fallbackOf = (a) => Object.values(JSON.parse(a.fallbackKey()).curve25519)[0];
  const prekeyTo = (key) => JSON.parse(new v.Account().createOutboundSession(bobId, key).encrypt('x')).body;

  assert.equal(bob.forgetFallbackKey(), false);
  bob.generateFallbackKey();
  const oldKey = fallbackOf(bob);
  bob.markKeysAsPublished();
  bob.generateFallbackKey();
  const newKey = fallbackOf(bob);
  bob.markKeysAsPublished();

  assert.equal(bob.createInboundSession(prekeyTo(oldKey)).plaintext, 'x');
  assert.equal(bob.forgetFallbackKey(), true);
  assert.equal(bob.forgetFallbackKey(), false);
  assert.throws(() => bob.createInboundSession(prekeyTo(oldKey)));
  assert.equal(bob.createInboundSession(prekeyTo(newKey)).plaintext, 'x');
  assert.throws(() => v.Account.fromPickle(bob.pickle()).createInboundSession(prekeyTo(oldKey)));
  console.log('forgetFallbackKey smoke: all checks passed');
}

// ── Megolm (group) ──────────────────────────────────────────────────────────

{
  const outbound = new v.GroupSession();
  assert.equal(outbound.messageIndex(), 0);
  const sessionKey = outbound.sessionKey();
  const sessionId = outbound.sessionId();

  const inbound = new v.InboundGroupSession(sessionKey);
  assert.equal(inbound.sessionId(), sessionId);
  assert.equal(inbound.firstKnownIndex(), 0);

  // Round trip several messages; indexes advance.
  const msgs = ['first', 'second', 'third'].map((m) => outbound.encrypt(m));
  assert.equal(outbound.messageIndex(), 3);
  msgs.forEach((body, i) => {
    const { plaintext, messageIndex } = JSON.parse(inbound.decrypt(body));
    assert.equal(plaintext, ['first', 'second', 'third'][i]);
    assert.equal(messageIndex, i);
  });

  // Pickle / restore both sides, session keeps working.
  const outbound2 = v.GroupSession.fromPickle(outbound.pickle());
  const inbound2 = v.InboundGroupSession.fromPickle(inbound.pickle());
  const m4 = outbound2.encrypt('fourth, after pickle');
  assert.equal(
    JSON.parse(inbound2.decrypt(m4)).plaintext,
    'fourth, after pickle',
  );

  // Late joiner: shares the current ratchet, cannot read history.
  const late = new v.InboundGroupSession(outbound2.sessionKey());
  assert.equal(late.firstKnownIndex(), 4);
  assert.throws(() => late.decrypt(msgs[0]));
  const m5 = outbound2.encrypt('fifth, for everyone');
  assert.equal(JSON.parse(late.decrypt(m5)).plaintext, 'fifth, for everyone');

  // Export at an index + import (history-sharing path).
  const exported = inbound2.exportAt(2);
  assert.ok(exported, 'exportAt(2) should return a key');
  const imported = v.InboundGroupSession.import(exported);
  assert.equal(imported.firstKnownIndex(), 2);
  assert.equal(JSON.parse(imported.decrypt(msgs[2])).plaintext, 'third');
  assert.throws(() => imported.decrypt(msgs[0])); // below first known index
  assert.equal(imported.exportAt(0), undefined); // below firstKnownIndex
  assert.ok(inbound2.exportAt(999)); // future indexes: ratchet forward

  // Tampered ciphertext must fail.
  const tampered =
    m5.slice(0, -6) + (m5.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
  assert.throws(() => inbound2.decrypt(tampered));

  console.log('megolm smoke: all checks passed');
}
