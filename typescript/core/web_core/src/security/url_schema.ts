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

import {z} from 'zod';
import {DynamicStringSchema} from '../v1_0/schema/common-types.js';
import type {UrlContext, UrlContextAnnotation} from './url_security_policy.js';

/** The catalog JSON Schema keyword that marks a property as a URL. */
export const URL_CONTEXT_KEYWORD = 'x-a2ui-url-context';

/** How a Zod schema carries its URL context in `_def`. */
interface UrlContextDef {
  a2uiUrlContext?: UrlContextAnnotation;
  /** `false` keeps the context out of the catalog document. */
  a2uiUrlContextInDocument?: boolean;
}

/**
 * Whether a value is a URL context annotation (`media`, `navigation`,
 * `iframe`, or `none`).
 *
 * @param value The value to check.
 */
export function isUrlContextAnnotation(value: unknown): value is UrlContextAnnotation {
  return value === 'media' || value === 'navigation' || value === 'iframe' || value === 'none';
}

/**
 * Stamps a URL context on a schema. Methods such as `.describe()` and
 * `.optional()` rebuild schemas from `_def`, so the context survives them.
 *
 * Package-internal.
 *
 * @param schema The schema to mark, which is changed in place.
 * @param context The URL context.
 * @param options `inDocument: false` keeps the context out of the catalog
 *   document, for catalogs whose published document has no annotation.
 * @returns `schema`.
 */
export function markUrlContext<T extends z.ZodTypeAny>(
  schema: T,
  context: UrlContextAnnotation,
  options: {inDocument?: boolean} = {},
): T {
  const def = schema._def as UrlContextDef;
  def.a2uiUrlContext = context;
  if (options.inDocument === false) def.a2uiUrlContextInDocument = false;
  return schema;
}

function unwrapOnce(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = schema?._def as {typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny};
  switch (def?.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodReadonly':
      return def.innerType;
    case 'ZodEffects':
      return def.schema;
    default:
      return undefined;
  }
}

/**
 * Returns the URL context stamped on a schema or on one of the wrappers
 * (`optional`, `default`, and so on) around it.
 *
 * Package-internal.
 *
 * @param schema The schema to inspect.
 * @param forDocument Whether the caller writes a catalog document, in which
 *   case contexts kept out of the document are ignored.
 */
export function urlContextOf(
  schema: z.ZodTypeAny,
  forDocument = false,
): UrlContextAnnotation | undefined {
  for (let current: z.ZodTypeAny | undefined = schema; current; current = unwrapOnce(current)) {
    const def = current._def as UrlContextDef | undefined;
    if (def?.a2uiUrlContext !== undefined) {
      return forDocument && def.a2uiUrlContextInDocument === false ? undefined : def.a2uiUrlContext;
    }
  }
  return undefined;
}

/**
 * Keeps the `REF:` pointer of a schema's description when `.describe()` is
 * called with plain prose, so the catalog document still writes a `$ref`.
 */
function keepRefOnDescribe<T extends z.ZodTypeAny>(schema: T): T {
  const ref = /^REF:([^|]*)/.exec(schema.description ?? '')?.[1];
  if (ref === undefined) return schema;
  const rawDescribe = schema.describe;
  (schema as {describe: (description: string) => z.ZodTypeAny}).describe = description =>
    keepRefOnDescribe(
      rawDescribe.call(
        schema,
        description.startsWith('REF:') ? description : `REF:${ref}|${description}`,
      ),
    );
  return schema;
}

function urlSchema<T extends z.ZodTypeAny>(context: UrlContext, base: T, description?: string): T {
  const copy = base.describe(
    description === undefined
      ? (base.description as string)
      : base.description?.startsWith('REF:')
        ? `REF:${/^REF:([^|]*)/.exec(base.description)![1]}|${description}`
        : description,
  ) as T;
  return keepRefOnDescribe(markUrlContext(copy, context));
}

/**
 * A property holding a URL the renderer loads automatically, such as an
 * image or video source. The resolver checks every value it resolves for the
 * property against the surface's URL security policy, so the component
 * receives only allowed (or rewritten) URLs, or `undefined` when blocked.
 *
 * The catalog document writes the property as its base type plus
 * `"x-a2ui-url-context": "media"`.
 *
 * @example
 * ```ts
 * const ProductCardApi = {
 *   name: 'ProductCard',
 *   schema: z.object({
 *     title: DynamicStringSchema,
 *     imageUrl: mediaUrl('Product photo.'),
 *     productPageUrl: navigationUrl('Opened when the card is tapped.'),
 *   }),
 * } satisfies ComponentApi;
 * ```
 *
 * @param description Optional description of the property.
 * @param base The schema of the property's values. Defaults to the v1.0
 *   `DynamicStringSchema`; pass another protocol version's `DynamicStringSchema`
 *   for a catalog of that version.
 */
export function mediaUrl<T extends z.ZodTypeAny = typeof DynamicStringSchema>(
  description?: string,
  base?: T,
): T {
  return urlSchema('media', base ?? (DynamicStringSchema as unknown as T), description);
}

/**
 * A property holding a URL the renderer opens when the user acts, such as a
 * link target. See {@link mediaUrl} for how the property is checked.
 *
 * @param description Optional description of the property.
 * @param base The schema of the property's values. Defaults to the v1.0
 *   `DynamicStringSchema`.
 */
export function navigationUrl<T extends z.ZodTypeAny = typeof DynamicStringSchema>(
  description?: string,
  base?: T,
): T {
  return urlSchema('navigation', base ?? (DynamicStringSchema as unknown as T), description);
}

/**
 * A property holding a URL the renderer embeds in a frame. See
 * {@link mediaUrl} for how the property is checked.
 *
 * @param description Optional description of the property.
 * @param base The schema of the property's values. Defaults to the v1.0
 *   `DynamicStringSchema`.
 */
export function iframeUrl<T extends z.ZodTypeAny = typeof DynamicStringSchema>(
  description?: string,
  base?: T,
): T {
  return urlSchema('iframe', base ?? (DynamicStringSchema as unknown as T), description);
}
