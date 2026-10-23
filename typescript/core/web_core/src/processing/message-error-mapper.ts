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

import {z} from 'zod';
import {isAtLeastVersion} from '../common/semver.js';
import {
  A2uiCatalogError,
  A2uiDataError,
  A2uiError,
  A2uiExpressionError,
  A2uiIntegrityError,
  A2uiRecursionError,
  A2uiRpcError,
  A2uiStateError,
  A2uiValidationError,
} from '../errors.js';

/** Outbound error body for validation or composition constraint failures. */
export interface ValidationFailedErrorBody {
  readonly code: 'VALIDATION_FAILED' | 'UNALLOWED_PARENT' | 'UNALLOWED_CHILD';
  readonly surfaceId: string;
  readonly path: string;
  readonly message: string;
  readonly functionCallId?: undefined;
}

/** Outbound error body for generic, integrity, catalog, or RPC failures. */
export interface GenericErrorBody {
  readonly code: string;
  readonly message: string;
  readonly surfaceId?: string;
  readonly path?: string;
  readonly functionCallId?: string;
  readonly [key: string]: unknown;
}

/** Union of spec-compliant outbound renderer error bodies. */
export type A2uiRendererError = ValidationFailedErrorBody | GenericErrorBody;

/** Outbound renderer-to-agent error message envelope. */
export interface ErrorMessage {
  readonly version: 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0';
  readonly error: A2uiRendererError;
}

/** Known top-level action envelope keys across A2UI protocol versions. */
const ACTION_ENVELOPE_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callRendererFunction',
  'agentFunctionResponse',
  'beginRendering',
  'surfaceUpdate',
  'dataModelUpdate',
] as const;

/**
 * Envelope metadata extracted from a raw A2UI message prior to or during
 * validation, used to correlate outbound renderer error payloads.
 */
export interface ErrorEnvelopeContext {
  /** Target surface ID extracted from the message envelope, if present. */
  readonly surfaceId?: string;
  /** Target functionCallId extracted from a `callRendererFunction` envelope, if present. */
  readonly functionCallId?: string;
  /** Top-level action key (e.g. `'createSurface'`, `'callRendererFunction'`). */
  readonly actionType?: string;
  /** Whether the message envelope is a `callRendererFunction` message. */
  readonly isCallRendererFunction?: boolean;
  /** Protocol version string extracted from the message or processor fallback. */
  readonly version?: string;
}

/** Backwards-compatible alias for `ErrorEnvelopeContext`. */
export type EnvelopeErrorContext = ErrorEnvelopeContext;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts best-effort correlation metadata (`surfaceId`, `functionCallId`,
 * `actionType`, `version`) from a raw message envelope before schema parsing.
 *
 * @param rawMessage Raw unvalidated message object.
 * @param fallbackVersion Optional fallback protocol version string.
 * @returns Extracted envelope error correlation context.
 */
export function extractEnvelopeErrorContext(
  rawMessage: unknown,
  fallbackVersion?: string,
): ErrorEnvelopeContext {
  if (!isPlainRecord(rawMessage)) {
    return {version: fallbackVersion};
  }

  const version =
    typeof rawMessage['version'] === 'string' ? rawMessage['version'] : fallbackVersion;
  const actionType = ACTION_ENVELOPE_KEYS.find(key => key in rawMessage);
  if (!actionType) {
    return {version};
  }

  const isCallRendererFunction = actionType === 'callRendererFunction';
  const payload = rawMessage[actionType];
  if (!isPlainRecord(payload)) {
    return {actionType, isCallRendererFunction, version};
  }

  const surfaceId = typeof payload['surfaceId'] === 'string' ? payload['surfaceId'] : undefined;
  const functionCallId =
    typeof payload['functionCallId'] === 'string' ? payload['functionCallId'] : undefined;
  return {
    surfaceId,
    functionCallId,
    actionType,
    isCallRendererFunction,
    version,
  };
}

function stripActionPrefix(segments: string[]): string[] {
  if (segments.length > 0 && (ACTION_ENVELOPE_KEYS as readonly string[]).includes(segments[0])) {
    return segments.slice(1);
  }
  return segments;
}

/**
 * Normalizes a raw path string into an RFC 6901 JSON Pointer (`"/components/0/text"`),
 * stripping any leading action envelope prefix.
 *
 * @param rawPath Raw path or JSON Pointer string.
 * @returns Normalized RFC 6901 JSON Pointer, or `undefined` if empty.
 */
export function normalizeJsonPointer(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  const converted = rawPath
    .replace(/\[(\d+)\]/g, '/$1')
    .replace(/\./g, '/')
    .replace(/^\/+/, '');
  if (!converted) return '/';
  const segments = stripActionPrefix(converted.split('/').filter(Boolean));
  return segments.length > 0 ? `/${segments.join('/')}` : undefined;
}

