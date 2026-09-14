"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelsToTest = void 0;
const google_genai_1 = require("@genkit-ai/google-genai");
const openai_1 = require("@genkit-ai/compat-oai/openai");
const genkitx_anthropic_1 = require("genkitx-anthropic");
exports.modelsToTest = [
    {
        model: openai_1.openAI.model('gpt-5.1'),
        name: 'gpt-5.1',
        config: { reasoning_effort: 'minimal' },
        requestsPerMinute: 500,
        tokensPerMinute: 30000,
    },
    {
        model: openai_1.openAI.model('gpt-5-mini'),
        name: 'gpt-5-mini',
        config: { reasoning_effort: 'minimal' },
        requestsPerMinute: 500,
        tokensPerMinute: 500000,
    },
    {
        model: openai_1.openAI.model('gpt-5-nano'),
        name: 'gpt-5-nano',
        config: {},
        requestsPerMinute: 500,
        tokensPerMinute: 200000,
    },
    {
        model: google_genai_1.googleAI.model('gemini-2.5-pro'),
        name: 'gemini-2.5-pro',
        config: { thinkingConfig: { thinkingBudget: 1000 } },
        requestsPerMinute: 150,
        tokensPerMinute: 2000000,
    },
    {
        model: google_genai_1.googleAI.model('gemini-3-flash-preview'),
        name: 'gemini-3-flash',
        config: { thinkingConfig: { thinkingBudget: 0 } },
        requestsPerMinute: 1000,
        tokensPerMinute: 1000000,
    },
    {
        model: google_genai_1.googleAI.model('gemini-3.1-pro-preview'),
        name: 'gemini-3.1-pro',
        config: { thinkingConfig: { thinkingBudget: 1000 } },
        requestsPerMinute: 25,
        tokensPerMinute: 1000000,
    },
    {
        model: google_genai_1.googleAI.model('gemini-2.5-flash'),
        name: 'gemini-2.5-flash',
        config: { thinkingConfig: { thinkingBudget: 0 } },
        requestsPerMinute: 1000,
        tokensPerMinute: 1000000,
    },
    {
        model: google_genai_1.googleAI.model('gemini-2.5-flash-lite'),
        name: 'gemini-2.5-flash-lite',
        config: { thinkingConfig: { thinkingBudget: 0 } },
        requestsPerMinute: 4000,
        tokensPerMinute: 4000000,
    },
    {
        model: genkitx_anthropic_1.claude4Sonnet,
        name: 'claude-4-sonnet',
        config: {},
        requestsPerMinute: 50,
        tokensPerMinute: 30000,
    },
    {
        model: genkitx_anthropic_1.claude35Haiku,
        name: 'claude-35-haiku',
        config: {},
        requestsPerMinute: 50,
        tokensPerMinute: 50000,
    },
];
