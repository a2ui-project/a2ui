/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * MIME type used by the Format Playground A2A server for in-band turn traces.
 */
export const PLAYGROUND_TRACE_MIME_TYPE = 'application/x-a2ui-playground-trace+json';

/**
 * Stage 1 (Block Input): how the DecisionBlock was produced.
 */
export interface BlockInputStage {
  /** Which Stage 1 path produced the block (`llm`, `direct_tool`, `tool_call`, or `pasted_json`). */
  source: 'llm' | 'direct_tool' | 'tool_call' | 'pasted_json';
  /** Stage 1 LLM model identifier, or `null` for 0-LLM turns. */
  model: string | null;
  /** Number of Stage 1 LLM calls (0 or 1). */
  llmCalls: number;
  /** Wall-clock latency of Stage 1 in milliseconds. */
  latencyMs: number;
  /** Input prompt token count for Stage 1. */
  promptTokens: number;
  /** Generated output token count for Stage 1. */
  outputTokens: number;
  /** Raw text or JSON input string when available. */
  rawText: string | null;
  /** Name of the sample tool invoked on `direct_tool` or `tool_call` turns. */
  toolName: string | null;
  /** Tool arguments dictionary when a sample tool was invoked. */
  toolArgs: Record<string, unknown> | null;
  /** Extracted `<a2ui-block>` fields and structured payload, or `null` on failure. */
  block: {
    intent: string;
    payload: unknown;
    surfaceId: string | null;
    title: string | null;
    summary: string | null;
    layout: string | null;
    region: string | null;
    operation: string | null;
    mutablePaths: string[];
    actions: Array<{name: string; label: string; context: string[]}>;
  } | null;
  /** Error message when Stage 1 failed to produce a valid block. */
  error: string | null;
}

/**
 * Stage 2 (Decision Input): the question batch sent to the decision backend.
 */
export interface DecisionInputStage {
  /** Decision backend identifier (`gemini`, `jev`, `systemone`, or `in_process`). */
  backendKind: string;
  /** Underlying decision model identifier. */
  modelId: string;
  /** Remote decision endpoint URL, or `null` for in-process backends. */
  endpointUrl: string | null;
  /** Wire format family used to serialize the decision batch. */
  wireFormat: 'gemini_decisions' | 'systemone' | 'jev' | 'in_process';
  /** Number of decision backend HTTP calls (0 on `PlanCache` hit). */
  decisionCalls: number;
  /** Whether the layout plan was served from `PlanCache`. */
  cacheHit: boolean;
  /** Structural shape signature used as the `PlanCache` lookup key. */
  shapeSignature: string | null;
  /** Compact payload outline JSON string sent as decision context. */
  contextJson: string;
  /** Total number of speculative questions in the batch. */
  questionCount: number;
  /** Serialized speculative boolean and categorical decision questions. */
  questions: Array<{
    id: string;
    kind: 'boolean' | 'categorical';
    prompt: string;
    options: Array<{value: string; description: string}>;
    trueDescription: string;
    falseDescription: string;
    pruned: boolean;
  }>;
  /** Reconstructed wire JSON request body for the active decision backend. */
  wireRequest: Record<string, unknown> | null;
}

/**
 * Stage 3 (Decision Output & Plan): probability distribution and chosen LayoutPlan.
 */
export interface DecisionOutputStage {
  /** Terminal synthesis stage (`template_select`, `archetype`, or `abstain_fallback`). */
  stage: 'template_select' | 'archetype' | 'abstain_fallback';
  /** Overall synthesis confidence score in `[0.0, 1.0]`. */
  confidence: number;
  /** Optional layout fit score in `[0.0, 1.0]`, or `null`. */
  fitScore: number | null;
  /** Selected pre-authored catalog template identifier when `stage === 'template_select'`. */
  selectedTemplateId: string | null;
  /** Fallback source stage when synthesis abstained or fell back. */
  fallbackSource: string | null;
  /** Reason code explaining why synthesis abstained or fell back. */
  fallbackReason: string | null;
  /** Surface operation (`create_surface` or `update_components`). */
  operation: string;
  /** Per-question probability distributions and threshold gate outcomes. */
  records: Array<{
    questionId: string;
    kind: 'boolean' | 'categorical';
    winner: string;
    winnerProb: number;
    threshold: number | null;
    outcome: string;
    pruned: boolean;
    probabilities: Array<{option: string; prob: number}>;
  }>;
  /** Synthesized layout plan summary, or `null` when synthesis abstained. */
  layoutPlan: {
    surfaceId: string;
    archetype: string;
    rootContainer: string;
    title: string;
    summary: string;
    confidence: number;
    fitScore: number;
    blocks: Array<{
      blockId: string;
      pattern: string;
      component: string;
      pointer: string;
      label: string;
      role: string;
      children: string[];
    }>;
  } | null;
  /** Raw probability answers keyed by question ID for the raw wire JSON view. */
  rawAnswers: Array<{
    id: string;
    kind: 'boolean' | 'categorical';
    yes?: number;
    no?: number;
    probabilities?: Record<string, number>;
  }>;
}

