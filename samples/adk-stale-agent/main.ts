/*
 * Copyright 2026 Google LLC
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

import {InMemoryRunner} from '@google/adk';
import {rootAgent} from './agent.js';
import {
  CONCURRENCY_LIMIT,
  OWNER,
  REPO,
  SLEEP_BETWEEN_CHUNKS,
  STALE_HOURS_THRESHOLD,
} from './settings.js';
import {getApiCallCount, getOldOpenIssueNumbers, resetApiCallCount} from './utils.js';

export const APP_NAME = 'stale_bot_app';
export const USER_ID = 'stale_bot_user';

async function processSingleIssue(issueNumber: number): Promise<[number, number]> {
  const startTime = performance.now();
  const startApiCalls = getApiCallCount();

  console.info(`Processing Issue #${issueNumber}...`);
  console.debug(`#${issueNumber}: Initializing runner and session.`);

  try {
    const runner = new InMemoryRunner({agent: rootAgent, appName: APP_NAME});

    const session = await runner.sessionService.createSession({
      userId: USER_ID,
      appName: APP_NAME,
    });

    const newMessage = {
      role: 'user',
      parts: [{text: `Audit Issue #${issueNumber}.`}],
    };

    for await (const event of runner.runAsync({
      userId: USER_ID,
      sessionId: session.id,
      newMessage,
    })) {
      // Access text via event.content.parts
      const text = event.content?.parts?.[0]?.text;

      if (text) {
        const cleanText = text.slice(0, 150).replace(/\n/g, ' ');
        console.info(`#${issueNumber} Decision: ${cleanText}...`);
      }
    }
  } catch (error) {
    console.error(`Error processing issue #${issueNumber}:`, error);
  }

  const duration = (performance.now() - startTime) / 1000;
  const endApiCalls = getApiCallCount();
  const issueApiCalls = endApiCalls - startApiCalls;

  console.info(
    `Issue #${issueNumber} finished in ${duration.toFixed(2)}s with ~${issueApiCalls} API calls.`,
  );

  return [duration, issueApiCalls];
}

async function main() {
  console.info(`--- Starting Stale Bot for ${OWNER}/${REPO} ---`);
  console.info(`Concurrency level set to ${CONCURRENCY_LIMIT}`);

  resetApiCallCount();

  const filterDays = STALE_HOURS_THRESHOLD / 24;
  console.debug(`Fetching issues older than ${filterDays.toFixed(2)} days...`);

  let allIssues;

  try {
    allIssues = await getOldOpenIssueNumbers(OWNER, REPO, filterDays);
  } catch (error) {
    console.error('Failed to fetch issue list:', error);
    return;
  }

  const totalCount = allIssues.length;
  const searchApiCalls = getApiCallCount();

  if (totalCount === 0) {
    console.info('No issues matched the criteria. Run finished.');
    return;
  }

  console.info(
    `Found ${totalCount} issues to process. ` +
      `(Initial search used ${searchApiCalls} API calls).`,
  );

  let totalProcessingTime = 0;
  let totalIssueApiCalls = 0;
  let processedCount = 0;

  for (let i = 0; i < totalCount; i += CONCURRENCY_LIMIT) {
    const chunk = allIssues.slice(i, i + CONCURRENCY_LIMIT);
    const currentChunkNum = Math.floor(i / CONCURRENCY_LIMIT) + 1;

    console.info(`--- Starting chunk ${currentChunkNum}: Processing issues ${chunk} ---`);

    const results = await Promise.all(chunk.map(issueNum => processSingleIssue(issueNum)));

    for (const [duration, apiCalls] of results) {
      totalProcessingTime += duration;
      totalIssueApiCalls += apiCalls;
    }

    processedCount += chunk.length;

    console.info(
      `--- Finished chunk ${currentChunkNum}. Progress: ` + `${processedCount}/${totalCount} ---`,
    );

    if (i + CONCURRENCY_LIMIT < totalCount) {
      console.debug(`Sleeping for ${SLEEP_BETWEEN_CHUNKS}s to respect rate limits...`);

      await new Promise(resolve => setTimeout(resolve, SLEEP_BETWEEN_CHUNKS * 1000));
    }
  }

  const totalApiCallsForRun = searchApiCalls + totalIssueApiCalls;

  const avgTimePerIssue = totalCount > 0 ? totalProcessingTime / totalCount : 0;

  console.info('--- Stale Agent Run Finished ---');
  console.info(`Successfully processed ${processedCount} issues.`);
  console.info(`Total API calls made this run: ${totalApiCallsForRun}`);
  console.info(`Average processing time per issue: ${avgTimePerIssue.toFixed(2)} seconds.`);
}

async function run() {
  const startTime = performance.now();

  try {
    await main();
  } catch (error) {
    console.error('Unexpected fatal error:', error);
  }

  const duration = (performance.now() - startTime) / 1000;

  console.info(`Full audit finished in ${(duration / 60).toFixed(2)} minutes.`);
}

run();
