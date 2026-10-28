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

/**
 * A JSON Schema object, as written in a catalog document.
 */
export type JsonSchemaObject = Readonly<Record<string, unknown>>;

/**
 * A mixin that a component's definition composes with `allOf`: the name of a
 * common type (`'ComponentCommon'`, `'Checkable'`), referenced in the
 * catalog's common types document, or a model named with {@link specDef},
 * which the catalog document declares under `$defs`.
 */
export type SpecMixin = string | z.ZodTypeAny;

/**
 * What a catalog document writes about a Zod schema that the schema itself
 * does not express. `Catalog.toJson` reads it when it computes the document
 * of a catalog defined in code; it never changes validation.
 */
export interface SpecAnnotation {
  /**
   * Schemas that follow the schema's own in an `allOf`, such as an
   * `if`/`then` format rule.
   */
  readonly allOf?: readonly JsonSchemaObject[];
  /**
   * Keywords the document writes beside the ones derived from the schema,
   * such as `format`, or an object's `anyOf` of `required` lists.
   */
  readonly keywords?: JsonSchemaObject;
  /**
   * The keyword that closes an object schema. By default a strict object is
   * closed with `additionalProperties`, and any other object is left open.
   * The value is `true` for a passthrough object and `false` otherwise.
   */
  readonly closure?: 'additionalProperties' | 'unevaluatedProperties' | 'none';
  /**
   * The order of an object's `required` list, when it is not the order of
   * the object's properties.
   */
  readonly required?: readonly string[];
  /**
   * The mixins a component's definition composes with `allOf`, in order.
   * Set on a component's schema, it marks the component as one whose
   * definition `Catalog.toJson` computes in the layout of the catalog's
   * protocol version; the schema's own properties are those no mixin
   * declares.
   */
  readonly mixins?: readonly SpecMixin[];
  /** The name under which a catalog document declares the model in `$defs`. */
  readonly defName?: string;
  /** The canonical model declared in `$defs` by {@link specDef}. */
  readonly defModel?: z.ZodTypeAny;
}

const annotations = new WeakMap<object, SpecAnnotation>();

function cloneWithDefAnnotation<T extends z.ZodTypeAny>(
  schema: T,
  nextAnnotation: SpecAnnotation,
  description: string | undefined = schema.description,
): T {
  const copy = z.ZodType.prototype.describe.call(schema, description as string) as T;
  annotations.set(copy, nextAnnotation);
  copy.describe = (nextDescription: string) =>
    cloneWithDefAnnotation(copy, annotations.get(copy) ?? nextAnnotation, nextDescription);
  return copy;
}

/**
 * Returns a copy of a Zod schema that carries what a catalog document writes
 * about it beyond the schema itself.
 *
 * The copy validates exactly as `schema` does and has its type, so it can be
 * used wherever `schema` is. Annotating a copy keeps a shared schema, such as
 * a common type, free of the annotations of one of its uses.
 *
 * @param schema The schema to annotate.
 * @param annotation What the document writes about it.
 * @returns An annotated copy of `schema`.
 */
export function spec<T extends z.ZodTypeAny>(schema: T, annotation: SpecAnnotation): T {
  const copy = z.ZodType.prototype.describe.call(schema, schema.description as string) as T;
  annotations.set(copy, {...annotations.get(schema), ...annotation});
  return copy;
}

/**
 * Returns a copy of a Zod model that a catalog document declares under
 * `$defs` as `name`, such as the `CatalogComponentCommon` mixin of the v0.9
 * basic catalog or its `theme`.
 *
 * @param name The definition's name.
 * @param schema The definition's model.
 * @param annotation Anything else the document writes about the model.
 * @returns An annotated copy of `schema`.
 */
export function specDef<T extends z.ZodTypeAny>(
  name: string,
  schema: T,
  annotation: Omit<SpecAnnotation, 'defName' | 'defModel' | 'mixins'> = {},
): T {
  const copy = cloneWithDefAnnotation(schema, {
    ...annotations.get(schema),
    ...annotation,
    defName: name,
  });
  annotations.set(copy, {
    ...annotations.get(copy),
    defName: name,
    defModel: copy,
  });
  return copy;
}

/**
 * Returns the annotation of a Zod schema itself, if any.
 *
 * @param schema A Zod schema.
 */
export function getSpecAnnotation(schema: unknown): SpecAnnotation | undefined {
  return typeof schema === 'object' && schema !== null ? annotations.get(schema) : undefined;
}
