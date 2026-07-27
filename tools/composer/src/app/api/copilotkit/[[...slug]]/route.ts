/* eslint-disable turbo/no-undeclared-env-vars */ // TODO: declare turbo env vars
/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  BuiltInAgent,
} from '@copilotkit/runtime/v2';
export const dynamic = 'force-dynamic';
import {handle} from 'hono/vercel';
import {A2UI_V08_PROMPT} from '../a2ui-prompt-v08';
import {A2UI_V09_PROMPT} from '../a2ui-prompt-v09';

const determineModel = () => {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim()) {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
    }
    return 'google/gemini-2.5-flash';
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      '[CopilotKit] GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY not found, falling back to OpenAI',
    );
    return 'openai/gpt-4.1-mini';
  }
  console.warn(
    '[CopilotKit] No GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY found',
  );
  return 'google/gemini-2.5-flash';
};

const model = determineModel();

const agentV08 = new BuiltInAgent({
  model,
  prompt: A2UI_V08_PROMPT,
  temperature: 0.7,
});

const agentV09 = new BuiltInAgent({
  model,
  prompt: A2UI_V09_PROMPT,
  temperature: 0.7,
});

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: agentV08,
    v08: agentV08,
    v09: agentV09,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime: copilotRuntime,
  basePath: '/api/copilotkit',
});

export const GET = handle(app);
export const POST = handle(app);
