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

import {jsonValueEquals} from '../../common/metadata.js';
import {isAtLeastVersion} from '../../common/semver.js';
import type {
  ComponentDefinition,
  DataTypeDefinition,
  FunctionDefinition,
  ParameterDefinition,
  SurfacePropertiesDefinition,
  TypeDefinition,
} from './catalog_model.js';
import {
  describeValueType,
  isPlainRecord,
  isValidEmail,
  isValidRfc3339Date,
  isValidRfc3339DateTime,
  isValidRfc3339Time,
  isValidUri,
} from './format_validators.js';
import type {OpaqueTypeRegistry, OpaqueTypeSpec} from './opaque_types.js';

/**
 * Structured validation issue produced by zero-dependency validators.
 *
 * Structurally compatible with `z.ZodIssue` so error mappers and formatters
 * can handle both native and legacy Zod issues uniformly.
 */
export interface ValidationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly code?: string;
  readonly expected?: string;
  readonly received?: string;
  readonly keys?: readonly string[];
  readonly options?: readonly unknown[];
  readonly unionErrors?: readonly {readonly issues: readonly ValidationIssue[]}[];
}

/** Result returned by native zero-dependency validators. */
export type ValidationOutcome<T = unknown> =
  | {readonly success: true; readonly data: T}
  | {readonly success: false; readonly issues: readonly ValidationIssue[]};

/** Options controlling runtime validation against a canonical {@link TypeDefinition}. */
export interface ValidateCatalogValueOptions {
  /** Catalog-local type definitions used to resolve `{ type: 'ref' }`. */
  readonly types?: Readonly<Record<string, DataTypeDefinition>>;
  /** Protocol version (governs `@path`/`@call` vs `path`/`call` wire keys). */
  readonly protocolVersion?: string;
  /** Whether to populate omitted object properties that declare a `default`. */
  readonly applyDefaults?: boolean;
  /**
   * Whether to coerce resolved `DynamicBoolean` positions (including v1.0
   * `ValidationResult` `{ valid: boolean }` objects) before type checking.
   */
  readonly coerceDynamicBoolean?: boolean;
  /**
   * Host-registered branded / opaque value types keyed by `StringTypeDefinition.format`
   * name (e.g. `'trusted-resource-url'`, `'safe-html'`). When a string parameter's
   * `format` matches a registered entry, values passing `isInstance` are accepted
   * and raw unbranded strings are rejected.
   */
  readonly opaqueTypes?: OpaqueTypeRegistry;
}

const MAX_VALIDATION_DEPTH = 128;

/**
 * Formats a {@link ValidationIssue} into a human-readable diagnostic string.
 */
export function formatValidationIssue(issue: ValidationIssue): string {
  const path = issue.path.join('.') || 'root';
  switch (issue.code) {
    case 'invalid_union': {
      const unionIssues = issue.unionErrors?.flatMap(u => u.issues);
      if (unionIssues && unionIssues.length > 0) {
        return unionIssues.map(formatValidationIssue).join('; ');
      }
      return `${path}: ${issue.message || 'Invalid union'}`;
    }
    case 'unrecognized_keys': {
      const keysStr = (issue.keys ?? []).map(k => `'${k}'`).join(', ');
      return `${path}: Unrecognized key(s) in object: ${keysStr}`;
    }
    case 'invalid_enum_value': {
      const optionsStr = (issue.options ?? []).map(o => String(o)).join(' | ');
      return `${path}: Invalid enum value. Expected ${optionsStr}, received '${String(issue.received)}'`;
    }
    case 'invalid_type':
      if (issue.expected !== undefined && issue.received !== undefined) {
        return `${path}: Expected ${issue.expected}, received ${issue.received}`;
      }
      return `${path}: ${issue.message}`;
    case 'custom':
      return `${path}: ${issue.message}`;
    default:
      return issue.message
        ? `${path}: ${issue.message}`
        : `${path}: Validation error (${issue.code ?? 'invalid'})`;
  }
}

/**
 * Coerces a resolved `DynamicBoolean` value (including v1.0 `ValidationResult`
 * objects with a boolean `valid` property) to a boolean.
 */
export function coerceModelDynamicBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (isPlainRecord(value) && typeof value['valid'] === 'boolean') {
    return value['valid'];
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0 && !Number.isNaN(value);
  }
  return false;
}

/**
 * Returns whether `value` is a valid A2UI data binding (`{'@path': string}` or `{'path': string}`).
 */
export function isDataBindingValue(value: unknown, protocolVersion?: string): boolean {
  if (!isPlainRecord(value)) return false;
  const allowAt = !protocolVersion || isAtLeastVersion(protocolVersion, '1.0');
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const key = keys[0];
  if (key !== 'path' && !(allowAt && key === '@path')) return false;
  return typeof value[key] === 'string';
}

