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
exports.Evaluator = void 0;
const evaluation_flow_1 = require("./evaluation_flow");
const logger_1 = require("./logger");
const rateLimiter_1 = require("./rateLimiter");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
class Evaluator {
    constructor(schemas, evalModel, outputDir) {
        this.schemas = schemas;
        this.evalModel = evalModel;
        this.outputDir = outputDir;
    }
    async run(results) {
        const passedResults = results.filter(r => r.validationErrors.length === 0 && r.components);
        const skippedCount = results.length - passedResults.length;
        logger_1.logger.info(`Starting Phase 3: LLM Evaluation (${passedResults.length} items to evaluate, ${skippedCount} skipped due to validation failure)`);
        const totalJobs = passedResults.length;
        let completedCount = 0;
        let failedCount = 0;
        const evaluatedResults = [];
        // Initialize results with skipped items
        for (const result of results) {
            if (result.validationErrors.length > 0) {
                evaluatedResults.push({
                    ...result,
                    evaluationResult: {
                        pass: false,
                        reason: 'Schema validation failure',
                        issues: [
                            {
                                issue: result.validationErrors.join('\n'),
                                severity: 'criticalSchema',
                            },
                        ],
                        overallSeverity: 'criticalSchema',
                    },
                });
            }
            else if (!result.components) {
                evaluatedResults.push({ ...result });
            }
        }
        if (totalJobs === 0) {
            logger_1.logger.info('Phase 3: Evaluation Complete (No items to evaluate)');
            return evaluatedResults;
        }
        const progressInterval = setInterval(() => {
            const queuedCount = rateLimiter_1.rateLimiter.waitingCount;
            const inProgressCount = totalJobs - completedCount - failedCount - queuedCount;
            const pct = Math.round(((completedCount + failedCount) / totalJobs) * 100);
            process.stderr.write(`\r[Phase 3] Progress: ${pct}% | Completed: ${completedCount} | In Progress: ${inProgressCount} | Queued: ${queuedCount} | Failed: ${failedCount}          `);
        }, 1000);
        const promises = passedResults.map(result => this.runJob(result).then(evalResult => {
            if (evalResult.evaluationResult) {
                completedCount++;
            }
            else {
                failedCount++; // Failed to run evaluation flow (e.g. error)
            }
            evaluatedResults.push(evalResult);
            return evalResult;
        }));
        await Promise.all(promises);
        clearInterval(progressInterval);
        process.stderr.write('\n');
        logger_1.logger.info('Phase 3: Evaluation Complete');
        return evaluatedResults;
    }
    async runJob(result) {
        const maxEvalRetries = 3;
        let evaluationResult;
        for (let evalRetry = 0; evalRetry < maxEvalRetries; evalRetry++) {
            try {
                evaluationResult = await (0, evaluation_flow_1.evaluationFlow)({
                    originalPrompt: result.prompt.promptText,
                    generatedOutput: result.rawText || '',
                    evalModel: this.evalModel,
                    schemas: this.schemas,
                });
                break;
            }
            catch (e) {
                if (evalRetry === maxEvalRetries - 1) {
                    logger_1.logger.warn(`Evaluation failed for ${result.prompt.name} run ${result.runNumber}: ${e.message}`);
                    evaluationResult = {
                        pass: false,
                        reason: `Evaluation flow failed: ${e.message}`,
                    };
                }
                else {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, evalRetry)));
                }
            }
        }
        let overallSeverity;
        if (evaluationResult && !evaluationResult.pass && evaluationResult.issues) {
            const severities = evaluationResult.issues.map(i => i.severity);
            if (severities.includes('critical')) {
                overallSeverity = 'critical';
            }
            else if (severities.includes('significant')) {
                overallSeverity = 'significant';
            }
            else if (severities.includes('minor')) {
                overallSeverity = 'minor';
            }
        }
        if (this.outputDir && evaluationResult) {
            this.saveEvaluation(result, evaluationResult, overallSeverity);
        }
        return {
            ...result,
            evaluationResult: evaluationResult ? { ...evaluationResult, overallSeverity } : undefined,
        };
    }
    saveEvaluation(result, evaluationResult, overallSeverity) {
        if (!this.outputDir)
            return;
        // Only save if the evaluation failed
        if (evaluationResult.pass)
            return;
        const modelDir = path.join(this.outputDir, `output-${result.modelName.replace(/[/:]/g, '_')}`);
        const detailsDir = path.join(modelDir, 'details');
        fs.writeFileSync(path.join(detailsDir, `${result.prompt.name}.${result.runNumber}.failed.yaml`), yaml.dump({ ...evaluationResult, overallSeverity }));
        if (evaluationResult.evalPrompt) {
            fs.writeFileSync(path.join(detailsDir, `${result.prompt.name}.${result.runNumber}.eval_prompt.txt`), evaluationResult.evalPrompt);
        }
    }
}
exports.Evaluator = Evaluator;