/**
 * Stage 2 trace for LLM-based rendering modes (`express` or `direct`).
 */
export interface LlmStage2Trace {
  /** Truncated preview of the Stage 2 synthesis prompt sent to the LLM. */
  promptPreview: string;
  /** Truncated raw LLM reply text, or `null` on failure. */
  rawReply: string | null;
  /** Number of self-correction retries performed during compilation. */
  retries: number;
}

/**
 * Stage 4 (A2UI JSON & Decompiled Express): final wire output.
 */
export interface WireJsonStage {
  /** Target surface identifier for the rendered candidate. */
  surfaceId: string;
  /** Surface operation (`create_surface`, `update_components`, or `none`). */
  operation: string;
  /** Total number of A2UI v0.9 wire messages emitted for the candidate. */
  messageCount: number;
  /** Ordered list of top-level A2UI message kinds (`createSurface`, `updateComponents`, etc.). */
  messageKinds: string[];
  /** Emitted A2UI v0.9 wire message dictionaries. */
  messages: Array<Record<string, unknown>>;
  /** Human-readable A2UI Express DSL decompiled from the emitted wire messages. */
  decompiledExpress: string;
}

/**
 * Per-mode synthesis trace entry (1 entry on normal turns, 3 on `/compare` turns).
 */
export interface CandidateTrace {
  /** Rendering mode identifier (`decision`, `tool`, `express`, or `direct`). */
  mode: 'decision' | 'tool' | 'express' | 'direct';
  /** Surface identifier rendered by this candidate. */
  surfaceId: string;
  /** Whether candidate rendering succeeded without error. */
  ok: boolean;
  /** Error message when candidate rendering failed, or `null`. */
  error: string | null;
  /** Latency, token, call-count, and cache metrics for this candidate. */
  metrics: {
    backend: string;
    modelId: string | null;
    llmCalls: number;
    totalLatencyMs: number;
    decisionLatencyMs: number | null;
    decisionCalls: number | null;
    promptTokens: number;
    outputTokens: number;
    cacheHit: boolean;
  };
  /** Stage 2 decision batch input trace, or `null` for LLM Stage 2 modes. */
  decisionInput: DecisionInputStage | null;
  /** Stage 3 decision output and layout plan trace, or `null` for LLM Stage 2 modes. */
  decisionOutput: DecisionOutputStage | null;
  /** Stage 2 LLM prompt and reply trace for `express` and `direct` modes, or `null`. */
  llmStage2: LlmStage2Trace | null;
  /** Stage 4 A2UI wire messages and decompiled Express DSL. */
  wireOutput: WireJsonStage;
}

/**
 * Complete per-turn trace payload carried in `application/x-a2ui-playground-trace+json`.
 */
export interface PlaygroundTurnTrace {
  /** Schema version number for the playground trace payload. */
  schemaVersion: 1;
  /** 1-based conversation turn number. */
  turn: number;
  /** Original user query or slash command for the turn. */
  query: string;
  /** Whether this turn rendered all compare-mode candidates side by side. */
  compare: boolean;
  /** Active rendering mode for the turn (`decision`, `tool`, `express`, or `direct`). */
  activeMode: 'decision' | 'tool' | 'express' | 'direct';
  /** Stage 1 block extraction trace shared across all candidates in the turn. */
  stage1: BlockInputStage;
  /** Per-mode candidate synthesis traces (1 entry normally, 3 on `/compare`). */
  candidates: CandidateTrace[];
}

/**
 * Result returned by `A2UIClient.sendTurn(...)`.
 */
export interface A2UIClientTurnResult {
  /** A2UI wire messages extracted from the A2A response data parts. */
  messages: unknown[];
  /** Optional in-band Format Playground pipeline trace when requested. */
  trace: PlaygroundTurnTrace | null;
  /** Conversation `contextId` returned by the A2A task. */
  contextId: string | null;
}
