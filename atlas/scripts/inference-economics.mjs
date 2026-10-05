#!/usr/bin/env node

/**
 * Convert measured inference throughput + GPU cost into a Cevoryn
 * self-hosting break-even analysis.
 *
 * Defaults intentionally use conservative published SGLang numbers rather
 * than the best-case single benchmark. Override with env vars after running
 * the black-box benchmark:
 *
 *   GPU_HOURLY_COST=4.59
 *   GPU_COUNT=8
 *   OUTPUT_TOKENS_PER_SECOND=277
 *   UTILIZATION=0.50
 *   INPUT_OUTPUT_RATIO=10
 *   node scripts/inference-economics.mjs
 */

const n = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
};

const gpuHourlyCost = n("GPU_HOURLY_COST", 4.59);
const gpuCount = n("GPU_COUNT", 8);
const outputTokensPerSecond = n("OUTPUT_TOKENS_PER_SECOND", 277);
const utilization = n("UTILIZATION", 0.50);
const inputOutputRatio = n("INPUT_OUTPUT_RATIO", 10);
const daysPerMonth = n("DAYS_PER_MONTH", 30);

const monthlyGpuCost = gpuHourlyCost * gpuCount * 24 * daysPerMonth;
const monthlyOutputCapacity =
  outputTokensPerSecond * 3600 * 24 * daysPerMonth * utilization;
const monthlyInputCapacity = monthlyOutputCapacity * inputOutputRatio;
const monthlyTotalCapacity = monthlyOutputCapacity + monthlyInputCapacity;

const models = [
  { name: "GPT-5.6 Terra", input: 2.00, output: 12.00 },
  { name: "GPT-5.4 Mini", input: 0.75, output: 4.50 },
  { name: "GPT-5 Mini", input: 0.25, output: 2.00 },
];

const results = models.map((model) => {
  const selfHostedPer1MTotal = monthlyGpuCost / (monthlyTotalCapacity / 1_000_000);
  const apiCostPer1MOutputEquivalent =
    (inputOutputRatio * model.input + model.output) / 1_000_000;
  const apiCostPer1MTotal = inputOutputRatio * model.input + model.output;
  const breakEvenTotalTokens =
    monthlyGpuCost / (apiCostPer1MTotal / 1_000_000);
  const breakEvenOutputTokens =
    breakEvenTotalTokens / (inputOutputRatio + 1);

  return {
    model: model.name,
    apiCostPer1MTotalTokens: Number(apiCostPer1MTotal.toFixed(2)),
    selfHostedPer1MTotalTokens: Number(selfHostedPer1MTotal.toFixed(2)),
    breakEvenTotalTokensM: Number((breakEvenTotalTokens / 1_000_000).toFixed(1)),
    breakEvenOutputTokensM: Number((breakEvenOutputTokens / 1_000_000).toFixed(1)),
  };
});

const summary = {
  assumptions: {
    gpuHourlyCost,
    gpuCount,
    outputTokensPerSecond,
    utilization,
    inputOutputRatio,
    daysPerMonth,
  },
  monthlyGpuCost: Number(monthlyGpuCost.toFixed(2)),
  sustainableOutputTokensM: Number((monthlyOutputCapacity / 1_000_000).toFixed(1)),
  sustainableInputTokensM: Number((monthlyInputCapacity / 1_000_000).toFixed(1)),
  sustainableTotalTokensM: Number((monthlyTotalCapacity / 1_000_000).toFixed(1)),
  comparisons: results,
};

console.table(results);
console.log(JSON.stringify(summary, null, 2));
