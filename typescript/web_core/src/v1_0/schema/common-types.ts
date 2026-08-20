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

export const ComponentIdSchema = z.string().describe("The unique identifier for a component, used for both definitions and references within the same surface.")
export type ComponentId = z.infer<typeof ComponentIdSchema>


export const CallIdSchema = z.string().describe("The unique identifier for a function call.")
export type CallId = z.infer<typeof CallIdSchema>


export const DataBindingSchema = z.object({ "path": z.string().describe("A JSON Pointer path to a value in the data model.") }).strict()
export type DataBinding = z.infer<typeof DataBindingSchema>


export const DynamicValueSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.string(), z.number(), z.boolean(), z.array(z.any()), z.record(z.string(), z.any()).refine((obj) => !obj || (!('path' in obj) && !('call' in obj))), DataBindingSchema, z.lazy(() => FunctionCallSchema)];
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
  }).describe("A value that can be a literal, a path, or a function call returning any type.")
export type DynamicValue = z.infer<typeof DynamicValueSchema>


export const DynamicNumberSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.number(), DataBindingSchema, FunctionCallSchema];
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
  }).describe("Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.")
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>


export const IndexSystemFunctionSchema = z.object({ "call": z.literal("@index"), "args": z.object({ "offset": DynamicNumberSchema.optional() }).optional() }).describe("Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context.")
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>


export const FunctionCallSchema = z.object({ "call": z.string().describe("The name of the function to call."), "catalogId": z.string().describe("The catalog ID for this function, overriding any surface-level default catalogId.").optional(), "args": z.record(z.string(), z.union([DynamicValueSchema, z.record(z.string(), z.any()).describe("A literal object argument (e.g. configuration).")])).describe("Arguments passed to the function.").optional() }).and(z.any().superRefine((x, ctx) => {
    const schemas = [FunctionCallSchema, IndexSystemFunctionSchema];
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
  })).describe("Invokes a named function.")
export type FunctionCall = z.infer<typeof FunctionCallSchema>


export const DynamicStringSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.string(), DataBindingSchema, FunctionCallSchema];
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
  }).describe("Represents a string")
export type DynamicString = z.infer<typeof DynamicStringSchema>


export const DynamicBooleanSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.boolean(), DataBindingSchema, FunctionCallSchema];
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
  }).describe("A boolean value that can be a literal, a path, or a function call returning a boolean.")
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>


export const AccessibilityAttributesSchema = z.object({ "label": DynamicStringSchema.optional(), "description": DynamicStringSchema.optional(), "live": z.enum(["off","polite","assertive"]).describe("Controls screen reader announcements for dynamic updates (WAI-ARIA aria-live). 'polite' waits for user pause; 'assertive' interrupts immediately for alerts.").default("off"), "hidden": DynamicBooleanSchema.optional() }).strict().describe("Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding.")
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>


export const ExtensionsSchema = z.record(z.string(), z.union([z.any(), z.never()])).superRefine((value, ctx) => {
for (const key in value) {
let evaluated = false
if (key.match(new RegExp("^[\\p{XID_Start}_][\\p{XID_Continue}]*$"))) {
evaluated = true
const result = z.any().safeParse(value[key])
if (!result.success) {
ctx.addIssue({
          path: [key],
          code: 'custom',
          message: `Invalid input: Key matching regex /${key}/ must match schema`,
          params: {
            issues: result.error.issues
          }
        })
}
}
if (!evaluated) {
const result = z.never().safeParse(value[key])
if (!result.success) {
ctx.addIssue({
          path: [key],
          code: 'custom',
          message: `Invalid input: must match catchall schema`,
          params: {
            issues: result.error.issues
          }
        })
}
}
}
}).describe("Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.")
export type Extensions = z.infer<typeof ExtensionsSchema>


export const ComponentCommonSchema = z.object({ "id": ComponentIdSchema, "catalogId": z.string().describe("The catalog ID for this component, overriding any surface-level default catalogId.").optional(), "accessibility": AccessibilityAttributesSchema.optional(), "metadata": z.object({ "extensions": ExtensionsSchema.optional() }).strict().describe("Optional component-level metadata for vendor extensions.").optional() })
export type ComponentCommon = z.infer<typeof ComponentCommonSchema>


export const ChildSchema = ComponentIdSchema
export type Child = z.infer<typeof ChildSchema>


export const ChildListSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.array(ComponentIdSchema).describe("A static list of child component IDs."), z.object({ "componentId": ComponentIdSchema, "path": z.string().describe("The path to the list of component property objects in the data model.") }).strict().describe("A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.")];
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
  })
export type ChildList = z.infer<typeof ChildListSchema>


export const DynamicStringListSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.array(z.string()), DataBindingSchema, FunctionCallSchema];
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
  }).describe("Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.")
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>


export const FunctionCommonSchema = z.object({ "catalogId": z.string().describe("The catalog ID for this function, overriding any surface-level default catalogId.").optional() })
export type FunctionCommon = z.infer<typeof FunctionCommonSchema>


export const CheckRuleSchema = z.object({ "condition": z.any().superRefine((x, ctx) => {
    const schemas = [DataBindingSchema, FunctionCallSchema];
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
  }).describe("Path or function call evaluating to a structured validation result object."), "message": z.string().describe("Optional fallback error message.").optional() }).strict().describe("A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object.")
export type CheckRule = z.infer<typeof CheckRuleSchema>


export const CheckableSchema = z.object({ "checks": z.array(CheckRuleSchema).describe("A list of checks to perform. These are function calls that must return a boolean indicating validity.").optional() }).describe("Properties for components that support renderer-side checks.")
export type Checkable = z.infer<typeof CheckableSchema>


export const ActionSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "event": z.object({ "name": z.string().describe("The name of the action to be dispatched to the agent."), "userMessage": DynamicStringSchema.optional(), "context": z.record(z.string(), DynamicValueSchema).describe("A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.").optional() }).strict().describe("The event to dispatch to the agent.") }).strict().describe("Triggers an agent-side event."), z.object({ "functionCall": FunctionCallSchema }).strict().describe("Executes a renderer or agent-side function.")];
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
  }).describe("Defines an interaction handler that can either trigger an agent-side event or execute a local renderer-side function.")
export type Action = z.infer<typeof ActionSchema>


export const SurfaceSchema = z.object({ "component": z.literal("Surface").optional(), "child": z.literal("root").optional() }).strict().describe("The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'.")
export type Surface = z.infer<typeof SurfaceSchema>


export const FunctionResponseSchema = z.object({ "functionCallId": CallIdSchema, "value": z.any().describe("The return value of the function.").optional(), "error": z.object({ "code": z.string(), "message": z.string() }).strict().describe("An error object indicating failure of the function execution.").optional() }).strict().and(z.any().superRefine((x, ctx) => {
    const schemas = [z.any(), z.any()];
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
  })).describe("The return response matching a callAgentFunction or callRendererFunction invocation.")
export type FunctionResponse = z.infer<typeof FunctionResponseSchema>


