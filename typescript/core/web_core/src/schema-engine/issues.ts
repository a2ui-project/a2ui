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

function typeNames(type: unknown): string | undefined {
  const names = Array.isArray(type)
    ? type.map(String)
    : typeof type === 'string'
      ? type.split(',').map(t => t.trim())
      : undefined;
  return names && names.length > 0 ? names.join(' or ') : undefined;
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * Describes an issue in web_core's own words, from its JSON Schema keyword
 * and parameters, so the text is the same whichever engine reported it. An
 * issue without a keyword (such as one from an integrity check) keeps its
 * message.
 */
export function messageForIssue(issue: A2uiIssue): string {
  const p = issue.params ?? {};
  switch (issue.keyword) {
    case undefined:
      return issue.message;
    case 'required':
      return typeof p.missingProperty === 'string'
        ? `missing required property '${p.missingProperty}'`
        : 'missing a required property';
    case 'type': {
      const names = typeNames(p.type);
      return names ? `must be ${names}` : 'has the wrong type';
    }
    case 'const':
      return 'allowedValue' in p ? `must be ${json(p.allowedValue)}` : 'must be the constant value';
    case 'enum':
      return Array.isArray(p.allowedValues)
        ? `must be one of ${p.allowedValues.map(json).join(', ')}`
        : 'must be one of the allowed values';
    case 'additionalProperties':
    case 'unevaluatedProperties': {
      const prop = p.additionalProperty ?? p.unevaluatedProperty;
      return typeof prop === 'string'
        ? `unexpected property '${prop}'`
        : 'has an unexpected property';
    }
    case 'not':
      return 'must not match the disallowed schema';
    case 'oneOf':
      return 'must match exactly one of the allowed schemas';
    case 'anyOf':
      return 'must match at least one of the allowed schemas';
    default:
      return `fails the '${issue.keyword}' constraint`;
  }
}

/**
 * Formats an issue as `<path>: <message>`, using `root` for an empty path and
 * {@link messageForIssue} for the message.
 */
export function formatIssue(issue: A2uiIssue): string {
  return `${issue.path.length ? issue.path.join('.') : 'root'}: ${messageForIssue(issue)}`;
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
