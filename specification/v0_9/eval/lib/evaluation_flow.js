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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluationFlow = void 0;
const genkit_1 = require("genkit");
const ai_1 = require("./ai");
const rateLimiter_1 = require("./rateLimiter");
const logger_1 = require("./logger");
// Define an evaluation flow
exports.evaluationFlow = ai_1.ai.defineFlow({
    name: 'evaluationFlow',
    inputSchema: genkit_1.z.object({
        originalPrompt: genkit_1.z.string(),
        generatedOutput: genkit_1.z.string(),
        evalModel: genkit_1.z.string(),
        schemas: genkit_1.z.any(),
    }),
    outputSchema: genkit_1.z.object({
        pass: genkit_1.z.boolean(),
        reason: genkit_1.z.string(),
        issues: genkit_1.z
            .array(genkit_1.z.object({
            issue: genkit_1.z.string(),
            severity: genkit_1.z.enum(['minor', 'significant', 'critical']),
        }))
            .optional(),
        evalPrompt: genkit_1.z.string().optional(),
    }),
}, async ({ originalPrompt, generatedOutput, evalModel, schemas }) => {
    const schemaDefs = Object.values(schemas)
        .map((s) => JSON.stringify(s, null, 2))
        .join('\n\n');
    const EvalResultSchema = genkit_1.z.object({
        pass: genkit_1.z.boolean().describe('Whether the generated UI meets the requirements'),
        reason: genkit_1.z.string().describe('Summary of the reason for a failure.'),
        issues: genkit_1.z
            .array(genkit_1.z.object({
            issue: genkit_1.z.string().describe('Description of the issue'),
            severity: genkit_1.z
                .enum(['minor', 'significant', 'critical'])
                .describe('Severity of the issue'),
        }))
            .describe('List of specific issues found.'),
    });
    const evalPrompt = `You are an expert QA evaluator for a UI generation system.
Your task is to evaluate whether the generated UI JSON matches the user's request and conforms to the expected behavior.

User Request:
${originalPrompt}

Expected Schemas:
${schemaDefs}

Generated Output (JSONL in Markdown):
${generatedOutput}

Instructions:
1. Analyze the Generated Output against the User Request.
2. Check if all requested components are present and match the user's intent.
3. Check if the hierarchy and properties match the description.
4. Verify that the content (text, labels, etc.) is correct and makes sense.
5. Ignore minor formatting differences.
6. If the output is correct and satisfies the request, return "pass": true.
7. If there are missing components, incorrect values, or structural issues that affect the user experience, return "pass": false and provide a detailed "reason".
8. In the "reason", explicitly quote the part of the JSON that is incorrect if possible.
9. The UI protocol strictly requires a flat list of components where children are referenced by their string ID. It explicitly FORBIDS inlining child components.
10. If the generated output uses string IDs for 'child' or 'children' properties, this is CORRECT. Do NOT report this as an issue.

- You can be lenient in your evaluation for URLs, as the generated output may use a placeholder URL for images and icons.
- If label text is similar but not exact, you can still pass the test as long as the meaning is the same. (e.g. "Cancel" vs "Cancel Order")
- If the generated output is missing a component that is specified in the user request, it is required to exist in the output in order to pass the test. If it is not specified, it is not required.
- If the request is vague about the contents of a label or other property, you can still pass the test as long as it can be construed as matching the intent.
- Unless explicitly required to be absent by the user request, extra components or attributes are allowed.

Severity Definitions:
- Minor: Merely cosmetic or a slight deviation from the request.
- Significant: The UI isn't very ergonomic or would be hard to understand.
- Critical: That part of the UI is left off, or the structure isn't valid and can't be rendered.

Return a JSON object with the following schema:

\`\`\`json
{
  "type": "object",
  "properties": {
    "pass": {
      "type": "boolean",
      "description": "Whether the generated UI meets the requirements"
    },
    "reason": {
      "type": "string",
      "description": "Summary of the reason for a failure."
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "issue": {
            "type": "string",
            "description": "Description of the issue"
          },
          "severity": {
            "type": "string",
            "enum": ["minor", "significant", "critical"],
            "description": "Severity of the issue"
          }
        },
        "required": ["issue", "severity"]
      },
      "description": "List of specific issues found."
    }
  },
  "required": ["pass", "reason", "issues"]
}
\`\`\`
`;
    const estimatedInputTokens = Math.ceil(evalPrompt.length / 2.5);
    // Lookup eval model config to enforce rate limits, or generate a safe default fallback.
    const { modelsToTest } = await Promise.resolve().then(() => __importStar(require('./models')));
    let evalModelConfig = modelsToTest.find(m => m.name === evalModel);
    if (!evalModelConfig) {
        evalModelConfig = {
            name: evalModel,
            model: null,
            requestsPerMinute: 60,
            tokensPerMinute: 100000,
        };
    }
    await rateLimiter_1.rateLimiter.acquirePermit(evalModelConfig, estimatedInputTokens);
    try {
        const response = await ai_1.ai.generate({
            prompt: evalPrompt,
            model: evalModelConfig.model || evalModel, // Use the model object if available, otherwise the string
            config: evalModelConfig.config,
            output: {
                schema: EvalResultSchema,
            },
        });
        // Parse the output
        const result = response.output;
        if (!result) {
            throw new Error('No output from evaluation model');
        }
        return {
            pass: result.pass,
            reason: result.reason || 'No reason provided',
            issues: result.issues || [],
            evalPrompt: evalPrompt,
        };
    }
    catch (e) {
        logger_1.logger.error(`Error during evaluation: ${e}`);
        if (evalModelConfig) {
            rateLimiter_1.rateLimiter.reportError(evalModelConfig, e);
        }
        throw e; // Re-throw to let the retry logic handle it
    }
});