/**
 * Returns whether `value` is a valid A2UI function call object
 * (`{'@call': string, args?, catalogId?}` or `{'call': string, ...}`).
 */
export function isFunctionCallValue(value: unknown, protocolVersion?: string): boolean {
  if (!isPlainRecord(value)) return false;
  const isV10 = !protocolVersion || isAtLeastVersion(protocolVersion, '1.0');
  const hasAtCall = isV10 && Object.hasOwn(value, '@call');
  const hasBareCall = Object.hasOwn(value, 'call');
  if (hasAtCall === hasBareCall) return false;
  const callKey = hasAtCall ? '@call' : 'call';
  const callName = value[callKey];
  if (typeof callName !== 'string' || callName.length === 0) return false;
  const allowReturnType = !isV10 || (!protocolVersion && hasBareCall);
  for (const key of Object.keys(value)) {
    if (key === callKey || key === 'args' || key === 'catalogId') continue;
    if (allowReturnType && key === 'returnType') continue;
    return false;
  }
  if (value['catalogId'] !== undefined && typeof value['catalogId'] !== 'string') {
    return false;
  }
  if (value['args'] !== undefined && !isPlainRecord(value['args'])) {
    return false;
  }
  if (value['returnType'] !== undefined && typeof value['returnType'] !== 'string') {
    return false;
  }
  return true;
}

function isDynamicWrapperValue(value: unknown, protocolVersion?: string): boolean {
  return isDataBindingValue(value, protocolVersion) || isFunctionCallValue(value, protocolVersion);
}

function checkStringFormat(value: string, format: string): boolean {
  switch (format) {
    case 'uri':
    case 'url':
      return isValidUri(value);
    case 'date':
      return isValidRfc3339Date(value);
    case 'time':
      return isValidRfc3339Time(value);
    case 'date-time':
      return isValidRfc3339DateTime(value);
    case 'email':
      return isValidEmail(value);
    default:
      // Unknown custom formats are treated as advisory annotations.
      return true;
  }
}

function validateDynamicString(
  value: unknown,
  path: readonly (string | number)[],
  protocolVersion: string | undefined,
  issues: ValidationIssue[],
): void {
  if (typeof value === 'string' || isDynamicWrapperValue(value, protocolVersion)) {
    return;
  }
  issues.push({
    path,
    code: 'invalid_type',
    expected: 'string',
    received: describeValueType(value),
    message: `Expected DynamicString, received ${describeValueType(value)}`,
  });
}

function validateDynamicBoolean(
  value: unknown,
  path: readonly (string | number)[],
  protocolVersion: string | undefined,
  issues: ValidationIssue[],
): void {
  if (typeof value === 'boolean' || isDynamicWrapperValue(value, protocolVersion)) {
    return;
  }
  issues.push({
    path,
    code: 'invalid_type',
    expected: 'boolean',
    received: describeValueType(value),
    message: `Expected DynamicBoolean, received ${describeValueType(value)}`,
  });
}

function validateDynamicValue(
  value: unknown,
  nullable: boolean,
  path: readonly (string | number)[],
  protocolVersion: string | undefined,
  issues: ValidationIssue[],
): void {
  if (nullable) {
    return;
  }
  if (value === null || value === undefined) {
    issues.push({
      path,
      code: 'invalid_type',
      expected: 'DynamicValue',
      received: describeValueType(value),
      message: `Expected non-null DynamicValue, received ${describeValueType(value)}`,
    });
    return;
  }
  if (isPlainRecord(value)) {
    const hasBindingKey =
      '@path' in value || 'path' in value || '@call' in value || 'call' in value;
    if (hasBindingKey && !isDynamicWrapperValue(value, protocolVersion)) {
      issues.push({
        path,
        code: 'custom',
        message: 'Invalid data binding or function call object.',
      });
    }
  }
}

function validateAccessibilityObject(
  value: unknown,
  path: readonly (string | number)[],
  protocolVersion: string | undefined,
  issues: ValidationIssue[],
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    issues.push({
      path,
      code: 'invalid_type',
      expected: 'object',
      received: describeValueType(value),
      message: `Expected object, received ${describeValueType(value)}`,
    });
    return undefined;
  }
  const allowed = new Set(['label', 'description', 'live', 'hidden']);
  const unknownKeys = Object.keys(value).filter(k => !allowed.has(k));
  if (unknownKeys.length > 0) {
    issues.push({
      path,
      code: 'unrecognized_keys',
      keys: unknownKeys,
      message: `Unrecognized key(s) in object: ${unknownKeys.map(k => `'${k}'`).join(', ')}`,
    });
  }
  if (value['label'] !== undefined) {
    validateDynamicString(value['label'], [...path, 'label'], protocolVersion, issues);
  }
  if (value['description'] !== undefined) {
    validateDynamicString(value['description'], [...path, 'description'], protocolVersion, issues);
  }
  if (value['live'] !== undefined) {
    const live = value['live'];
    if (live !== 'off' && live !== 'polite' && live !== 'assertive') {
      issues.push({
        path: [...path, 'live'],
        code: 'invalid_enum_value',
        options: ['off', 'polite', 'assertive'],
        received: describeValueType(live) === 'string' ? String(live) : describeValueType(live),
        message: `Invalid enum value. Expected 'off' | 'polite' | 'assertive', received '${String(live)}'`,
      });
    }
  }
  if (value['hidden'] !== undefined) {
    validateDynamicBoolean(value['hidden'], [...path, 'hidden'], protocolVersion, issues);
  }
  return value;
}

