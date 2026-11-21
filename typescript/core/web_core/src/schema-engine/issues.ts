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
import {A2uiConfigurationError, type A2uiErrorDetail} from '../errors.js';
import type {A2uiIssue} from './types.js';

const KEYWORD_ORDER = ['required', 'const', 'enum', 'type', 'additionalProperties'];

function keywordRank(issue: A2uiIssue): number {
  const i = issue.keyword === undefined ? -1 : KEYWORD_ORDER.indexOf(issue.keyword);
  return i === -1 ? KEYWORD_ORDER.length : i;
}

/**
 * Picks the most informative issue: deepest path first, then keyword priority.
 * With no issues (a schema that failed without saying why) it returns a
 * root-level `invalid value` issue.
 */
export function pickIssue(issues: A2uiIssue[]): A2uiIssue {
  if (issues.length === 0) return {path: [], message: 'invalid value'};
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

/**
 * The error detail of an issue: its path as a JSON Pointer under `prefix`, a
 * code from its keyword (`missing_field` for `required`, `invalid_type` for
 * `type`, `invalid_value` for `const`, `enum` or no keyword, otherwise the
 * keyword itself) and its message in web_core's words
 * ({@link messageForIssue}), so the detail does not depend on the engine.
 *
 * @param issue The issue.
 * @param prefix JSON Pointer of the validated value.
 */
export function issueToDetail(issue: A2uiIssue, prefix = ''): A2uiErrorDetail {
  const pointer = issue.path
    .map(s => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
  const code =
    issue.keyword === 'required'
      ? 'missing_field'
      : issue.keyword === 'type'
        ? 'invalid_type'
        : issue.keyword === undefined || issue.keyword === 'const' || issue.keyword === 'enum'
          ? 'invalid_value'
          : issue.keyword;
  return {path: `${prefix}${pointer}` || '/', code, message: messageForIssue(issue)};
}

/**
 * Keywords that only say a subschema failed: `$ref`, applicators and
 * combinators, and cfworker's `false` (a `false` subschema). Engines report
 * these differently (cfworker reports each, Ajv few), so {@link issuesToDetails}
 * drops one when a more specific issue is at or below its path.
 */
const UMBRELLA_KEYWORDS = new Set([
  '$ref',
  '$dynamicRef',
  'properties',
  'patternProperties',
  'allOf',
  'items',
  'prefixItems',
  'additionalItems',
  'oneOf',
  'anyOf',
  'if',
  'then',
  'else',
  'false',
  'false schema',
]);

const isUmbrella = (issue: A2uiIssue) =>
  issue.keyword !== undefined && UMBRELLA_KEYWORDS.has(issue.keyword);

const isAtOrBelow = (path: (string | number)[], base: (string | number)[]) =>
  path.length >= base.length && base.every((seg, i) => String(path[i]) === String(seg));

/**
 * The error details of a failed validation, the same whichever engine
 * reported the issues: `picked` (the issue the error message names) first,
 * then the other issues, without umbrella issues ({@link UMBRELLA_KEYWORDS})
 * that a more specific issue at or below their path explains, without
 * duplicates, and sorted by path, code and message.
 *
 * @param picked The issue the error message names, from {@link pickIssue}.
 * @param issues All the issues.
 * @param prefix JSON Pointer of the validated value.
 */
export function issuesToDetails(
  picked: A2uiIssue,
  issues: readonly A2uiIssue[],
  prefix = '',
): A2uiErrorDetail[] {
  const specific = issues.filter(i => !isUmbrella(i));
  const kept = issues.filter(
    i => !isUmbrella(i) || !specific.some(s => isAtOrBelow(s.path, i.path)),
  );
  const first = issueToDetail(picked, prefix);
  const key = (d: A2uiErrorDetail) => `${d.path}\u0000${d.code}\u0000${d.message}`;
  const seen = new Set([key(first)]);
  const rest: A2uiErrorDetail[] = [];
  for (const detail of kept.map(i => issueToDetail(i, prefix))) {
    const k = key(detail);
    if (seen.has(k)) continue;
    seen.add(k);
    rest.push(detail);
  }
  rest.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return [first, ...rest];
}

/** The keyword and parameters an issue from a JSON-backed schema carries. */
const ISSUE_DETAIL = Symbol('a2ui.issueDetail');

type IssueDetail = Pick<A2uiIssue, 'keyword' | 'params'>;

/**
 * Converts an {@link A2uiIssue} into a Standard Schema issue. Its `keyword`
 * and `params` ride along in a non-enumerable field that
 * {@link toA2uiIssues} reads back, so web_core can still pick and word the
 * issue after it passed through `~standard.validate`.
 */
export function toStandardIssue(issue: A2uiIssue): StandardSchemaV1.Issue {
  const standard: StandardSchemaV1.Issue = {message: issue.message, path: [...issue.path]};
  if (issue.keyword !== undefined || issue.params !== undefined) {
    const detail: IssueDetail = {keyword: issue.keyword, params: issue.params};
    Object.defineProperty(standard, ISSUE_DETAIL, {value: detail});
  }
  return standard;
}

/** Converts Standard Schema issues into {@link A2uiIssue}s. */
export function toA2uiIssues(issues: readonly StandardSchemaV1.Issue[]): A2uiIssue[] {
  return issues.map(issue => {
    const a2uiIssue: A2uiIssue = {
      path: (issue.path ?? []).map(seg => {
        const key = typeof seg === 'object' ? seg.key : seg;
        return typeof key === 'number' ? key : String(key);
      }),
      message: issue.message,
    };
    const detail = (issue as {[ISSUE_DETAIL]?: IssueDetail})[ISSUE_DETAIL];
    if (detail?.keyword !== undefined) a2uiIssue.keyword = detail.keyword;
    if (detail?.params !== undefined) a2uiIssue.params = detail.params;
    return a2uiIssue;
  });
}

/** Returns `r` or throws if it is a promise (async validators are unsupported). */
export function assertSync<T>(r: T | Promise<T>, what: string): T {
  if (r instanceof Promise) {
    // The rejection, if any, is not ours to report: the error below is.
    r.catch(() => {});
    throw new A2uiConfigurationError(
      `${what}: schema validation must be synchronous, but an asynchronous result was returned.`,
    );
  }
  return r;
}
