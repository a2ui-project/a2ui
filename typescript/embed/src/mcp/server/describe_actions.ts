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

import {
  getSchemaDescription,
  isSchemaOptional,
  objectFromShape,
  safeParse,
  type AnySchema,
  type ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {toJsonSchemaCompat} from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

/** Metadata of a registered action or follow-up route summarized by {@link describeActionRoutes}. */
export type DescribedActionRoute =
  | {
      kind: 'action';
      description?: string;
      argsSchema: ZodRawShapeCompat;
    }
  | {
      kind: 'followUp';
      description?: string;
      template: string;
      argsSchema: ZodRawShapeCompat;
    };

const MAX_SCHEMA_DEPTH = 4;

/**
 * Formats registered `action` and `followUp` routes into a deterministic Markdown contract for
 * model instructions. Returns `''` when `routes` is empty.
 */
export function describeActionRoutes(routes: ReadonlyMap<string, DescribedActionRoute>): string {
  if (routes.size === 0) {
    return '';
  }

  const lines = [
    'Registered server actions:',
    'Bind interactive component events ONLY to the registered event names listed below. Never invent unregistered event names such as `"click"`.',
    '',
  ];

  for (const [name, route] of routes) {
    const kindLabel = route.kind === 'action' ? 'in-place action' : 'follow-up';
    const summary = routeSummary(route);
    lines.push(`- ${codeSpan(name)} (${kindLabel})${summary ? `: ${summary}` : ''}`);

    const entries = Object.entries(route.argsSchema);
    if (entries.length === 0) {
      lines.push('  - `context`: `{}` (no parameters)');
      continue;
    }

    lines.push('  - `context`:');
    const extracted = extractShapeSchemas(route.argsSchema);
    for (const [paramName, fieldSchema] of entries) {
      const fieldInfo = extracted.get(paramName);
      const propSchema = fieldInfo?.propSchema;
      const typeText = propSchema ? formatJsonSchemaType(propSchema, 0) : 'unknown';
      const optional = isFieldOptional(fieldSchema, fieldInfo?.inRequiredSet, propSchema);
      const hasDefault =
        propSchema !== undefined &&
        Object.hasOwn(propSchema, 'default') &&
        propSchema['default'] !== undefined;
      const requirementText = hasDefault
        ? `optional, default ${codeSpan(formatLiteral(propSchema['default']))}`
        : optional
          ? 'optional'
          : 'required';
      const description = fieldDescription(fieldSchema, propSchema);
      lines.push(
        `    - ${codeSpan(paramName)} (${codeSpan(typeText)}, ${requirementText})${description ? `: ${description}` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

interface ExtractedFieldInfo {
  propSchema?: Record<string, unknown>;
  inRequiredSet?: boolean;
}

function extractShapeSchemas(shape: ZodRawShapeCompat): Map<string, ExtractedFieldInfo> {
  const result = new Map<string, ExtractedFieldInfo>();
  const wholeJson = tryConvertShape(shape);
  if (wholeJson !== undefined) {
    const properties = isRecord(wholeJson['properties']) ? wholeJson['properties'] : {};
    const required = new Set(
      Array.isArray(wholeJson['required'])
        ? wholeJson['required'].filter((key): key is string => typeof key === 'string')
        : [],
    );
    for (const key of Object.keys(shape)) {
      const prop = properties[key];
      result.set(key, {
        propSchema: isRecord(prop) ? prop : undefined,
        inRequiredSet: required.has(key),
      });
    }
    return result;
  }

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const singleJson = tryConvertShape({[key]: fieldSchema});
    if (singleJson !== undefined) {
      const properties = isRecord(singleJson['properties']) ? singleJson['properties'] : {};
      const required =
        Array.isArray(singleJson['required']) && singleJson['required'].includes(key);
      const prop = properties[key];
      result.set(key, {
        propSchema: isRecord(prop) ? prop : undefined,
        inRequiredSet: required,
      });
    } else {
      result.set(key, {});
    }
  }
  return result;
}

function tryConvertShape(shape: ZodRawShapeCompat): Record<string, unknown> | undefined {
  try {
    const converted = toJsonSchemaCompat(objectFromShape(shape));
    return isRecord(converted) ? converted : undefined;
  } catch {
    return undefined;
  }
}

function isFieldOptional(
  fieldSchema: AnySchema,
  inRequiredSet: boolean | undefined,
  propSchema: Record<string, unknown> | undefined,
): boolean {
  if (!isRecord(fieldSchema) || (!('_def' in fieldSchema) && !('_zod' in fieldSchema))) {
    return false;
  }
  if (
    propSchema !== undefined &&
    Object.hasOwn(propSchema, 'default') &&
    propSchema['default'] !== undefined
  ) {
    return true;
  }
  try {
    return safeParse(fieldSchema, undefined).success;
  } catch {
    // Async refinements throw on synchronous safeParse; fall back to metadata below.
  }
  if (inRequiredSet !== undefined) {
    return !inRequiredSet;
  }
  try {
    return isSchemaOptional(fieldSchema);
  } catch {
    return false;
  }
}

function fieldDescription(
  fieldSchema: AnySchema,
  propSchema: Record<string, unknown> | undefined,
): string {
  const fromJson =
    typeof propSchema?.['description'] === 'string' ? propSchema['description'] : undefined;
  if (fromJson !== undefined) {
    return normalizeInlineText(fromJson);
  }
  try {
    const fromZod = getSchemaDescription(fieldSchema);
    return typeof fromZod === 'string' ? normalizeInlineText(fromZod) : '';
  } catch {
    return '';
  }
}

function routeSummary(route: DescribedActionRoute): string {
  if (route.description !== undefined) {
    const trimmed = normalizeInlineText(route.description);
    if (trimmed !== '') {
      return trimmed;
    }
  }
  if (route.kind === 'followUp') {
    return `Posts ${codeSpan(JSON.stringify(normalizeInlineText(route.template)))}.`;
  }
  return '';
}

function formatJsonSchemaType(schema: Record<string, unknown>, depth: number): string {
  if (depth >= MAX_SCHEMA_DEPTH) {
    return 'unknown';
  }
  if (Object.hasOwn(schema, 'const')) {
    return formatLiteral(schema['const']);
  }
  if (Array.isArray(schema['enum'])) {
    return schema['enum'].length === 0 ? 'never' : uniqueJoin(schema['enum'].map(formatLiteral));
  }
  const unionMembers = Array.isArray(schema['anyOf'])
    ? schema['anyOf']
    : Array.isArray(schema['oneOf'])
      ? schema['oneOf']
      : undefined;
  if (unionMembers !== undefined) {
    const formatted = unionMembers.map(member =>
      isRecord(member) ? formatJsonSchemaType(member, depth + 1) : 'unknown',
    );
    return formatted.length === 0 ? 'unknown' : uniqueJoin(formatted);
  }

  const rawType = schema['type'];
  if (Array.isArray(rawType)) {
    const formatted = rawType.map(item =>
      typeof item === 'string' ? formatSingleType(item, schema, depth) : 'unknown',
    );
    return formatted.length === 0 ? 'unknown' : uniqueJoin(formatted);
  }
  if (typeof rawType === 'string') {
    return formatSingleType(rawType, schema, depth);
  }
  if (isRecord(schema['properties']) || isRecord(schema['additionalProperties'])) {
    return formatObjectType(schema, depth);
  }
  return 'unknown';
}

function formatSingleType(
  typeName: string,
  schema: Record<string, unknown>,
  depth: number,
): string {
  switch (typeName) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      return typeName;
    case 'array':
      return formatArrayType(schema, depth);
    case 'object':
      return formatObjectType(schema, depth);
    default:
      return typeName;
  }
}

function formatArrayType(schema: Record<string, unknown>, depth: number): string {
  const tupleItems = Array.isArray(schema['prefixItems'])
    ? schema['prefixItems']
    : Array.isArray(schema['items'])
      ? schema['items']
      : undefined;
  if (tupleItems !== undefined) {
    const parts = tupleItems.map(item =>
      isRecord(item) ? formatJsonSchemaType(item, depth + 1) : 'unknown',
    );
    return `[${parts.join(', ')}]`;
  }
  if (isRecord(schema['items'])) {
    const inner = formatJsonSchemaType(schema['items'], depth + 1);
    return inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`;
  }
  return 'unknown[]';
}

function formatObjectType(schema: Record<string, unknown>, depth: number): string {
  const properties = isRecord(schema['properties']) ? schema['properties'] : undefined;
  if (properties !== undefined) {
    const entries = Object.entries(properties);
    if (entries.length > 0) {
      const required = new Set(
        Array.isArray(schema['required'])
          ? schema['required'].filter((key): key is string => typeof key === 'string')
          : [],
      );
      const fields = entries.map(([key, prop]) => {
        const propType = isRecord(prop) ? formatJsonSchemaType(prop, depth + 1) : 'unknown';
        const hasDefault = isRecord(prop) && Object.hasOwn(prop, 'default');
        const optionalMark = required.has(key) && !hasDefault ? '' : '?';
        return `${formatPropertyKey(key)}${optionalMark}: ${propType}`;
      });
      return `{${fields.join('; ')}}`;
    }
  }
  if (isRecord(schema['additionalProperties'])) {
    const valueType = formatJsonSchemaType(schema['additionalProperties'], depth + 1);
    return `Record<string, ${valueType}>`;
  }
  return 'Record<string, unknown>';
}

function formatPropertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatLiteral(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function uniqueJoin(items: readonly string[]): string {
  return [...new Set(items)].join(' | ');
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function codeSpan(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Array.isArray(value) ? false : typeof value === 'object' && value !== null;
}