function validateCheckRuleObject(
  value: unknown,
  path: readonly (string | number)[],
  protocolVersion: string | undefined,
  issues: ValidationIssue[],
): void {
  if (!isPlainRecord(value)) {
    issues.push({
      path,
      code: 'invalid_type',
      expected: 'object',
      received: describeValueType(value),
      message: `Expected CheckRule object, received ${describeValueType(value)}`,
    });
    return;
  }
  const isV10 = !protocolVersion || isAtLeastVersion(protocolVersion, '1.0');
  const unknownKeys = Object.keys(value).filter(k => k !== 'condition' && k !== 'message');
  if (unknownKeys.length > 0) {
    issues.push({
      path,
      code: 'unrecognized_keys',
      keys: unknownKeys,
      message: `Unrecognized key(s) in object: ${unknownKeys.map(k => `'${k}'`).join(', ')}`,
    });
  }
  if (!Object.hasOwn(value, 'condition') || value['condition'] === undefined) {
    issues.push({
      path: [...path, 'condition'],
      code: 'invalid_type',
      expected: isV10 ? 'DataBinding | FunctionCall' : 'DynamicBoolean',
      received: 'undefined',
      message: 'Required',
    });
  } else if (isV10) {
    if (!isDynamicWrapperValue(value['condition'], protocolVersion)) {
      issues.push({
        path: [...path, 'condition'],
        code: 'custom',
        message: 'CheckRule condition must be a DataBinding or FunctionCall.',
      });
    }
  } else if (
    typeof value['condition'] !== 'boolean' &&
    !isDynamicWrapperValue(value['condition'], protocolVersion)
  ) {
    issues.push({
      path: [...path, 'condition'],
      code: 'custom',
      message: 'CheckRule condition must be a DynamicBoolean.',
    });
  }
  if (!isV10 && (!Object.hasOwn(value, 'message') || value['message'] === undefined)) {
    issues.push({
      path: [...path, 'message'],
      code: 'invalid_type',
      expected: 'string',
      received: 'undefined',
      message: 'Required',
    });
  } else if (value['message'] !== undefined && typeof value['message'] !== 'string') {
    issues.push({
      path: [...path, 'message'],
      code: 'invalid_type',
      expected: 'string',
      received: describeValueType(value['message']),
      message: `Expected string, received ${describeValueType(value['message'])}`,
    });
  }
}

function validateChildListValue(
  value: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') {
        issues.push({
          path: [...path, i],
          code: 'invalid_type',
          expected: 'string',
          received: describeValueType(value[i]),
          message: `Expected string, received ${describeValueType(value[i])}`,
        });
      }
    }
    return;
  }
  if (isPlainRecord(value)) {
    const unknownKeys = Object.keys(value).filter(k => k !== 'componentId' && k !== 'path');
    if (unknownKeys.length > 0) {
      issues.push({
        path,
        code: 'unrecognized_keys',
        keys: unknownKeys,
        message: `Unrecognized key(s) in object: ${unknownKeys.map(k => `'${k}'`).join(', ')}`,
      });
    }
    if (typeof value['componentId'] !== 'string') {
      issues.push({
        path: [...path, 'componentId'],
        code: 'invalid_type',
        expected: 'string',
        received: describeValueType(value['componentId']),
        message:
          value['componentId'] === undefined
            ? 'Required'
            : `Expected string, received ${describeValueType(value['componentId'])}`,
      });
    }
    if (typeof value['path'] !== 'string') {
      issues.push({
        path: [...path, 'path'],
        code: 'invalid_type',
        expected: 'string',
        received: describeValueType(value['path']),
        message:
          value['path'] === undefined
            ? 'Required'
            : `Expected string, received ${describeValueType(value['path'])}`,
      });
    }
    return;
  }
  issues.push({
    path,
    code: 'invalid_type',
    expected: 'string[] | { componentId, path }',
    received: describeValueType(value),
    message: `Expected ChildList, received ${describeValueType(value)}`,
  });
}