function collectLeafZodIssues(issues: readonly z.ZodIssue[], actionType?: string): z.ZodIssue[] {
  const leaves: z.ZodIssue[] = [];
  for (const issue of issues) {
    if (issue.code === z.ZodIssueCode.invalid_union && 'unionErrors' in issue) {
      const unionIssues = issue.unionErrors.flatMap(u => u.issues);
      leaves.push(...collectLeafZodIssues(unionIssues, actionType));
    } else {
      leaves.push(issue);
    }
  }
  if (!actionType) return leaves;
  const matching = leaves.filter(i => i.path[0] === actionType && i.path.length > 1);
  return matching.length > 0 ? matching : leaves;
}

function extractPathFromZodDetails(details: unknown, actionType?: string): string | undefined {
  let issues: readonly z.ZodIssue[] | undefined;
  if (details instanceof z.ZodError) {
    issues = details.issues;
  } else if (Array.isArray(details) && details.length > 0) {
    const first = details[0] as Record<string, unknown>;
    if (typeof first?.['path'] === 'string') {
      return normalizeJsonPointer(first['path']);
    }
    if (Array.isArray(first?.['path'])) {
      issues = details as z.ZodIssue[];
    }
  }
  if (!issues || issues.length === 0) return undefined;

  const selected = collectLeafZodIssues(issues, actionType)[0];
  if (!selected) return undefined;
  const segments = selected.path.map(String);
  if (
    selected.code === z.ZodIssueCode.unrecognized_keys &&
    'keys' in selected &&
    Array.isArray(selected.keys) &&
    selected.keys.length > 0
  ) {
    segments.push(String(selected.keys[0]));
  }
  const stripped = stripActionPrefix(segments);
  return stripped.length > 0 ? `/${stripped.join('/')}` : undefined;
}

function normalizeOutputVersion(version: string | undefined): 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0' {
  if (version === 'v0.8' || version === '0.8') return 'v0.8';
  if (version === 'v0.9.1' || version === '0.9.1') return 'v0.9.1';
  if (version && isAtLeastVersion(version, '1.0')) return 'v1.0';
  return 'v0.9';
}

function resolveErrorCode(err: unknown, isV1: boolean): string {
  if (err instanceof A2uiRecursionError) return 'RECURSION_LIMIT_EXCEEDED';
  if (err instanceof A2uiIntegrityError || err instanceof A2uiStateError) {
    return 'INTEGRITY_ERROR';
  }
  if (err instanceof A2uiCatalogError) return 'CATALOG_NOT_FOUND';
  if (err instanceof A2uiDataError) return 'DATA_ERROR';
  if (err instanceof A2uiExpressionError) return 'EXPRESSION_ERROR';
  if (err instanceof A2uiValidationError) {
    if (err.code === 'UNALLOWED_PARENT' || err.code === 'UNALLOWED_CHILD') {
      return isV1 ? err.code : 'VALIDATION_FAILED';
    }
    return 'VALIDATION_FAILED';
  }
  if (err instanceof A2uiError) return err.code || 'INTERNAL_ERROR';
  return 'INTERNAL_ERROR';
}

/**
 * Maps an internal `A2uiError` (or unknown thrown error) and envelope context
 * into a spec-compliant outbound renderer `ErrorMessage`.
 *
 * @param err Thrown error instance.
 * @param context Extracted envelope correlation context.
 * @returns Spec-compliant outbound `ErrorMessage`.
 */
export function mapErrorToRendererMessage(
  err: unknown,
  context: EnvelopeErrorContext = {},
): ErrorMessage {
  const version = normalizeOutputVersion(context.version);
  const isV1 = version === 'v1.0';
  const a2uiErr = err instanceof A2uiError ? err : undefined;
  const message = err instanceof Error ? err.message : String(err);

  const functionCallId = a2uiErr?.functionCallId ?? context.functionCallId;
  if (
    context.isCallRendererFunction ||
    context.actionType === 'callRendererFunction' ||
    err instanceof A2uiRpcError ||
    functionCallId !== undefined
  ) {
    const rpcCode = err instanceof A2uiRpcError ? err.code : 'INVALID_FUNCTION_CALL';
    return {
      version,
      error: {
        code: rpcCode,
        ...(functionCallId !== undefined ? {functionCallId} : {}),
        message,
      },
    };
  }

  const code = resolveErrorCode(err, isV1);
  const surfaceId = a2uiErr?.surfaceId ?? context.surfaceId ?? '';
  const rawPath =
    a2uiErr?.path ??
    (err instanceof A2uiValidationError
      ? extractPathFromZodDetails(err.details, context.actionType)
      : undefined);
  const path = normalizeJsonPointer(rawPath);

  return {
    version,
    error: {
      code,
      surfaceId,
      ...(path !== undefined ? {path} : {}),
      message,
    },
  };
}
