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
exports.ai = void 0;
const google_genai_1 = require("@genkit-ai/google-genai");
const genkit_1 = require("genkit");
const openai_1 = require("@genkit-ai/compat-oai/openai");
const genkitx_anthropic_1 = require("genkitx-anthropic");
const logger_1 = require("./logger");
const plugins = [];
if (process.env.GEMINI_API_KEY) {
    logger_1.logger.info('Initializing Google AI plugin...');
    plugins.push((0, google_genai_1.googleAI)({
        apiKey: process.env.GEMINI_API_KEY,
        experimental_debugTraces: true,
    }));
}
if (process.env.OPENAI_API_KEY) {
    logger_1.logger.info('Initializing OpenAI plugin...');
    plugins.push((0, openai_1.openAI)());
}
if (process.env.ANTHROPIC_API_KEY) {
    logger_1.logger.info('Initializing Anthropic plugin...');
    plugins.push((0, genkitx_anthropic_1.anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY }));
}
exports.ai = (0, genkit_1.genkit)({
    plugins,
});