function validateActionValue(
  value: unknown,
  path: readonly (string | number)[],
  protocolVersion: string | undefined,
  issues: ValidationIssue[],
): void {
  if (!isPlainRecord(value)) {
    issues.push({
      path,
      code: 'invalid_type',
      expected: 'object',
      received: describeValueType(value),
      message: `Expected Action object, received ${describeValueType(value)}`,
    });
    return;
  }
  const isV10 = !protocolVersion || isAtLeastVersion(protocolVersion, '1.0');
  const hasEvent = Object.hasOwn(value, 'event') && value['event'] !== undefined;
  const hasFn = Object.hasOwn(value, 'functionCall') && value['functionCall'] !== undefined;
  if (hasEvent && !hasFn) {
    const unknownTop = Object.keys(value).filter(k => k !== 'event');
    if (unknownTop.length > 0) {
      issues.push({
        path,
        code: 'unrecognized_keys',
        keys: unknownTop,
        message: `Unrecognized key(s) in object: ${unknownTop.map(k => `'${k}'`).join(', ')}`,
      });
    }
    const ev = value['event'];
    if (!isPlainRecord(ev)) {
      issues.push({
        path: [...path, 'event'],
        code: 'invalid_type',
        expected: 'object',
        received: describeValueType(ev),
        message: `Expected object, received ${describeValueType(ev)}`,
      });
      return;
    }
    const allowedEv = isV10
      ? new Set(['name', 'userMessage', 'context'])
      : new Set(['name', 'context']);
    const unknownEv = Object.keys(ev).filter(k => !allowedEv.has(k));
    if (unknownEv.length > 0) {
      issues.push({
        path: [...path, 'event'],
        code: 'unrecognized_keys',
        keys: unknownEv,
        message: `Unrecognized key(s) in object: ${unknownEv.map(k => `'${k}'`).join(', ')}`,
      });
    }
    if (typeof ev['name'] !== 'string') {
      issues.push({
        path: [...path, 'event', 'name'],
        code: 'invalid_type',
        expected: 'string',
        received: describeValueType(ev['name']),
        message:
          ev['name'] === undefined
            ? 'Required'
            : `Expected string, received ${describeValueType(ev['name'])}`,
      });
    }
    if (isV10 && ev['userMessage'] !== undefined) {
      validateDynamicString(
        ev['userMessage'],
        [...path, 'event', 'userMessage'],
        protocolVersion,
        issues,
      );
    }
    if (ev['context'] !== undefined) {
      if (!isPlainRecord(ev['context'])) {
        issues.push({
          path: [...path, 'event', 'context'],
          code: 'invalid_type',
          expected: 'object',
          received: describeValueType(ev['context']),
          message: `Expected object, received ${describeValueType(ev['context'])}`,
        });
      } else {
        for (const [k, v] of Object.entries(ev['context'])) {
          validateDynamicValue(v, false, [...path, 'event', 'context', k], protocolVersion, issues);
        }
      }
    }
    return;
  }
  if (hasFn && !hasEvent) {
    const unknownTop = Object.keys(value).filter(k => k !== 'functionCall');
    if (unknownTop.length > 0) {
      issues.push({
        path,
        code: 'unrecognized_keys',
        keys: unknownTop,
        message: `Unrecognized key(s) in object: ${unknownTop.map(k => `'${k}'`).join(', ')}`,
      });
    }
    if (!isFunctionCallValue(value['functionCall'], protocolVersion)) {
      issues.push({
        path: [...path, 'functionCall'],
        code: 'custom',
        message: 'Expected a valid FunctionCall object.',
      });
    }
    return;
  }
  issues.push({
    path,
    code: 'custom',
    message: "Action must specify either 'event' or 'functionCall'.",
  });
}

function validateObjectMembers(
  properties: readonly ParameterDefinition[] | undefined,
  additionalProperties: boolean | TypeDefinition | undefined,
  atLeastOneOf: readonly (readonly string[])[] | undefined,
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  options: ValidateCatalogValueOptions,
  depth: number,
  issues: ValidationIssue[],
): Record<string, unknown> {
  const paramByName = new Map<string, ParameterDefinition>();
  for (const param of properties ?? []) {
    paramByName.set(param.name, param);
  }

  const out: Record<string, unknown> = {...value};
  const extraRule = additionalProperties ?? false;
  const unknownKeys: string[] = [];

  for (const [key, entryVal] of Object.entries(value)) {
    const declared = paramByName.get(key);
    if (declared) {
      if (entryVal === undefined) {
        if (declared.required) {
          issues.push({
            path: [...path, key],
            code: 'invalid_type',
            expected: declared.type,
            received: 'undefined',
            message: 'Required',
          });
        } else if (
          options.applyDefaults &&
          'default' in declared &&
          declared.default !== undefined
        ) {
          out[key] = declared.default;
        }
        continue;
      }
      out[key] = validateNode(
        declared,
        entryVal,
        [...path, key],
        options,
        new Set(),
        depth + 1,
        issues,
      );
    } else if (extraRule === false) {
      unknownKeys.push(key);
    } else if (extraRule !== true) {
      out[key] = validateNode(
        extraRule,
        entryVal,
        [...path, key],
        options,
        new Set(),
        depth + 1,
        issues,
      );
    }
  }

  if (unknownKeys.length > 0) {
    issues.push({
      path,
      code: 'unrecognized_keys',
      keys: unknownKeys,
      message: `Unrecognized key(s) in object: ${unknownKeys.map(k => `'${k}'`).join(', ')}`,
    });
  }

  for (const param of properties ?? []) {
    if (!Object.hasOwn(value, param.name)) {
      if (param.required) {
        issues.push({
          path: [...path, param.name],
          code: 'invalid_type',
          expected: param.type,
          received: 'undefined',
          message: 'Required',
        });
      } else if (options.applyDefaults && 'default' in param && param.default !== undefined) {
        out[param.name] = param.default;
      }
    }
  }

  if (atLeastOneOf) {
    for (const group of atLeastOneOf) {
      const satisfied = group.some(name => Object.hasOwn(out, name) && out[name] !== undefined);
      if (!satisfied) {
        issues.push({
          path,
          code: 'custom',
          message: `At least one of ${group.map(n => `'${n}'`).join(', ')} must be provided.`,
        });
      }
    }
  }

  return out;
}

