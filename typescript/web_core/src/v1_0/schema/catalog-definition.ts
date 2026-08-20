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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/v1_0/json/ via scripts/generate-zod-schemas.mjs
import {z} from 'zod';
import {ExtensionsSchema} from './common-types.js';

export const FunctionCallValidationSchemaSchema = z.record(z.string(), z.any()).and(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "type": z.literal("object"), "description": z.string().optional(), "properties": z.object({ "call": z.object({ "const": z.string() }), "catalogId": z.record(z.string(), z.any()).describe("Optional catalog ID override for this function call.").optional(), "args": z.record(z.string(), z.any()).describe("A JSON Schema describing the expected arguments (args) for this function.").optional() }).strict(), "required": z.array(z.string()), "unevaluatedProperties": z.boolean().optional(), "additionalProperties": z.boolean().optional() }), z.object({ "type": z.literal("object"), "description": z.string().optional(), "allOf": z.array(z.record(z.string(), z.any())).min(1), "unevaluatedProperties": z.boolean().optional(), "additionalProperties": z.boolean().optional() })];
    const { errors, failed } = schemas.reduce<{
      errors: z.ZodIssue[];
      failed: number;
    }>(
      ({ errors, failed }, schema) =>
        ((result) =>
          result.error
            ? {
                errors: [...errors, ...result.error.issues],
                failed: failed + 1,
              }
            : { errors, failed })(
          schema.safeParse(x),
        ),
      { errors: [], failed: 0 },
    );
    const passed = schemas.length - failed;
    if (passed !== 1) {
      ctx.addIssue(errors.length ? {
        path: [],
        code: "invalid_union",
        errors: [errors],
        message: "Invalid input: Should pass single schema. Passed " + passed,
      } : {
        path: [],
        code: "custom",
        errors: [errors],
        message: "Invalid input: Should pass single schema. Passed " + passed,
      } as any);
    }
  })).describe("JSON Schema structure that validates a wire-level FunctionCall object.")
export type FunctionCallValidationSchema = z.infer<typeof FunctionCallValidationSchemaSchema>

export type FunctionCallValidationSchemaInput = z.input<typeof FunctionCallValidationSchemaSchema>;

export const FunctionDefinitionSchema = z.record(z.string(), z.any()).and(z.intersection(FunctionCallValidationSchemaSchema, z.intersection(z.object({ "returnType": z.enum(["string","number","boolean","array","object","validationResult","any","void"]).describe("The type of value this function returns."), "allowedCallers": z.enum(["rendererOnly","agentOnly","rendererOrAgent"]).describe("Specifies which roles are authorized to invoke this function.").default("rendererOnly"), "requiresUserActivation": z.boolean().describe("Specifies whether this function requires a user activation context to execute.").default(false) }), z.any()))).superRefine((val, ctx) => {
        if (val && val.requiresUserActivation && val.allowedCallers !== 'rendererOnly') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "requiresUserActivation=true must have allowedCallers='rendererOnly'.",
            path: ['allowedCallers'],
          });
        }
      }).describe("Describes a function's validation schema and interface metadata.")
export type FunctionDefinition = z.infer<typeof FunctionDefinitionSchema>

export type FunctionDefinitionInput = z.input<typeof FunctionDefinitionSchema>;

export const ComponentDefinitionSchema = z.record(z.string(), z.any()).and(z.intersection(z.any(), z.object({ "allowedParents": z.array(z.string()).refine((arr) => arr.every((item, i) => arr.indexOf(item) === i), "All items must be unique!").describe("The list of parent component type names that can contain this component type. If omitted, all parent component types are allowed. To restrict a component so it can appear only as the top-level component (id='root') of a surface, set \"allowedParents\": [\"Surface\"]. To allow a component as either the top-level component of a surface or a child of a specific container, specify both (e.g., \"allowedParents\": [\"Surface\", \"CanvasContainer\"]).").optional(), "allowedChildren": z.array(z.string()).refine((arr) => arr.every((item, i) => arr.indexOf(item) === i), "All items must be unique!").describe("The list of child component type names allowed inside this container or slot. If omitted, all child component types are allowed.").optional(), "metadata": z.object({ "extensions": ExtensionsSchema.optional() }).strict().describe("Optional static metadata.").optional() }))).describe("Describes a component's validation schema and composition constraints.")
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>

export type ComponentDefinitionInput = z.input<typeof ComponentDefinitionSchema>;

export const ValidationResultSchema = z.object({ "valid": z.boolean().describe("Whether the check passed."), "code": z.string().describe("Machine-readable error code (e.g. EXPIRED_CARD, OUT_OF_RANGE).").optional(), "message": z.string().describe("Human-readable error or warning message.").optional(), "severity": z.enum(["error","warning","info"]).describe("Severity level of the validation result.").default("error") }).describe("Dynamic validation result object returned by a validation condition function or data binding.")
export type ValidationResult = z.infer<typeof ValidationResultSchema>

export type ValidationResultInput = z.input<typeof ValidationResultSchema>;

