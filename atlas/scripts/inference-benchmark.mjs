#!/usr/bin/env node

/**
 * Minimal black-box benchmark for any OpenAI-compatible inference endpoint.
 *
 * Usage:
 *   LOCAL_AI_BASE_URL=http://host:30000/v1 \
 *   LOCAL_AI_MODEL=deepseek-ai/DeepSeek-V3 \
 *   node scripts/inference-benchmark.mjs
 *
 * This intentionally does not import Next.js internals. It measures the
 * deployed runtime as Cevoryn will actually see it.
 */

const baseURL = process.env.LOCAL_AI_BASE_URL;
const model = process.env.LOCAL_AI_MODEL;
const apiKey = process.env.LOCAL_AI_API_KEY ?? "local-runtime";

if (!baseURL || !model) {
  console.error("Set LOCAL_AI_BASE_URL and LOCAL_AI_MODEL");
  process.exit(1);
}

const cases = [
  {
    id: "brief",
    system: "You are Cevoryn. Summarize business context concisely and accurately.",
    user: "Summarize this signal in 5 bullet points and identify the single most important action: revenue fell 12% this month, two enterprise customers delayed renewals, support volume rose 18%, and cash runway is 7 months.",
  },
  {
    id: "decision",
    system: "You are Cevoryn. Analyze decisions using evidence, options, risks and recommendation.",
    user: "Should a 12-person SaaS company prioritize reducing cloud costs or hiring one enterprise salesperson this quarter? Give evidence, assumptions, risks and a recommendation.",
  },
  {
    id: "extraction",
    system: "Extract structured business facts accurately. Return only JSON.",
    user: "The customer said they will renew if SSO and SCIM are available by November. Their current contract is $48,000 ARR and procurement requires security review.",
  },
];

async function runCase(testCase) {
  const started = performance.now();
  const response = await fetch(baseURL.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: testCase.system },
        { role: "user", content: testCase.user },
      ],
      temperature: 0.2,
      max_tokens: 600,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`${testCase.id}: HTTP ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  const elapsedMs = performance.now() - started;
  const usage = json.usage ?? {};

  return {
    id: testCase.id,
    elapsedMs: Math.round(elapsedMs),
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    outputTokensPerSecond:
      usage.completion_tokens && elapsedMs > 0
        ? Number((usage.completion_tokens / (elapsedMs / 1000)).toFixed(2))
        : 0,
  };
}

const results = [];
for (const testCase of cases) {
  results.push(await runCase(testCase));
}

console.table(results);

const totals = results.reduce(
  (a, r) => ({
    inputTokens: a.inputTokens + r.inputTokens,
    outputTokens: a.outputTokens + r.outputTokens,
    totalTokens: a.totalTokens + r.totalTokens,
    elapsedMs: a.elapsedMs + r.elapsedMs,
  }),
  { inputTokens: 0, outputTokens: 0, totalTokens: 0, elapsedMs: 0 }
);

console.log(JSON.stringify({
  model,
  baseURL,
  cases: results.length,
  ...totals,
  aggregateOutputTokensPerSecond:
    totals.outputTokens > 0
      ? Number((totals.outputTokens / (totals.elapsedMs / 1000)).toFixed(2))
      : 0,
}, null, 2));
