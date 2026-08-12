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
import {
  CallIdSchema,
  ExtensionsSchema,
  FunctionCallSchema,
  FunctionResponseSchema,
} from './common-types.js';

/** Schema reporting a user action from a component in v1.0. */
export const RendererActionMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    action: z
      .object({
        name: z.string().describe('The name of the action dispatched.'),
        userMessage: z.string().optional().describe('Human-readable description of user action.'),
        surfaceId: z.string().describe('ID of the surface originating the event.'),
        sourceComponentId: z.string().describe('ID of component that triggered event.'),
        timestamp: z.string().describe('ISO 8601 timestamp when event occurred.'),
        context: z.record(z.any()).describe('Context key-value pairs after binding resolution.'),
        metadata: z
          .object({
            extensions: ExtensionsSchema.optional(),
          })
          .strict()
          .optional()
          .describe('Optional client-side metadata.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent from renderer to agent reporting a user action.');

/** Renderer action message type. */
export type RendererActionMessage = z.infer<typeof RendererActionMessageSchema>;

/** Schema for requesting remote function execution on the agent in v1.0. */
export const CallAgentFunctionMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    callAgentFunction: z
      .object({
        surfaceId: z.string().describe('Surface ID where call originated.'),
        functionCallId: CallIdSchema.describe('Unique function call instance identifier.'),
        callFunction: FunctionCallSchema.describe('Function call details.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent from renderer to agent requesting remote function execution.');

/** Call agent function message type. */
export type CallAgentFunctionMessage = z.infer<typeof CallAgentFunctionMessageSchema>;

/** Schema for returning response from a renderer-executed function in v1.0. */
export const RendererFunctionResponseMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    rendererFunctionResponse: FunctionResponseSchema.describe('Function call response payload.'),
  })
  .strict()
  .describe('Message returning result of a renderer function call.');

/** Renderer function response message type. */
export type RendererFunctionResponseMessage = z.infer<typeof RendererFunctionResponseMessageSchema>;

/** Schema reporting renderer validation errors in v1.0. */
export const RendererValidationErrorSchema = z
  .object({
    code: z.enum(['VALIDATION_FAILED', 'UNALLOWED_PARENT', 'UNALLOWED_CHILD']),
    surfaceId: z.string().describe('Surface ID where validation error occurred.'),
    path: z.string().describe('JSON pointer path to field failing validation.'),
    message: z.string().describe('Description of validation failure.'),
  })
  .strict()
  .describe('Renderer validation error payload.');

/** Renderer validation error type. */
export type RendererValidationError = z.infer<typeof RendererValidationErrorSchema>;

/** Schema reporting generic renderer errors in v1.0. */
export const RendererGenericErrorSchema = z
  .object({
    code: z.string().describe('Error code.'),
    message: z.string().describe('Error description.'),
    surfaceId: z.string().optional().describe('Surface ID if error is surface-scoped.'),
    functionCallId: CallIdSchema.optional().describe(
      'Function call ID if error is function-scoped.',
    ),
  })
  .passthrough()
  .describe('Generic renderer error payload.');

/** Generic renderer error type. */
export type RendererGenericError = z.infer<typeof RendererGenericErrorSchema>;

/** Schema for renderer-to-agent error messages. */
export const RendererErrorMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    error: z.union([RendererValidationErrorSchema, RendererGenericErrorSchema]),
  })
  .strict()
  .describe('Message sent from renderer reporting an error.');

/** Renderer error message type. */
export type RendererErrorMessage = z.infer<typeof RendererErrorMessageSchema>;

/** Union schema for all v1.0 Renderer-to-Agent messages. */
export const RendererToAgentMessageSchema = z
  .union([
    RendererActionMessageSchema,
    CallAgentFunctionMessageSchema,
    RendererFunctionResponseMessageSchema,
    RendererErrorMessageSchema,
  ])
  .describe('Union of all v1.0 messages sent from a renderer to an agent.');

/** Renderer to agent message union type for v1.0. */
export type RendererToAgentMessage = z.infer<typeof RendererToAgentMessageSchema>;

/** Schema for a list of v1.0 renderer-to-agent messages. */
export const RendererToAgentMessageListSchema = z
  .array(RendererToAgentMessageSchema)
  .describe('Array of v1.0 renderer-to-agent messages.');

/** List of renderer to agent messages type. */
export type RendererToAgentMessageList = z.infer<typeof RendererToAgentMessageListSchema>;

/** Schema wrapping a list of v1.0 renderer-to-agent messages. */
export const RendererToAgentMessageListWrapperSchema = z
  .object({
    messages: RendererToAgentMessageListSchema,
  })
  .strict()
  .describe('Object wrapper for a list of v1.0 renderer-to-agent messages.');

/** Wrapper for list of renderer to agent messages type. */
export type RendererToAgentMessageListWrapper = z.infer<
  typeof RendererToAgentMessageListWrapperSchema
>;
