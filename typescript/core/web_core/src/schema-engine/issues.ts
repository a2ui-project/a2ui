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

import type {StandardSchemaV1} from '@standard-schema/spec';
import {A2uiConfigurationError} from '../errors.js';
import type {A2uiIssue} from './types.js';

const KEYWORD_ORDER = ['required', 'const', 'enum', 'type', 'additionalProperties'];

function keywordRank(issue: A2uiIssue): number {
  const i = issue.keyword === undefined ? -1 : KEYWORD_ORDER.indexOf(issue.keyword);
  return i === -1 ? KEYWORD_ORDER.length : i;
}

/** Picks the most informative issue: deepest path first, then keyword priority. */
export function pickIssue(issues: A2uiIssue[]): A2uiIssue {
  let best = issues[0];
  for (const issue of issues) {
    if (
      issue.path.length > best.path.length ||
      (issue.path.length === best.path.length && keywordRank(issue) < keywordRank(best))
    ) {
      best = issue;
    }
  }
  return best;
}

/** Formats an issue as `<path>: <message>`, using `root` for an empty path. */
export function formatIssue(issue: A2uiIssue): string {
  return `${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`;
}

/** Converts Standard Schema issues into {@link A2uiIssue}s. */
export function toA2uiIssues(issues: readonly StandardSchemaV1.Issue[]): A2uiIssue[] {
  return issues.map(issue => ({
    path: (issue.path ?? []).map(seg => {
      const key = typeof seg === 'object' ? seg.key : seg;
      return typeof key === 'number' ? key : String(key);
    }),
    message: issue.message,
  }));
}

/** Returns `r` or throws if it is a promise (async validators are unsupported). */
export function assertSync<T>(r: T | Promise<T>, what: string): T {
  if (r instanceof Promise) {
    throw new A2uiConfigurationError(
      `${what}: schema validation must be synchronous, but an asynchronous result was returned.`,
    );
  }
  return r;
}