function validateNode(
  typeDef: TypeDefinition,
  value: unknown,
  path: readonly (string | number)[],
  options: ValidateCatalogValueOptions,
  activeRefsAtValue: Set<string>,
  depth: number,
  issues: ValidationIssue[],
): unknown {
  if (depth > MAX_VALIDATION_DEPTH) {
    issues.push({
      path,
      code: 'custom',
      message: `Maximum validation depth (${MAX_VALIDATION_DEPTH}) exceeded.`,
    });
    return value;
  }

  const protocolVersion = options.protocolVersion;

  if (typeDef.type === 'ref') {
    const target = options.types?.[typeDef.ref];
    if (!target) {
      issues.push({
        path,
        code: 'custom',
        message: `Unresolved catalog type reference '${typeDef.ref}'.`,
      });
      return value;
    }
    if (activeRefsAtValue.has(typeDef.ref)) {
      issues.push({
        path,
        code: 'custom',
        message: `Cyclic catalog type reference '${typeDef.ref}'.`,
      });
      return value;
    }
    activeRefsAtValue.add(typeDef.ref);
    try {
      return validateNode(target, value, path, options, activeRefsAtValue, depth, issues);
    } finally {
      activeRefsAtValue.delete(typeDef.ref);
    }
  }

  if (typeDef.type === 'rawJsonSchema') {
    return value;
  }

  switch (typeDef.type) {
    case 'string': {
      if (typeDef.dynamic && isDynamicWrapperValue(value, protocolVersion)) {
        return value;
      }
      const formats =
        typeDef.format === undefined
          ? []
          : Array.isArray(typeDef.format)
            ? typeDef.format
            : [typeDef.format];
      const opaqueSpecs: OpaqueTypeSpec[] = [];
      const stringFormats: string[] = [];
      if (options.opaqueTypes && options.opaqueTypes.size > 0 && formats.length > 0) {
        for (const fmt of formats) {
          const spec = options.opaqueTypes.get(fmt);
          if (spec) {
            opaqueSpecs.push(spec);
          } else {
            stringFormats.push(fmt);
          }
        }
      } else {
        stringFormats.push(...formats);
      }

      if (opaqueSpecs.length > 0) {
        if (opaqueSpecs.some(spec => spec.isInstance(value))) {
          return value;
        }
        if (stringFormats.length === 0) {
          const expectedNames = opaqueSpecs.map(s => s.name).join(' | ');
          issues.push({
            path,
            code: 'invalid_type',
            expected: `opaque(${expectedNames})`,
            received: describeValueType(value),
            message: `Expected branded opaque value (${expectedNames}), received ${describeValueType(value)}`,
          });
          return value;
        }
      }

      if (typeof value !== 'string') {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'string',
          received: describeValueType(value),
          message: `Expected string, received ${describeValueType(value)}`,
        });
        return value;
      }
      if (typeDef.minLength !== undefined || typeDef.maxLength !== undefined) {
        const codePointLen = [...value].length;
        if (typeDef.minLength !== undefined && codePointLen < typeDef.minLength) {
          issues.push({
            path,
            code: 'too_small',
            message: `String must contain at least ${typeDef.minLength} character(s)`,
          });
        }
        if (typeDef.maxLength !== undefined && codePointLen > typeDef.maxLength) {
          issues.push({
            path,
            code: 'too_big',
            message: `String must contain at most ${typeDef.maxLength} character(s)`,
          });
        }
      }
      if (typeDef.pattern !== undefined) {
        let re: RegExp;
        try {
          re = new RegExp(typeDef.pattern, 'u');
        } catch {
          issues.push({
            path,
            code: 'custom',
            message: `Invalid regular expression pattern '${typeDef.pattern}'`,
          });
          return value;
        }
        if (!re.test(value)) {
          issues.push({
            path,
            code: 'invalid_string',
            message: `String does not match pattern '${typeDef.pattern}'`,
          });
        }
      }
      if (stringFormats.length > 0) {
        if (!stringFormats.some(fmt => checkStringFormat(value, fmt))) {
          issues.push({
            path,
            code: 'invalid_string',
            message: `Invalid string format; expected ${stringFormats.join(' | ')}`,
          });
        }
      }
      return value;
    }
    case 'number':
    case 'integer': {
      if (typeDef.dynamic && isDynamicWrapperValue(value, protocolVersion)) {
        return value;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({
          path,
          code: 'invalid_type',
          expected: typeDef.type,
          received: describeValueType(value),
          message: `Expected ${typeDef.type}, received ${describeValueType(value)}`,
        });
        return value;
      }
      if (typeDef.type === 'integer' && !Number.isInteger(value)) {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'integer',
          received: 'float',
          message: 'Expected integer, received float',
        });
      }
      if (typeDef.min !== undefined && value < typeDef.min) {
        issues.push({
          path,
          code: 'too_small',
          message: `Number must be greater than or equal to ${typeDef.min}`,
        });
      }
      if (typeDef.max !== undefined && value > typeDef.max) {
        issues.push({
          path,
          code: 'too_big',
          message: `Number must be less than or equal to ${typeDef.max}`,
        });
      }
      return value;
    }
    case 'boolean': {
      if (typeDef.dynamic) {
        if (options.coerceDynamicBoolean && !isDynamicWrapperValue(value, protocolVersion)) {
          return coerceModelDynamicBoolean(value);
        }
        if (isDynamicWrapperValue(value, protocolVersion)) {
          return value;
        }
      }
      if (typeof value !== 'boolean') {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'boolean',
          received: describeValueType(value),
          message: `Expected boolean, received ${describeValueType(value)}`,
        });
      }
      return value;
    }
    case 'enum': {
      if (typeDef.dynamic && isDynamicWrapperValue(value, protocolVersion)) {
        return value;
      }
      if (!typeDef.values.includes(value as string | number | boolean)) {
        issues.push({
          path,
          code: 'invalid_enum_value',
          options: typeDef.values,
          received:
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : describeValueType(value),
          message: `Invalid enum value. Expected ${typeDef.values.map(String).join(' | ')}, received '${String(value)}'`,
        });
      }
      return value;
    }
    case 'const': {
      if (!Object.is(value, typeDef.value)) {
        issues.push({
          path,
          code: 'invalid_literal',
          expected: JSON.stringify(typeDef.value),
          received: describeValueType(value),
          message: `Expected ${JSON.stringify(typeDef.value)}, received ${JSON.stringify(value)}`,
        });
      }
      return value;
    }
    case 'any': {
      if (typeDef.dynamic === true) {
        validateDynamicValue(value, typeDef.nullable !== false, path, protocolVersion, issues);
      } else if (typeDef.nullable === false && (value === null || value === undefined)) {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'non-null value',
          received: describeValueType(value),
          message: `Expected non-null value, received ${describeValueType(value)}`,
        });
      }
      return value;
    }
    case 'object': {
      if (typeDef.dynamic && isDynamicWrapperValue(value, protocolVersion)) {
        return value;
      }
      if (!isPlainRecord(value)) {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'object',
          received: describeValueType(value),
          message: `Expected object, received ${describeValueType(value)}`,
        });
        return value;
      }
      return validateObjectMembers(
        typeDef.properties,
        typeDef.additionalProperties,
        typeDef.atLeastOneOf,
        value,
        path,
        options,
        depth,
        issues,
      );
    }
    case 'array': {
      if (typeDef.dynamic && isDynamicWrapperValue(value, protocolVersion)) {
        return value;
      }
      if (!Array.isArray(value)) {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'array',
          received: describeValueType(value),
          message: `Expected array, received ${describeValueType(value)}`,
        });
        return value;
      }
      if (typeDef.minItems !== undefined && value.length < typeDef.minItems) {
        issues.push({
          path,
          code: 'too_small',
          message: `Array must contain at least ${typeDef.minItems} element(s)`,
        });
      }
      if (typeDef.maxItems !== undefined && value.length > typeDef.maxItems) {
        issues.push({
          path,
          code: 'too_big',
          message: `Array must contain at most ${typeDef.maxItems} element(s)`,
        });
      }
      const outItems = typeDef.items
        ? value.map((item, i) =>
            validateNode(typeDef.items!, item, [...path, i], options, new Set(), depth + 1, issues),
          )
        : value;
      if (typeDef.uniqueItems) {
        for (let i = 0; i < outItems.length; i++) {
          for (let j = i + 1; j < outItems.length; j++) {
            if (jsonValueEquals(outItems[i], outItems[j])) {
              issues.push({
                path: [...path, j],
                code: 'custom',
                message: 'Array items must be unique.',
              });
              break;
            }
          }
        }
      }
      return outItems;
    }
    case 'union': {
      if (typeDef.dynamic && isDynamicWrapperValue(value, protocolVersion)) {
        return value;
      }
      const exclusive = typeDef.exclusive !== false;
      const matched: unknown[] = [];
      const branchErrors: Array<{readonly issues: readonly ValidationIssue[]}> = [];
      for (const variant of typeDef.variants) {
        const subIssues: ValidationIssue[] = [];
        const result = validateNode(
          variant,
          value,
          path,
          options,
          new Set(activeRefsAtValue),
          depth,
          subIssues,
        );
        if (subIssues.length === 0) {
          matched.push(result);
          if (!exclusive) {
            return result;
          }
        } else {
          branchErrors.push({issues: subIssues});
        }
      }
      if (matched.length === 1) {
        return matched[0];
      }
      if (exclusive && matched.length > 1) {
        issues.push({
          path,
          code: 'custom',
          message: `Value matched ${matched.length} variants of an exclusive union; expected exactly 1.`,
        });
        return value;
      }
      issues.push({
        path,
        code: 'invalid_union',
        unionErrors: branchErrors,
        message: 'Value did not match any union variant.',
      });
      return value;
    }
    case 'dataBinding': {
      if (!isDataBindingValue(value, protocolVersion)) {
        issues.push({
          path,
          code: 'custom',
          message: 'Expected a DataBinding object.',
        });
      }
      return value;
    }
    case 'functionCall': {
      if (!isFunctionCallValue(value, protocolVersion)) {
        issues.push({
          path,
          code: 'custom',
          message: 'Expected a FunctionCall object.',
        });
      }
      return value;
    }
    case 'child': {
      if (typeof value !== 'string') {
        issues.push({
          path,
          code: 'invalid_type',
          expected: 'string',
          received: describeValueType(value),
          message: `Expected string child component ID, received ${describeValueType(value)}`,
        });
      }
      return value;
    }
    case 'childList': {
      validateChildListValue(value, path, issues);
      return value;
    }
    case 'action': {
      validateActionValue(value, path, protocolVersion, issues);
      return value;
    }
    case 'checkRule': {
      validateCheckRuleObject(value, path, protocolVersion, issues);
      return value;
    }
    case 'accessibility': {
      validateAccessibilityObject(value, path, protocolVersion, issues);
      return value;
    }
  }
}

