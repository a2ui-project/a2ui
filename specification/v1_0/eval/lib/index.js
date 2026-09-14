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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const logger_1 = require("./logger");
const models_1 = require("./models");
const prompts_1 = require("./prompts");
const generator_1 = require("./generator");
const validator_1 = require("./validator");
const evaluator_1 = require("./evaluator");
const analysis_flow_1 = require("./analysis_flow");
const schemaFiles = [
    '../../json/common_types.json',
    '../../catalogs/basic/catalog.json',
    '../../json/agent_to_renderer.json',
];
function loadSchemas() {
    const schemas = {};
    for (const file of schemaFiles) {
        const schemaString = fs.readFileSync(path.join(__dirname, file), 'utf-8');
        const schema = JSON.parse(schemaString);
        const key = file.replace('../../', '');
        schemas[key] = schema;
    }
    // Alias catalogs/basic/catalog.json to catalog.json to match agent_to_renderer.json references
    // This mirrors the logic in run_tests.py
    if (schemas['catalogs/basic/catalog.json']) {
        const catalogSchema = JSON.parse(JSON.stringify(schemas['catalogs/basic/catalog.json']));
        if (catalogSchema['$id']) {
            catalogSchema['$id'] = catalogSchema['$id'].replace(/catalogs\/basic\/catalog\.json$/, 'catalog.json');
        }
        schemas['catalog.json'] = catalogSchema;
    }
    return schemas;
}
function generateSummary(results, analysisResults) {
    const promptNameWidth = 40;
    const latencyWidth = 20;
    const failedRunsWidth = 15;
    const severityWidth = 15;
    // Group by model
    const resultsByModel = {};
    for (const result of results) {
        if (!resultsByModel[result.modelName]) {
            resultsByModel[result.modelName] = [];
        }
        resultsByModel[result.modelName].push(result);
    }
    let summary = '# Evaluation Summary';
    for (const modelName in resultsByModel) {
        summary += `\n\n## Model: ${modelName}\n\n`;
        const header = `| ${'Prompt Name'.padEnd(promptNameWidth)} | ${'Avg Latency (ms)'.padEnd(latencyWidth)} | ${'Schema Fail'.padEnd(failedRunsWidth)} | ${'Eval Fail'.padEnd(failedRunsWidth)} | ${'Minor'.padEnd(severityWidth)} | ${'Significant'.padEnd(severityWidth)} | ${'Critical'.padEnd(severityWidth)} |`;
        const divider = `|${'-'.repeat(promptNameWidth + 2)}|${'-'.repeat(latencyWidth + 2)}|${'-'.repeat(failedRunsWidth + 2)}|${'-'.repeat(failedRunsWidth + 2)}|${'-'.repeat(severityWidth + 2)}|${'-'.repeat(severityWidth + 2)}|${'-'.repeat(severityWidth + 2)}|`;
        summary += header;
        summary += `\n${divider}`;
        const modelResults = resultsByModel[modelName];
        const promptsInModel = modelResults.reduce((acc, result) => {
            if (!acc[result.prompt.name]) {
                acc[result.prompt.name] = [];
            }
            acc[result.prompt.name].push(result);
            return acc;
        }, {});
        const sortedPromptNames = Object.keys(promptsInModel).sort();
        for (const promptName of sortedPromptNames) {
            const runs = promptsInModel[promptName];
            const totalRuns = runs.length;
            const schemaFailedRuns = runs.filter(r => r.error || r.validationErrors.length > 0).length;
            const evalFailedRuns = runs.filter(r => r.evaluationResult && !r.evaluationResult.pass).length;
            const totalLatency = runs.reduce((acc, r) => acc + r.latency, 0);
            const avgLatency = (totalLatency / totalRuns).toFixed(0);
            const schemaFailedStr = schemaFailedRuns > 0 ? `${schemaFailedRuns} / ${totalRuns}` : '';
            const evalFailedStr = evalFailedRuns > 0 ? `${evalFailedRuns} / ${totalRuns}` : '';
            let minorCount = 0;
            let significantCount = 0;
            let criticalCount = 0;
            for (const r of runs) {
                if (r.evaluationResult?.issues) {
                    for (const issue of r.evaluationResult.issues) {
                        if (issue.severity === 'minor')
                            minorCount++;
                        else if (issue.severity === 'significant')
                            significantCount++;
                        else if (issue.severity === 'critical')
                            criticalCount++;
                    }
                }
            }
            const minorStr = minorCount > 0 ? `${minorCount}` : '';
            const significantStr = significantCount > 0 ? `${significantCount}` : '';
            const criticalStr = criticalCount > 0 ? `${criticalCount}` : '';
            summary += `\n| ${promptName.padEnd(promptNameWidth)} | ${avgLatency.padEnd(latencyWidth)} | ${schemaFailedStr.padEnd(failedRunsWidth)} | ${evalFailedStr.padEnd(failedRunsWidth)} | ${minorStr.padEnd(severityWidth)} | ${significantStr.padEnd(severityWidth)} | ${criticalStr.padEnd(severityWidth)} |`;
        }
        const totalRunsForModel = modelResults.length;
        const successfulRuns = modelResults.filter(r => !r.error &&
            r.validationErrors.length === 0 &&
            (!r.evaluationResult || r.evaluationResult.pass)).length;
        const schemaSuccessfulRuns = modelResults.filter(r => !r.error && r.validationErrors.length === 0).length;
        const schemaSuccessPercentage = totalRunsForModel === 0
            ? '0.0'
            : ((schemaSuccessfulRuns / totalRunsForModel) * 100.0).toFixed(1);
        const successPercentage = totalRunsForModel === 0 ? '0.0' : ((successfulRuns / totalRunsForModel) * 100.0).toFixed(1);
        summary += `\n\n**Schema successful runs:** ${schemaSuccessfulRuns} / ${totalRunsForModel} (${schemaSuccessPercentage}% schema success)`;
        summary += `\n**Total successful eval runs:** ${successfulRuns} / ${totalRunsForModel} (${successPercentage}% overall success)`;
        if (analysisResults[modelName]) {
            summary += `\n\n### Failure Analysis\n\n${analysisResults[modelName]}`;
        }
    }
    summary += '\n\n---\n\n## Overall Summary\n';
    const totalRuns = results.length;
    const totalToolErrorRuns = results.filter(r => r.error).length;
    const totalRunsWithAnyFailure = results.filter(r => r.error || r.validationErrors.length > 0 || (r.evaluationResult && !r.evaluationResult.pass)).length;
    const modelsWithFailures = [
        ...new Set(results
            .filter(r => r.error ||
            r.validationErrors.length > 0 ||
            (r.evaluationResult && !r.evaluationResult.pass))
            .map(r => r.modelName)),
    ].join(', ');
    let totalMinor = 0;
    let totalSignificant = 0;
    let totalCritical = 0;
    let totalCriticalSchema = 0;
    for (const r of results) {
        if (r.evaluationResult?.issues) {
            for (const issue of r.evaluationResult.issues) {
                if (issue.severity === 'minor')
                    totalMinor++;
                else if (issue.severity === 'significant')
                    totalSignificant++;
                else if (issue.severity === 'critical')
                    totalCritical++;
                else if (issue.severity === 'criticalSchema')
                    totalCriticalSchema++;
            }
        }
    }
    summary += `\n- **Total tool failures:** ${totalToolErrorRuns} / ${totalRuns}`;
    const successPercentage = totalRuns === 0
        ? '0.0'
        : (((totalRuns - totalRunsWithAnyFailure) / totalRuns) * 100.0).toFixed(1);
    summary += `\n- **Number of runs with any failure (tool error, validation, or eval):** ${totalRunsWithAnyFailure} / ${totalRuns} (${successPercentage}% success)`;
    summary += '\n- **Severity Breakdown:**';
    summary += `\n  - **Minor:** ${totalMinor}`;
    summary += `\n  - **Significant:** ${totalSignificant}`;
    summary += `\n  - **Critical (Eval):** ${totalCritical}`;
    summary += `\n  - **Critical (Schema):** ${totalCriticalSchema}`;
    const latencies = results.map(r => r.latency).sort((a, b) => a - b);
    const totalLatency = latencies.reduce((acc, l) => acc + l, 0);
    const meanLatency = totalRuns > 0 ? (totalLatency / totalRuns).toFixed(0) : '0';
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
async function main() {
    const argv = await (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
        .option('log-level', {
        type: 'string',
        description: 'Set the logging level',
        default: 'info',
        choices: ['debug', 'info', 'warn', 'error'],
    })
        .option('results', {
        type: 'string',
        description: 'Directory to keep output files. If not specified, uses results/output-<model>. If specified, uses the provided directory (appending output-<model>).',
        coerce: arg => (arg === undefined ? true : arg),
        default: true,
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
        array: true,
        description: 'Filter prompts by name prefix',
    })
        .option('eval-model', {
        type: 'string',
        description: 'Model to use for evaluation',
        default: 'gemini-2.5-flash',
        choices: models_1.modelsToTest.map(m => m.name),
    })
        .option('clean-results', {
        type: 'boolean',
        description: 'Clear the output directory before starting',
        default: false,
    })
        .help()
        .alias('h', 'help')
        .strict().argv;
    // Filter Models
    let filteredModels = models_1.modelsToTest;
    if (argv.model && argv.model.length > 0) {
        const modelNames = argv.model;
        filteredModels = models_1.modelsToTest.filter(m => modelNames.includes(m.name));
        if (filteredModels.length === 0) {
            logger_1.logger.error(`No models found matching: ${modelNames.join(', ')}.`);
            process.exit(1);
        }
    }
    // Filter Prompts
    let filteredPrompts = prompts_1.prompts;
    if (argv.prompt && argv.prompt.length > 0) {
        const promptPrefixes = argv.prompt;
        filteredPrompts = prompts_1.prompts.filter(p => promptPrefixes.some(prefix => p.name.startsWith(prefix)));
        if (filteredPrompts.length === 0) {
            logger_1.logger.error(`No prompt found with prefix "${promptPrefixes.join(', ')}".`);
            process.exit(1);
        }
    }
    // Determine Output Directory (Base)
    // Note: Generator/Validator/Evaluator handle per-model subdirectories if outputDir is provided.
    // But we need a base output dir to pass to them.
    let resultsBaseDir;
    const resultsArg = argv.results;
    if (typeof resultsArg === 'string') {
        resultsBaseDir = resultsArg;
    }
    else if (resultsArg === true) {
        resultsBaseDir = 'results';
    }
    // Clean Results
    if (argv['clean-results'] && resultsBaseDir && fs.existsSync(resultsBaseDir)) {
        // Only force clean known result directories for safety if the user provides the flag.
        if (resultsBaseDir === 'results') {
            fs.rmSync(resultsBaseDir, { recursive: true, force: true });
        }
        else {
            fs.rmSync(resultsBaseDir, { recursive: true, force: true });
        }
    }
    // Configure global logger. File logging is currently only supported when testing a single model.
    if (resultsBaseDir) {
        if (filteredModels.length === 1) {
            const modelDirName = `output-${filteredModels[0].name.replace(/[/:]/g, '_')}`;
            (0, logger_1.setupLogger)(path.join(resultsBaseDir, modelDirName), argv['log-level']);
        }
        else {
            (0, logger_1.setupLogger)(undefined, argv['log-level']);
        }
    }
    else {
        (0, logger_1.setupLogger)(undefined, argv['log-level']);
    }
    const schemas = loadSchemas();
    const catalogRules = schemas['catalogs/basic/catalog.json']?.instructions;
    // Phase 1: Generation
    const generator = new generator_1.Generator(schemas, resultsBaseDir, catalogRules);
    const generatedResults = await generator.run(filteredPrompts, filteredModels, argv['runs-per-prompt']);
    // Phase 2: Validation
    const validator = new validator_1.Validator(schemas, resultsBaseDir);
    const validatedResults = await validator.run(generatedResults);
    // Phase 3: Evaluation
    const evaluator = new evaluator_1.Evaluator(schemas, argv['eval-model'], resultsBaseDir);
    const evaluatedResults = await evaluator.run(validatedResults);
    // Phase 4: Failure Analysis
    const analysisResults = {};
    const resultsByModel = {};
    for (const result of evaluatedResults) {
        if (!resultsByModel[result.modelName]) {
            resultsByModel[result.modelName] = [];
        }
        resultsByModel[result.modelName].push(result);
    }
    for (const modelName in resultsByModel) {
        const modelResults = resultsByModel[modelName];
        const failures = modelResults
            .filter(r => r.error ||
            r.validationErrors.length > 0 ||
            (r.evaluationResult && !r.evaluationResult.pass))
            .map(r => {
            let failureType = 'Unknown';
            let reason = 'Unknown';
            let issues = [];
            if (r.error) {
                failureType = 'Tool Error';
                reason = r.error.message || String(r.error);
            }
            else if (r.validationErrors.length > 0) {
                failureType = 'Schema Validation';
                reason = 'Schema validation failed';
                issues = r.validationErrors;
            }
            else if (r.evaluationResult && !r.evaluationResult.pass) {
                failureType = 'Evaluation Failure';
                reason = r.evaluationResult.reason;
                if (r.evaluationResult.issues) {
                    issues = r.evaluationResult.issues.map(i => `${i.severity}: ${i.issue}`);
                }
            }
            return {
                promptName: r.prompt.name,
                runNumber: r.runNumber,
                failureType,
                reason,
                issues,
            };
        });
        if (failures.length > 0) {
            logger_1.logger.info(`Running failure analysis for model: ${modelName}...`);
            try {
                const analysis = await (0, analysis_flow_1.analysisFlow)({
                    modelName,
                    failures,
                    numRuns: modelResults.length,
                    evalModel: argv['eval-model'],
                });
                analysisResults[modelName] = analysis;
            }
            catch (e) {
                logger_1.logger.error(`Failed to run failure analysis for ${modelName}: ${e}`);
                analysisResults[modelName] = 'Failed to run analysis.';
            }
        }
    }
    // Summary
    const summary = generateSummary(evaluatedResults, analysisResults);
    logger_1.logger.info(summary);
    if (resultsBaseDir) {
        // Save a copy of the evaluation summary to each model's output directory.
        for (const model of filteredModels) {
            const modelDirName = `output-${model.name.replace(/[/:]/g, '_')}`;
            const modelDir = path.join(resultsBaseDir, modelDirName);
            if (fs.existsSync(modelDir)) {
                fs.writeFileSync(path.join(modelDir, 'summary.md'), summary);
            }
        }
    }
}
if (require.main === module) {
    main().catch(console.error);
}
