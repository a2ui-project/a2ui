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

import * as dotenv from 'dotenv';

// # Load environment variables from a .env file for local testing
dotenv.config({override: true});

// # --- GitHub API Configuration ---
export const GITHUB_BASE_URL = 'https://api.github.com';
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error('GITHUB_TOKEN environment variable not set');
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Startup Error: Missing required environment variable '${name}'`);
  }
  return value;
}

export const OWNER = getRequiredEnv('OWNER');
export const REPO = getRequiredEnv('REPO');
export const LLM_MODEL_NAME = getRequiredEnv('LLM_MODEL_NAME');
export const STALE_LABEL_NAME = getRequiredEnv('STALE_LABEL_NAME');
export const REQUEST_CLARIFICATION_LABEL = getRequiredEnv('REQUEST_CLARIFICATION_LABEL');

// # --- THRESHOLDS IN HOURS ---
// # Default: 168 hours (7 days)
// # The number of hours of inactivity after a maintainer comment before an issue is marked as stale.
export const STALE_HOURS_THRESHOLD: number = parseFloat(process.env.STALE_HOURS_THRESHOLD ?? '168');

// # Default: 168 hours (7 days)
// # The number of hours of inactivity after an issue is marked 'stale' before it is closed.
export const CLOSE_HOURS_AFTER_STALE_THRESHOLD: number = parseFloat(
  process.env.CLOSE_HOURS_AFTER_STALE_THRESHOLD ?? '168',
);

// # --- Performance Configuration ---
// # The number of issues to process concurrently.
// # Higher values are faster but increase the immediate rate of API calls
export const CONCURRENCY_LIMIT: number = parseInt(process.env.CONCURRENCY_LIMIT ?? '3', 10);

// # --- GraphQL Query Limits ---
// # The number of most recent comments to fetch for context analysis.
export const GRAPHQL_COMMENT_LIMIT: number = parseInt(
  process.env.GRAPHQL_COMMENT_LIMIT ?? '30',
  10,
);

// # The number of most recent description edits to fetch.
export const GRAPHQL_EDIT_LIMIT: number = parseInt(process.env.GRAPHQL_EDIT_LIMIT ?? '10', 10);

// # The number of most recent timeline events (labels, renames, reopens) to fetch.
export const GRAPHQL_TIMELINE_LIMIT: number = parseInt(
  process.env.GRAPHQL_TIMELINE_LIMIT ?? '20',
  10,
);

// # --- Rate Limiting ---
// # Time in seconds to wait between processing chunks.
export const SLEEP_BETWEEN_CHUNKS: number = parseFloat(process.env.SLEEP_BETWEEN_CHUNKS ?? '1.5');
