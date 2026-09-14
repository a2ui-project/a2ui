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
exports.componentGeneratorFlow = void 0;
const genkit_1 = require("genkit");
const ai_1 = require("./ai");
const rateLimiter_1 = require("./rateLimiter");
const logger_1 = require("./logger");
// Define a UI component generator flow
exports.componentGeneratorFlow = ai_1.ai.defineFlow({
    name: 'componentGeneratorFlow',
    inputSchema: genkit_1.z.object({
        prompt: genkit_1.z.string(),
        modelConfig: genkit_1.z.custom(),
        schemas: genkit_1.z.custom(),
        catalogRules: genkit_1.z.string().optional(),
    }),
    outputSchema: genkit_1.z.any(),
}, async ({ prompt, modelConfig, schemas, catalogRules }) => {
    const schemaDefs = Object.values(schemas)
        .map((s) => JSON.stringify(s, null, 2))
        .join('\n\n');
    const fullPrompt = `You are an AI assistant. Based on the following request, generate a stream of JSON messages that conform to the provided JSON Schemas.
The output MUST be a series of JSON objects, each enclosed in a markdown code block (or a single block with multiple objects).

Standard Instructions:
1. Generate a 'createSurface' message with surfaceId 'main' and catalogId 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'.
2. Generate a 'updateComponents' message with surfaceId 'main' containing the requested UI.
3. Ensure all component children are referenced by ID (using the 'children' or 'child' property with IDs), NOT nested inline as objects.
4. If the request involves data binding, you may also generate 'updateDataModel' messages.
5. Among the 'updateComponents' messages in the output, there MUST be one root component with id: 'root'.
6. Components need to be nested within a root layout container (Column, Row). No need to add an extra container if the root is already a layout container.
7. There shouldn't be any orphaned components: no components should be generated which don't have a parent, except for the root component.
8. Do NOT output a list of lists (e.g. [[...]]). Output individual JSON objects separated by newlines.
9. STRICTLY follow the JSON Schemas. Do NOT add any properties that are not defined in the schema. Ensure ALL required properties are present.
10. Do NOT invent data bindings or action contexts. Only use them if the prompt explicitly asks for them.
11. Read the 'description' field of each component in the schema carefully. It contains critical usage instructions.
12. Do NOT define components inline inside 'child' or 'children'. Always use a string ID referencing a separate component definition.
13. Do NOT use a 'style' property. Use standard properties like 'align', 'justify', 'variant', etc.
14. Do NOT invent properties that are not in the schema. Check the 'properties' list for each component type.
15. Use 'checks' property for validation rules if required.
16. EVERY message object MUST include the property "version": "v1.0" at the top level.
${catalogRules ? `\nInstructions specific to this catalog:\n${catalogRules}` : ''}

Schemas:
${schemaDefs}

Request:
${prompt}
`;
    const estimatedInputTokens = Math.ceil(fullPrompt.length / 2.5);
    await rateLimiter_1.rateLimiter.acquirePermit(modelConfig, estimatedInputTokens);
    // Generate text response
    let response;
    const startTime = Date.now();
    try {
        response = await ai_1.ai.generate({
            prompt: fullPrompt,
            model: modelConfig.model,
            config: modelConfig.config,
        });
    }
    catch (e) {
        logger_1.logger.error(`Error during ai.generate: ${e}`);
        rateLimiter_1.rateLimiter.reportError(modelConfig, e);
        throw e;
    }
    const latency = Date.now() - startTime;
    if (!response)
        throw new Error('Failed to generate component');
    let candidate = response.candidates?.[0];
    // Fallback for different response structure (e.g. Genkit 0.9+ or specific model adapters)
    if (!candidate && response.message) {
        const message = response.message;
        candidate = {
            index: 0,
            content: message.content,
            finishReason: 'STOP', // Assume STOP if not provided in this format
            message: message,
        };
    }
    if (!candidate) {
        logger_1.logger.error(`No candidates returned in response. Full response: ${JSON.stringify(response, null, 2)}`);
        throw new Error('No candidates returned');
    }
    if (candidate.finishReason !== 'STOP' && candidate.finishReason !== undefined) {
        logger_1.logger.warn(`Model finished with reason: ${candidate.finishReason}. Content: ${JSON.stringify(candidate.content)}`);
    }
    // Reconcile estimated vs actual token usage and log the difference for precise rate limiting.
    const inputTokens = response.usage?.inputTokens || 0;
    const outputTokens = response.usage?.outputTokens || 0;
    const additionalInputTokens = Math.max(0, inputTokens - estimatedInputTokens);
    const tokensToAdd = additionalInputTokens + outputTokens;
    if (tokensToAdd > 0) {
        rateLimiter_1.rateLimiter.recordUsage(modelConfig, tokensToAdd, false);
    }
    return { text: response.text, latency };
});
