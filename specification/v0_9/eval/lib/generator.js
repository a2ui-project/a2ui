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
exports.Generator = void 0;
const generation_flow_1 = require("./generation_flow");
const utils_1 = require("./utils");
const rateLimiter_1 = require("./rateLimiter");
const logger_1 = require("./logger");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class Generator {
    constructor(schemas, outputDir, catalogRules) {
        this.schemas = schemas;
        this.outputDir = outputDir;
        this.catalogRules = catalogRules;
    }
    async run(prompts, models, runsPerPrompt) {
        const totalJobs = prompts.length * models.length * runsPerPrompt;
        let completedCount = 0;
        let failedCount = 0;
        const results = [];
        const promises = [];
        logger_1.logger.info(`Starting Phase 1: Generation (${totalJobs} jobs)`);
        const progressInterval = setInterval(() => {
            const queuedCount = rateLimiter_1.rateLimiter.waitingCount;
            const inProgressCount = totalJobs - completedCount - failedCount - queuedCount;
            const pct = totalJobs > 0 ? Math.round(((completedCount + failedCount) / totalJobs) * 100) : 0;
            process.stderr.write(`\r[Phase 1] Progress: ${pct}% | Completed: ${completedCount} | In Progress: ${inProgressCount} | Queued: ${queuedCount} | Failed: ${failedCount}          `);
        }, 1000);
        for (const model of models) {
            for (const prompt of prompts) {
                for (let i = 1; i <= runsPerPrompt; i++) {
                    promises.push(this.runJob(model, prompt, i).then(result => {
                        if (result.error) {
                            failedCount++;
                        }
                        else {
                            completedCount++;
                        }
                        results.push(result);
                        return result;
                    }));
                }
            }
        }
        await Promise.all(promises);
        clearInterval(progressInterval);
        process.stderr.write('\n');
        logger_1.logger.info('Phase 1: Generation Complete');
        return results;
    }
    async runJob(model, prompt, runIndex, retryCount = 0) {
        const startTime = Date.now();
        try {
            const output = await (0, generation_flow_1.componentGeneratorFlow)({
                prompt: prompt.promptText,
                modelConfig: model,
                schemas: this.schemas,
                catalogRules: this.catalogRules,
            });
            const text = output?.text;
            const latency = output?.latency || 0;
            let components = [];
            let error = null;
            if (text) {
                try {
                    components = (0, utils_1.extractJsonFromMarkdown)(text);
                    if (this.outputDir) {
                        this.saveArtifacts(model, prompt, runIndex, text, components);
                    }
                }
                catch (e) {
                    error = e;
                    if (this.outputDir) {
                        this.saveError(model, prompt, runIndex, text, e);
                    }
                }
            }
            else {
                error = new Error('No output text returned from model');
            }
            return {
                modelName: model.name,
                prompt,
                runNumber: runIndex,
                rawText: text,
                components,
                latency,
                error,
            };
        }
        catch (error) {
            if (retryCount < 1) {
                // Simple retry for tool errors
                return this.runJob(model, prompt, runIndex, retryCount + 1);
            }
            return {
                modelName: model.name,
                prompt,
                runNumber: runIndex,
                latency: Date.now() - startTime,
                error,
            };
        }
    }
    saveArtifacts(model, prompt, runIndex, text, components) {
        if (!this.outputDir)
            return;
        const modelDir = path.join(this.outputDir, `output-${model.name.replace(/[/:]/g, '_')}`);
        const detailsDir = path.join(modelDir, 'details');
        fs.mkdirSync(detailsDir, { recursive: true });
        fs.writeFileSync(path.join(detailsDir, `${prompt.name}.${runIndex}.json`), JSON.stringify(components, null, 2));
        const samplePath = path.join(detailsDir, `${prompt.name}.${runIndex}.sample`);
        const yamlHeader = `---
description: ${prompt.description}
name: ${prompt.name}
prompt: |
${prompt.promptText
            .split('\n')
            .map(line => '  ' + line)
            .join('\n')}
---
`;
        let jsonlBody = '';
        for (const comp of components) {
            jsonlBody += JSON.stringify(comp) + '\n';
        }
        fs.writeFileSync(samplePath, yamlHeader + jsonlBody);
    }
    saveError(model, prompt, runIndex, text, error) {
        if (!this.outputDir)
            return;
        const modelDir = path.join(this.outputDir, `output-${model.name.replace(/[/:]/g, '_')}`);
        const detailsDir = path.join(modelDir, 'details');
        fs.mkdirSync(detailsDir, { recursive: true });
        fs.writeFileSync(path.join(detailsDir, `${prompt.name}.${runIndex}.output.txt`), text || 'No output');
        fs.writeFileSync(path.join(detailsDir, `${prompt.name}.${runIndex}.error.json`), JSON.stringify({ message: error.message, stack: error.stack }, null, 2));
    }
}
exports.Generator = Generator;
