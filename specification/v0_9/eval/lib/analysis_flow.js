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
exports.analysisFlow = void 0;
const genkit_1 = require("genkit");
const ai_1 = require("./ai");
const rateLimiter_1 = require("./rateLimiter");
const logger_1 = require("./logger");
exports.analysisFlow = ai_1.ai.defineFlow({
    name: 'analysisFlow',
    inputSchema: genkit_1.z.object({
        modelName: genkit_1.z.string(),
        failures: genkit_1.z.array(genkit_1.z.object({
            promptName: genkit_1.z.string(),
            runNumber: genkit_1.z.number(),
            failureType: genkit_1.z.string(),
            reason: genkit_1.z.string(),
            issues: genkit_1.z.array(genkit_1.z.string()).optional(),
        })),
        numRuns: genkit_1.z.number(),
        evalModel: genkit_1.z.string(),
    }),
    outputSchema: genkit_1.z.string(),
}, async ({ modelName, failures, numRuns, evalModel }) => {
    const failureDetails = failures
        .map(f => {
        let details = `Prompt: ${f.promptName} (Run ${f.runNumber})\nType: ${f.failureType}\nReason: ${f.reason}`;
        if (f.issues && f.issues.length > 0) {
            details += `\nIssues:\n- ${f.issues.join('\n- ')}`;
        }
        return details;
    })
        .join('\n\n---\n\n');
    const analysisPrompt = `You are an expert AI analyst.
Your task is to analyze the following failures from an evaluation run of the model "${modelName}".

Out of the ${failures.length} failures, ${failures.filter(f => f.failureType === 'Schema Validation').length} are schema validation failures, ${failures.filter(f => f.failureType === 'Missing Components').length} are missing components failures, and ${failures.filter(f => f.failureType === 'Incorrect Logic').length} are incorrect logic failures.

There were ${numRuns - failures.length} successful runs. Take this into account in the final summary of the analysis.

Failures:
${failureDetails}

Instructions:
1. Identify and list the broad types of errors (e.g., Schema Validation, Missing Components, Incorrect Logic, etc.).
2. Analyze succinctly any patterns you see in the failures (e.g., "The model consistently fails to include the 'id' property", "The model struggles with nested layouts") and list them in a bullet point list. Try to give short examples of the patterns taken from the actual failures.
3. Provide a concise summary of your findings in a single paragraph.

The output is meant to be a short summary, not a full report. It should be easy to read and understand at a glance.

Output Format:
Return a Markdown formatted summary. Use headers and bullet points.
`;
    // Calculate estimated tokens for rate limiting
    const estimatedInputTokens = Math.ceil(analysisPrompt.length / 2.5);
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
            prompt: analysisPrompt,
            model: evalModelConfig.model || evalModel,
            config: evalModelConfig.config,
            output: {
                format: 'text',
            },
        });
        const output = response.output;
        if (!output) {
            throw new Error('No output from analysis model');
        }
        if (typeof output !== 'string') {
            return 'Analysis failed: Output was not a string.';
        }
        return output;
    }
    catch (e) {
        logger_1.logger.error(`Error during analysis: ${e}`);
        if (evalModelConfig) {
            rateLimiter_1.rateLimiter.reportError(evalModelConfig, e);
        }
        return `Analysis failed: ${e.message}`;
    }
});
