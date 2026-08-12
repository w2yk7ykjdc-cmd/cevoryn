import assert from "node:assert/strict";
import test from "node:test";
import { Webhook, WebhookVerificationError } from "standardwebhooks";

/**
 * Exercises the exact verification mechanism the Polar webhook route uses
 * (src/app/api/billing/polar/webhook/route.ts): base64-encode the raw
 * secret, then verify with the real `standardwebhooks` library - the same
 * package @polar-sh/sdk's own validateEvent() depends on. No mocking of
 * the crypto: this is the real HMAC-SHA256 Standard Webhooks algorithm.
 */

const RAW_SECRET = "whsec_test_secret_value";

function makeVerifier(secret: string): Webhook {
  const base64Secret = Buffer.from(secret, "utf-8").toString("base64");
  return new Webhook(base64Secret);
}

function signPayload(
  secret: string,
  msgId: string,
  timestamp: Date,
  payload: string
) {
  const base64Secret = Buffer.from(secret, "utf-8").toString("base64");
  const signer = new Webhook(base64Secret);
  return signer.sign(msgId, timestamp, payload);
}

test("a correctly signed payload is accepted and parsed", () => {
  const payload = JSON.stringify({ type: "subscription.created", data: {} });
  const msgId = "msg_1";
  const timestamp = new Date();
  const signature = signPayload(RAW_SECRET, msgId, timestamp, payload);

  const verifier = makeVerifier(RAW_SECRET);
  const result = verifier.verify(payload, {
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  });

  assert.deepEqual(result, { type: "subscription.created", data: {} });
});

test("invalid signature: a tampered payload is rejected", () => {
  const originalPayload = JSON.stringify({ type: "subscription.created" });
  const tamperedPayload = JSON.stringify({ type: "subscription.revoked" });
  const msgId = "msg_2";
  const timestamp = new Date();
  const signature = signPayload(RAW_SECRET, msgId, timestamp, originalPayload);

  const verifier = makeVerifier(RAW_SECRET);
  assert.throws(() => {
    verifier.verify(tamperedPayload, {
      "webhook-id": msgId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    });
  }, WebhookVerificationError);
});

test("invalid signature: the wrong secret is rejected", () => {
  const payload = JSON.stringify({ type: "subscription.created" });
  const msgId = "msg_3";
  const timestamp = new Date();
  const signature = signPayload(RAW_SECRET, msgId, timestamp, payload);

  const verifier = makeVerifier("whsec_a_completely_different_secret");
  assert.throws(() => {
    verifier.verify(payload, {
      "webhook-id": msgId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    });
  }, WebhookVerificationError);
});

test("invalid signature: a missing webhook-signature header is rejected", () => {
  const payload = JSON.stringify({ type: "subscription.created" });
  const verifier = makeVerifier(RAW_SECRET);
  assert.throws(() => {
    verifier.verify(payload, {
      "webhook-id": "msg_4",
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "webhook-signature": "",
    });
  }, WebhookVerificationError);
});
