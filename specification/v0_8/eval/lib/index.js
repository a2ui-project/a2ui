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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const flows_1 = require("./flows");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const models_1 = require("./models");
const prompts_1 = require("./prompts");
const validator_1 = require("./validator");
function generateSummary(resultsByModel, results) {
    const promptNameWidth = 40;
    const latencyWidth = 20;
    const failedRunsWidth = 15;
    const toolErrorRunsWidth = 20;
    let summary = '# Evaluation Summary';
    for (const modelName in resultsByModel) {
        summary += `\n\n## Model: ${modelName}\n\n`;
        const header = `| ${'Prompt Name'.padEnd(promptNameWidth)} | ${'Avg Latency (ms)'.padEnd(latencyWidth)} | ${'Failed Runs'.padEnd(failedRunsWidth)} | ${'Tool Error Runs'.padEnd(toolErrorRunsWidth)} |`;
        const divider = `|${'-'.repeat(promptNameWidth + 2)}|${'-'.repeat(latencyWidth + 2)}|${'-'.repeat(failedRunsWidth + 2)}|${'-'.repeat(toolErrorRunsWidth + 2)}|`;
        summary += header;
        summary += `\n${divider}`;
        const promptsInModel = resultsByModel[modelName].reduce((acc, result) => {
            if (!acc[result.prompt.name]) {
                acc[result.prompt.name] = [];
            }
            acc[result.prompt.name].push(result);
            return acc;
        }, {});
        let totalModelFailedRuns = 0;
        for (const promptName in promptsInModel) {
            const runs = promptsInModel[promptName];
            const totalRuns = runs.length;
            const errorRuns = runs.filter(r => r.error).length;
            const failedRuns = runs.filter(r => r.error || r.validationResults.length > 0).length;
            const totalLatency = runs.reduce((acc, r) => acc + r.latency, 0);
            const avgLatency = (totalLatency / totalRuns).toFixed(0);
            totalModelFailedRuns += failedRuns;
            const failedRunsStr = failedRuns > 0 ? `${failedRuns} / ${totalRuns}` : '';
            const errorRunsStr = errorRuns > 0 ? `${errorRuns} / ${totalRuns}` : '';
            summary += `\n| ${promptName.padEnd(promptNameWidth)} | ${avgLatency.padEnd(latencyWidth)} | ${failedRunsStr.padEnd(failedRunsWidth)} | ${errorRunsStr.padEnd(toolErrorRunsWidth)} |`;
        }
        const totalRunsForModel = resultsByModel[modelName].length;
        summary += `\n\n**Total failed runs:** ${totalModelFailedRuns} / ${totalRunsForModel}`;
    }
    summary += '\n\n---\n\n## Overall Summary\n';
    const totalRuns = results.length;
    const totalToolErrorRuns = results.filter(r => r.error).length;
    const totalRunsWithAnyFailure = results.filter(r => r.error || r.validationResults.length > 0).length;
    const modelsWithFailures = [
        ...new Set(results.filter(r => r.error || r.validationResults.length > 0).map(r => r.modelName)),
    ].join(', ');
    summary += `\n- **Number of tool error runs:** ${totalToolErrorRuns} / ${totalRuns}`;
    summary += `\n- **Number of runs with any failure (tool error or validation):** ${totalRunsWithAnyFailure} / ${totalRuns}`;
    const latencies = results.map(r => r.latency).sort((a, b) => a - b);
    const totalLatency = latencies.reduce((acc, l) => acc + l, 0);
    const meanLatency = (totalLatency / totalRuns).toFixed(0);
    let medianLatency = 0;
    if (latencies.length > 0) {
        const mid = Math.floor(latencies.length / 2);
        if (latencies.length % 2 === 0) {
            medianLatency = (latencies[mid - 1] + latencies[mid]) / 2;
        }
        else {
            medianLatency = latencies[mid];
        }
    }
    summary += `\n- **Mean Latency:** ${meanLatency} ms`;
    summary += `\n- **Median Latency:** ${medianLatency} ms`;
    if (modelsWithFailures) {
        summary += `\n- **Models with at least one failure:** ${modelsWithFailures}`;
    }
    return summary;
}
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
// Run the flow
async function main() {
    const argv = await (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
        .option('verbose', {
        alias: 'v',
        type: 'boolean',
        description: 'Run with verbose logging',
        default: false,
    })
        .option('keep', {
        type: 'string',
        description: 'Directory to keep output files. If no path is provided, a temporary directory will be created.',
        coerce: arg => (arg === undefined ? true : arg),
    })
        .option('runs-per-prompt', {
        type: 'number',
        description: 'Number of times to run each prompt',
        default: 1,
    })
        .option('model', {
        type: 'string',
        array: true,
        description: 'Filter models by exact name',
        default: [],
        choices: models_1.modelsToTest.map(m => m.name),
    })
        .option('prompt', {
        type: 'string',
        description: 'Filter prompts by name prefix',
    })
        .help()
        .alias('h', 'help').argv;
    const verbose = argv.verbose;
    const keep = argv.keep;
    let outputDir = null;
    if (keep) {
        if (typeof keep === 'string') {
            outputDir = keep;
        }
        else {
            outputDir = fs.mkdtempSync(path.join(process.cwd(), 'a2ui-eval-'));
        }
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        console.log(`Keeping output in: ${outputDir}`);
    }
    const runsPerPrompt = argv['runs-per-prompt'];
    let filteredModels = models_1.modelsToTest;
    if (argv.model && argv.model.length > 0) {
        const modelNames = argv.model;
        filteredModels = models_1.modelsToTest.filter(m => modelNames.includes(m.name));
        if (filteredModels.length === 0) {
            console.error(`No models found matching: ${modelNames.join(', ')}.`);
            process.exit(1);
        }
    }
    let filteredPrompts = prompts_1.prompts;
    if (argv.prompt) {
        filteredPrompts = prompts_1.prompts.filter(p => p.name.startsWith(argv.prompt));
        if (filteredPrompts.length === 0) {
            console.error(`No prompt found with prefix "${argv.prompt}".`);
            process.exit(1);
        }
    }
    const generationPromises = [];
    for (const prompt of filteredPrompts) {
        const schemaString = fs.readFileSync(path.join(__dirname, prompt.schemaPath), 'utf-8');
        const schema = JSON.parse(schemaString);
        for (const modelConfig of filteredModels) {
            const modelDirName = modelConfig.name.replace(/[/:]/g, '_');
            const modelOutputDir = outputDir ? path.join(outputDir, modelDirName) : null;
            if (modelOutputDir && !fs.existsSync(modelOutputDir)) {
                fs.mkdirSync(modelOutputDir, { recursive: true });
            }
            for (let i = 1; i <= runsPerPrompt; i++) {
                console.log(`Queueing generation for model: ${modelConfig.name}, prompt: ${prompt.name} (run ${i})`);
                const startTime = Date.now();
                generationPromises.push((0, flows_1.componentGeneratorFlow)({
                    prompt: prompt.promptText,
                    model: modelConfig.model,
                    config: modelConfig.config,
                    schema,
                })
                    .then(component => {
                    if (modelOutputDir) {
                        const inputPath = path.join(modelOutputDir, `${prompt.name}.input.txt`);
                        fs.writeFileSync(inputPath, prompt.promptText);
                        const outputPath = path.join(modelOutputDir, `${prompt.name}.output.json`);
                        fs.writeFileSync(outputPath, JSON.stringify(component, null, 2));
                    }
                    const validationResults = (0, validator_1.validateSchema)(component, prompt.schemaPath, prompt.matchers);
                    return {
                        modelName: modelConfig.name,
                        prompt,
                        component,
                        error: null,
                        latency: Date.now() - startTime,
                        validationResults,
                        runNumber: i,
                    };
                })
                    .catch(error => {
                    if (modelOutputDir) {
                        const inputPath = path.join(modelOutputDir, `${prompt.name}.input.txt`);
                        fs.writeFileSync(inputPath, prompt.promptText);
                        const errorPath = path.join(modelOutputDir, `${prompt.name}.error.json`);
                        const errorOutput = {
                            message: error.message,
                            stack: error.stack,
                            ...error,
                        };
                        fs.writeFileSync(errorPath, JSON.stringify(errorOutput, null, 2));
                    }
                    return {
                        modelName: modelConfig.name,
                        prompt,
                        component: null,
                        error,
                        latency: Date.now() - startTime,
                        validationResults: [],
                        runNumber: i,
                    };
                }));
            }
        }
    }
    const results = await Promise.all(generationPromises);
    const resultsByModel = {};
    for (const result of results) {
        if (!resultsByModel[result.modelName]) {
            resultsByModel[result.modelName] = [];
        }
        resultsByModel[result.modelName].push(result);
    }
    console.log('\n--- Generation Results ---');
    for (const modelName in resultsByModel) {
        for (const result of resultsByModel[modelName]) {
            const hasError = !!result.error;
            const hasValidationFailures = result.validationResults.length > 0;
            const hasComponent = !!result.component;
            if (hasError || hasValidationFailures || (verbose && hasComponent)) {
                console.log('\n----------------------------------------');
                console.log(`Model: ${modelName}`);
                console.log('----------------------------------------');
                console.log(`\nQuery: ${result.prompt.name} (run ${result.runNumber})`);
                if (hasError) {
                    console.error('Error generating component:', result.error);
                }
                else if (hasComponent) {
                    if (hasValidationFailures) {
                        console.log('Validation Failures:');
                        result.validationResults.forEach(failure => console.log(`- ${failure}`));
                    }
                    if (verbose) {
                        if (hasValidationFailures) {
                            console.log('Generated schema:');
                            console.log(JSON.stringify(result.component, null, 2));
                        }
                    }
                }
            }
        }
    }
    const summary = generateSummary(resultsByModel, results);
    console.log(summary);
    if (outputDir) {
        const summaryPath = path.join(outputDir, 'summary.md');
        fs.writeFileSync(summaryPath, summary);
    }
}
if (require.main === module) {
    main().catch(console.error);
}