/**
 * Validates an arbitrary runtime value against a canonical {@link TypeDefinition}.
 */
export function validateCatalogValue(
  typeDef: TypeDefinition,
  value: unknown,
  options: ValidateCatalogValueOptions = {},
): ValidationOutcome {
  const issues: ValidationIssue[] = [];
  const data = validateNode(typeDef, value, [], options, new Set(), 0, issues);
  return issues.length === 0 ? {success: true, data} : {success: false, issues};
}

/**
 * Validates a component's property map against its canonical {@link ComponentDefinition}.
 */
export function validateComponentProperties(
  def: ComponentDefinition,
  properties: unknown,
  options: ValidateCatalogValueOptions = {},
): ValidationOutcome<Record<string, unknown>> {
  if (!isPlainRecord(properties)) {
    return {
      success: false,
      issues: [
        {
          path: [],
          code: 'invalid_type',
          expected: 'object',
          received: describeValueType(properties),
          message: `Expected object, received ${describeValueType(properties)}`,
        },
      ],
    };
  }
  const issues: ValidationIssue[] = [];
  const params: ParameterDefinition[] = [...(def.parameters ?? [])];
  if (def.checkable) {
    const declaredNames = new Set(params.map(p => p.name));
    const checkListParam = (name: string): ParameterDefinition => ({
      name,
      type: 'array',
      items: {type: 'checkRule'},
    });
    if (!declaredNames.has('@checks') && Object.hasOwn(properties, '@checks')) {
      params.push(checkListParam('@checks'));
    }
    if (!declaredNames.has('checks') && Object.hasOwn(properties, 'checks')) {
      params.push(checkListParam('checks'));
    }
  }
  const data = validateObjectMembers(
    params,
    false,
    def.atLeastOneOf,
    properties,
    [],
    options,
    0,
    issues,
  );
  return issues.length === 0 ? {success: true, data} : {success: false, issues};
}

