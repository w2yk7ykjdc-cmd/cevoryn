# Cevoryn Inference Runtime POC

## Goal

Evaluate a self-hosted inference path without changing existing Brain/Radar behavior.

## Current integration boundary

Cevoryn already exposes an AIProvider abstraction under `src/features/ai/providers`.
The POC must preserve that contract.

## Target architecture

Request -> model router -> AIProvider
- external: OpenAI (existing)
- local: OpenAI-compatible inference endpoint
  - SGLang
  - DeepSeek model
  - DeepGEMM / DeepEP on NVIDIA GPU

The Next.js application remains the control plane. GPU inference is a separate runtime.

## Phase 1: shadow benchmark

Do not route production traffic to local inference.

Capture representative workloads from:
- Chat
- Memory extraction
- Insight detection
- Brief generation
- Decision analysis

For every workload compare:
- output quality
- input/output tokens
- TTFT
- tokens/sec
- p95 latency
- GPU utilization
- effective $ / 1M input tokens
- effective $ / 1M output tokens
- failure rate

## Acceptance gates

Local inference can become eligible for production routing only if:
1. quality is non-inferior for the workload class;
2. p95 latency is acceptable;
3. effective cost is materially below the external provider;
4. structured outputs/actions remain contract-compatible;
5. fallback to OpenAI is automatic on local-runtime failure.

## Important non-goals

- Do not replace OpenAI globally.
- Do not add DeepGEMM as a dependency to the Next.js app.
- Do not deploy GPUs before benchmark evidence exists.
- Do not change existing Brain/Radar semantics.

## Runtime contract

The local server should expose an OpenAI-compatible API. Cevoryn should only know the provider endpoint/model configuration, not CUDA/SGLang/DeepGEMM internals.

## Recommended first hardware test

8x H200 is the reference benchmark target for DeepSeek-class MoE inference. Compare against the actual cloud GPU hourly price available at test time.

## Decision formula

effective_cost_per_1m_output =
  total_runtime_cost / sustainable_output_tokens * 1,000,000

Total runtime cost must include GPU, CPU/RAM, network, storage, orchestration and idle capacity.

## Rollout

1. benchmark harness
2. local OpenAI-compatible provider
3. shadow traffic
4. quality/cost report
5. guarded routing for selected task classes
6. automatic external fallback
