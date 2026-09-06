import assert from "node:assert/strict";
import test from "node:test";

import { isSafePublicUrl } from "../src/features/radar/signals/adapters/url-safety";

test("accepts ordinary public https/http URLs", () => {
  assert.equal(isSafePublicUrl("https://example.com/feed.xml"), true);
  assert.equal(isSafePublicUrl("http://example.com/feed.xml"), true);
});

test("rejects non-http(s) schemes", () => {
  assert.equal(isSafePublicUrl("file:///etc/passwd"), false);
  assert.equal(isSafePublicUrl("ftp://example.com/feed.xml"), false);
  assert.equal(isSafePublicUrl("gopher://example.com"), false);
});

test("rejects malformed URLs", () => {
  assert.equal(isSafePublicUrl("not a url"), false);
  assert.equal(isSafePublicUrl(""), false);
});

test("rejects localhost", () => {
  assert.equal(isSafePublicUrl("http://localhost/feed"), false);
  assert.equal(isSafePublicUrl("http://localhost:3000/feed"), false);
  assert.equal(isSafePublicUrl("http://sub.localhost/feed"), false);
});

test("rejects loopback and private IPv4 ranges", () => {
  assert.equal(isSafePublicUrl("http://127.0.0.1/feed"), false);
  assert.equal(isSafePublicUrl("http://10.0.0.5/feed"), false);
  assert.equal(isSafePublicUrl("http://172.16.0.1/feed"), false);
  assert.equal(isSafePublicUrl("http://172.31.255.255/feed"), false);
  assert.equal(isSafePublicUrl("http://192.168.1.1/feed"), false);
});

test("rejects the cloud-metadata link-local address", () => {
  assert.equal(isSafePublicUrl("http://169.254.169.254/latest/meta-data"), false);
});

test("rejects carrier-grade NAT range", () => {
  assert.equal(isSafePublicUrl("http://100.64.0.1/feed"), false);
});

test("does not reject a public IP that merely resembles a private one outside the actual range", () => {
  // 172.15.x.x and 172.32.x.x are outside the 172.16.0.0/12 private block.
  assert.equal(isSafePublicUrl("http://172.15.0.1/feed"), true);
  assert.equal(isSafePublicUrl("http://172.32.0.1/feed"), true);
});

test("rejects IPv6 loopback and link-local/unique-local addresses", () => {
  assert.equal(isSafePublicUrl("http://[::1]/feed"), false);
  assert.equal(isSafePublicUrl("http://[fe80::1]/feed"), false);
  assert.equal(isSafePublicUrl("http://[fc00::1]/feed"), false);
});

test("accepts a normal public hostname that is not an IP literal", () => {
  assert.equal(isSafePublicUrl("https://news.ycombinator.com/rss"), true);
});