/**
 * Validates a function call's arguments object against its canonical {@link FunctionDefinition}.
 */
export function validateFunctionArguments(
  def: FunctionDefinition,
  args: unknown,
  options: ValidateCatalogValueOptions = {},
): ValidationOutcome<Record<string, unknown>> {
  if (!isPlainRecord(args)) {
    return {
      success: false,
      issues: [
        {
          path: [],
          code: 'invalid_type',
          expected: 'object',
          received: describeValueType(args),
          message: `Expected object, received ${describeValueType(args)}`,
        },
      ],
    };
  }
  const issues: ValidationIssue[] = [];
  const data = validateObjectMembers(
    def.parameters,
    def.additionalParameters ?? false,
    def.atLeastOneOf,
    args,
    [],
    {applyDefaults: true, ...options},
    0,
    issues,
  );
  return issues.length === 0 ? {success: true, data} : {success: false, issues};
}

/**
 * Validates surface-level properties (e.g. v0.9 `theme`) against a
 * canonical {@link SurfacePropertiesDefinition}.
 */
export function validateSurfaceProperties(
  def: SurfacePropertiesDefinition,
  value: unknown,
  options: ValidateCatalogValueOptions = {},
): ValidationOutcome<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    return {
      success: false,
      issues: [
        {
          path: [],
          code: 'invalid_type',
          expected: 'object',
          received: describeValueType(value),
          message: `Expected object, received ${describeValueType(value)}`,
        },
      ],
    };
  }
  const issues: ValidationIssue[] = [];
  const data = validateObjectMembers(
    def.properties,
    def.additionalProperties ?? false,
    undefined,
    value,
    [],
    {applyDefaults: true, ...options},
    0,
    issues,
  );
  return issues.length === 0 ? {success: true, data} : {success: false, issues};
}

