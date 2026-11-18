/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {ErrorObject} from 'ajv';

/** A schema violation, located by the property it concerns. */
export interface SchemaViolation {
  /**
   * The path of the offending property relative to the validated value, such as `variant` or
   * `action.event.name`. Empty when the violation concerns the value itself.
   */
  property: string;
  /** What is wrong with the property, such as `must be one of "caption", "body"`. */
  problem: string;
}

const COMPOSITE_KEYWORDS = new Set(['oneOf', 'anyOf']);

/**
 * Turns ajv errors (collected with `allErrors: true`) into one human-readable violation per problem.
 *
 * A failed `oneOf` or `anyOf` makes ajv report the errors of every alternative. Those errors are
 * collapsed into one violation: the deepest error when an alternative got past the property itself
 * (it is most likely the intended one), or a summary of the accepted types otherwise.
 */
export function describeSchemaErrors(errors: readonly ErrorObject[]): SchemaViolation[] {
  const compositePaths = errors
    .filter(error => COMPOSITE_KEYWORDS.has(error.keyword))
    .map(error => error.instancePath)
    .sort((a, b) => a.length - b.length);
  const groups = new Map<string, ErrorObject[]>();
  const ungrouped: ErrorObject[] = [];
  for (const error of errors) {
    const groupPath = compositePaths.find(path => isWithin(error.instancePath, path));
    if (groupPath === undefined) {
      ungrouped.push(error);
    } else {
      groups.set(groupPath, [...(groups.get(groupPath) ?? []), error]);
    }
  }

  const violations = [
    ...ungrouped.map(describeError),
    ...[...groups].map(([path, group]) => describeComposite(path, group)),
  ];
  const seen = new Set<string>();
  return violations.filter(violation => {
    const key = `${violation.property}\u0000${violation.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeComposite(path: string, group: readonly ErrorObject[]): SchemaViolation {
  const alternatives = group.filter(error => !COMPOSITE_KEYWORDS.has(error.keyword));
  const deepest = alternatives.reduce<ErrorObject | undefined>(
    (best, error) => (depth(error.instancePath) > depth(best?.instancePath ?? path) ? error : best),
    undefined,
  );
  if (deepest) {
    return describeError(deepest);
  }
  const property = toPropertyPath(path);
  const atPath = alternatives.filter(error => error.instancePath === path);
  if (atPath.length > 0 && atPath.every(error => error.keyword === 'type')) {
    const types = [...new Set(atPath.flatMap(error => typeNames(error.params['type'])))];
    return {property, problem: `must be ${joinWithOr(types.map(withArticle))}`};
  }
  return {property, problem: 'does not match any of its allowed forms'};
}

function describeError(error: ErrorObject): SchemaViolation {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'required':
      return {
        property: toPropertyPath(error.instancePath, String(params['missingProperty'])),
        problem: 'is required',
      };
    case 'additionalProperties':
      return {
        property: toPropertyPath(error.instancePath, String(params['additionalProperty'])),
        problem: 'is not allowed',
      };
    case 'unevaluatedProperties':
      return {
        property: toPropertyPath(error.instancePath, String(params['unevaluatedProperty'])),
        problem: 'is not allowed',
      };
    case 'enum': {
      const allowed = Array.isArray(params['allowedValues']) ? params['allowedValues'] : [];
      return {
        property: toPropertyPath(error.instancePath),
        problem: `must be one of ${allowed.map(value => JSON.stringify(value)).join(', ')}`,
      };
    }
    case 'const':
      return {
        property: toPropertyPath(error.instancePath),
        problem: `must be ${JSON.stringify(params['allowedValue'])}`,
      };
    case 'type':
      return {
        property: toPropertyPath(error.instancePath),
        problem: `must be ${joinWithOr(typeNames(params['type']).map(withArticle))}`,
      };
    default:
      return {property: toPropertyPath(error.instancePath), problem: error.message ?? 'is invalid'};
  }
}

function isWithin(instancePath: string, path: string): boolean {
  return instancePath === path || instancePath.startsWith(`${path}/`);
}

function depth(instancePath: string): number {
  return instancePath === '' ? 0 : instancePath.split('/').length - 1;
}

/** Converts a JSON pointer (plus an optional child key) to a path like `children[0].id`. */
function toPropertyPath(instancePath: string, childKey?: string): string {
  const segments = instancePath === '' ? [] : instancePath.slice(1).split('/').map(unescapePointer);
  if (childKey !== undefined) segments.push(childKey);
  return segments.reduce(
    (path, segment) =>
      /^\d+$/.test(segment) ? `${path}[${segment}]` : path ? `${path}.${segment}` : segment,
    '',
  );
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function typeNames(type: unknown): string[] {
  if (Array.isArray(type)) return type.map(String);
  return typeof type === 'string' ? type.split(',') : [];
}

function withArticle(type: string): string {
  if (type === 'null') return 'null';
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function joinWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
