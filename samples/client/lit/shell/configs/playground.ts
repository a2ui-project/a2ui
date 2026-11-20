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

import {playgroundThemeSheet} from '../theme/playground-theme.js';
import {AppConfig} from './types.js';

/**
 * Shell configuration for the A2UI Format Playground (`?app=playground`).
 */
export const playgroundConfig: AppConfig = {
  key: 'playground',
  title: 'A2UI Decision Playground',
  placeholder: 'Describe a UI, paste JSON, or type /help',
  loadingText: ['Evaluating decision batch...', 'Binding or compiling...', 'Rendering...'],
  serverUrl: 'http://localhost:10010',
  cssOverrides: playgroundThemeSheet,
  // The playground reuses its main surface id across turns.
  clearSurfacesOnResponse: false,
  inspector: true,
  modeControls: {
    modes: ['cascade', 'binder', 'rpc', 'express', 'direct'],
    backends: ['mock', 'gemini', 'jev', 'step0'],
    modeExplainers: {
      cascade: {
        title: 'Cascade Mode (DecisionCascadeRouter)',
        body: 'Runs one batched decision call (up to 21 questions) to route each request to the cheapest tier that fits: plain text for factual questions (try "What is the capital of France?"), a 0-LLM pre-authored template for known shapes (try clicking Host Health or Ski Resorts), or an LLM call over a pruned component subset for novel UIs (try "Build a monthly budget calculator"). Use /budget 300 to test latency-budget downgrading.',
      },
      binder: {
        title: 'Binder Mode (ToolPointerBinder)',
        body: 'Renders structured tool outputs with 0 UI LLM calls. Click any example button or paste raw JSON to run a single select:target decision over the inspected JSON pointers and bind directly into a template. Sensitive fields like apiKey on Host Health are automatically redacted from Stage 4 wire messages, and unrecognized shapes abstain instead of forcing a bad layout.',
      },
      rpc: {
        title: 'RPC Mode (Submit-Time Decision Predicates)',
        body: 'Serves an interactive v1.0 form (pick Bug Report, Product Feedback, or Refund Request below) whose TextField @checks rule invokes a server-side decision predicate via callAgentFunction. Edit the text box to watch the predicate evaluate live against the active decision backend and return agentFunctionResponse without clearing the form.',
      },
      express: {
        title: 'Express Mode (LLM Baseline)',
        body: 'Baseline mode that sends the full Basic Catalog prompt in A2UI Express DSL directly to Gemini with no decision model in the loop. Click any example button or type a prompt to compare token count, latency, and rendered layout against cascade and binder (or run /compare to execute cascade, express, and direct side by side).',
      },
      direct: {
        title: 'Direct JSON Mode (LLM Baseline)',
        body: 'Baseline mode that asks Gemini to emit raw A2UI v1.0 JSON wire messages directly with no decision model or Express compiler. Useful as the upper-bound baseline for prompt tokens and latency when comparing against express, cascade, and binder.',
      },
    },
  },
  quickActions: [
    {
      label: 'Host Health',
      message: '/tool host',
      title: 'Render server health metrics (redacts apiKey in binder/cascade)',
      modes: ['cascade', 'binder', 'express', 'direct'],
    },
    {
      label: 'Ski Resorts',
      message: '/tool resort',
      title: 'Render mountain resort snow report',
      modes: ['cascade', 'binder', 'express', 'direct'],
    },
    {
      label: 'Transfer Quote',
      message: '/tool transfer',
      title: 'Render wire transfer confirmation summary',
      modes: ['cascade', 'binder', 'express', 'direct'],
    },
    {
      label: 'Playback Settings',
      message: '/tool settings',
      title: 'Render editable playback settings panel',
      modes: ['cascade', 'binder', 'express', 'direct'],
    },
    {
      label: 'Order Details',
      message: '/tool order',
      title: 'Render order status and delivery estimate',
      modes: ['cascade', 'binder', 'express', 'direct'],
    },
    {
      label: 'Bug Report',
      message: '/form bug',
      title: 'Validate bug reproduction steps via is_specific_bug_report',
      modes: ['rpc'],
    },
    {
      label: 'Product Feedback',
      message: '/form feedback',
      title: 'Validate constructive feedback via is_polite_feedback',
      modes: ['rpc'],
    },
    {
      label: 'Refund Request',
      message: '/form refund',
      title: 'Validate refund eligibility via is_valid_refund_reason',
      modes: ['rpc'],
    },
  ],
};
