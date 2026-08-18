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
import {CallIdSchema, ExtensionsSchema, FunctionCallSchema, FunctionResponseSchema} from './common-types.js';

export const ActionMessageSchema = z.object({ "version": z.literal("v1.0"), "action": z.object({ "name": z.string().describe("The name of the action, taken from the component's action.event.name property."), "userMessage": z.string().describe("An optional human-readable string describing the action performed by the user, taken from the component's action.event.userMessage property after resolving bindings.").optional(), "surfaceId": z.string().describe("The id of the surface where the event originated. It must be globally unique for the renderer's lifetime."), "sourceComponentId": z.string().describe("The id of the component that triggered the event."), "timestamp": z.string().datetime({ offset: true }).describe("An ISO 8601 timestamp of when the event occurred."), "context": z.record(z.string(), z.any()).describe("A JSON object containing the key-value pairs from the component's action.event.context, after resolving all data bindings."), "metadata": z.object({ "extensions": ExtensionsSchema.optional() }).strict().describe("Optional renderer-side metadata to send back to the agent with the action.").optional() }).describe("Reports a user-initiated action from a component.") }).strict()
export type ActionMessage = z.infer<typeof ActionMessageSchema>


export const CallAgentFunctionMessageSchema = z.object({ "version": z.literal("v1.0"), "callAgentFunction": z.object({ "surfaceId": z.string().describe("The surface ID where the call originated."), "functionCallId": CallIdSchema, "callFunction": FunctionCallSchema }).strict().describe("Signals the agent to execute a function remotely on behalf of the renderer.") }).strict()
export type CallAgentFunctionMessage = z.infer<typeof CallAgentFunctionMessageSchema>


export const RendererFunctionResponseMessageSchema = z.object({ "version": z.literal("v1.0"), "rendererFunctionResponse": FunctionResponseSchema }).strict()
export type RendererFunctionResponseMessage = z.infer<typeof RendererFunctionResponseMessageSchema>


export const ErrorMessageSchema = z.object({ "version": z.literal("v1.0"), "error": z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "code": z.enum(["VALIDATION_FAILED","UNALLOWED_PARENT","UNALLOWED_CHILD"]), "surfaceId": z.string().describe("The id of the surface where the error occurred. It must be globally unique for the renderer's lifetime."), "path": z.string().describe("The JSON pointer to the field that failed validation (e.g. '/components/0/text')."), "message": z.string().describe("A short one or two sentence description of why validation failed.") }).strict(), z.object({ "code": z.any().refine((value) => !z.enum(["VALIDATION_FAILED","UNALLOWED_PARENT","UNALLOWED_CHILD"]).safeParse(value).success, "Invalid input: Should NOT be valid against schema"), "message": z.string().describe("A short one or two sentence description of why the error occurred."), "surfaceId": z.string().describe("The id of the surface where the error occurred. It must be globally unique for the renderer's lifetime.").optional(), "functionCallId": CallIdSchema.optional() }).catchall(z.any()).and(z.any().superRefine((x, ctx) => {
    const schemas = [z.any().refine((value) => !z.any().safeParse(value).success, "Invalid input: Should NOT be valid against schema"), z.any().refine((value) => !z.any().safeParse(value).success, "Invalid input: Should NOT be valid against schema")];
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
  }))];
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
  }).describe("Reports a renderer-side error.") }).strict()
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>


/** Union schema validating any outgoing v1.0 renderer-to-agent message envelope. */
export const RendererToAgentMessageSchema = z.union([
  ActionMessageSchema,
  CallAgentFunctionMessageSchema,
  RendererFunctionResponseMessageSchema,
  ErrorMessageSchema,
]);
export type RendererToAgentMessage = z.infer<typeof RendererToAgentMessageSchema>;