function coerceNodeDynamicBooleans(
  typeDef: TypeDefinition,
  value: unknown,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  activeRefs: Set<string>,
  depth: number,
): unknown {
  if (depth > MAX_VALIDATION_DEPTH) return value;
  if (typeDef.type === 'ref') {
    const target = types?.[typeDef.ref];
    if (!target || activeRefs.has(typeDef.ref)) return value;
    activeRefs.add(typeDef.ref);
    try {
      return coerceNodeDynamicBooleans(target, value, types, activeRefs, depth);
    } finally {
      activeRefs.delete(typeDef.ref);
    }
  }
  if (typeDef.type === 'boolean' && typeDef.dynamic) {
    return coerceModelDynamicBoolean(value);
  }
  if (typeDef.type === 'array' && Array.isArray(value) && typeDef.items) {
    let changed = false;
    const mapped = value.map(item => {
      const coerced = coerceNodeDynamicBooleans(typeDef.items!, item, types, new Set(), depth + 1);
      if (coerced !== item) changed = true;
      return coerced;
    });
    return changed ? mapped : value;
  }
  if (typeDef.type === 'object' && isPlainRecord(value)) {
    const hasProps = (typeDef.properties?.length ?? 0) > 0;
    const extraType =
      typeDef.additionalProperties && typeof typeDef.additionalProperties === 'object'
        ? typeDef.additionalProperties
        : undefined;
    if (!hasProps && !extraType) return value;
    const byName = new Map((typeDef.properties ?? []).map(p => [p.name, p]));
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const prop = byName.get(k) ?? extraType;
      const coerced = prop ? coerceNodeDynamicBooleans(prop, v, types, new Set(), depth + 1) : v;
      if (coerced !== v) changed = true;
      out[k] = coerced;
    }
    return changed ? out : value;
  }
  if (typeDef.type === 'union') {
    // If value already matches a variant without coercion, keep it untouched unless
    // a dynamic-boolean variant matches after coercion on a non-matching value.
    for (const variant of typeDef.variants) {
      if (validateCatalogValue(variant, value, {types}).success) {
        return value;
      }
    }
    for (const variant of typeDef.variants) {
      const coerced = coerceNodeDynamicBooleans(variant, value, types, new Set(activeRefs), depth);
      if (coerced !== value && validateCatalogValue(variant, coerced, {types}).success) {
        return coerced;
      }
    }
  }
  return value;
}

/**
 * Coerces every `boolean` + `dynamic: true` position in a function's resolved
 * arguments (including arrays of dynamic booleans such as `and`/`or`).
 */
export function coerceModelDynamicBooleans(
  def: FunctionDefinition,
  args: unknown,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): unknown {
  if (!isPlainRecord(args)) {
    return args;
  }
  const hasParams = (def.parameters?.length ?? 0) > 0;
  const extraType =
    def.additionalParameters && typeof def.additionalParameters === 'object'
      ? def.additionalParameters
      : undefined;
  if (!hasParams && !extraType) {
    return args;
  }
  const byName = new Map((def.parameters ?? []).map(p => [p.name, p]));
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    const param = byName.get(key) ?? extraType;
    const coerced = param ? coerceNodeDynamicBooleans(param, val, types, new Set(), 0) : val;
    if (coerced !== val) changed = true;
    out[key] = coerced;
  }
  return changed ? out : args;
}
