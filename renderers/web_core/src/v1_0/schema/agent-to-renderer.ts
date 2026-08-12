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
  AnyComponentSchema,
  CallIdSchema,
  ExtensionsSchema,
  FunctionCallSchema,
  FunctionResponseSchema,
} from './common-types.js';

/** Schema for creating a new surface in v1.0. */
export const CreateSurfaceMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    createSurface: z
      .object({
        surfaceId: z.string().describe('The unique identifier for the UI surface to be rendered.'),
        catalogId: z
          .string()
          .optional()
          .describe('Default catalog ID for components and functions in this surface.'),
        sendDataModel: z
          .boolean()
          .optional()
          .describe('Whether the renderer sends full data model in A2A metadata.'),
        components: z
          .array(AnyComponentSchema)
          .min(1)
          .optional()
          .describe('Initial component definitions for the surface.'),
        dataModel: z
          .record(z.any())
          .optional()
          .describe('Initial root data model object for the surface.'),
        metadata: z
          .object({
            extensions: ExtensionsSchema.optional(),
          })
          .strict()
          .optional()
          .describe('Optional surface-level metadata.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent to create a new surface container.');

/** Create surface message type. */
export type CreateSurfaceMessage = z.infer<typeof CreateSurfaceMessageSchema>;

/** Schema for updating components on an existing surface in v1.0. */
export const UpdateComponentsMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    updateComponents: z
      .object({
        surfaceId: z.string().describe('The unique identifier for the UI surface to be updated.'),
        components: z
          .array(AnyComponentSchema)
          .min(1)
          .describe('List of UI components to add or update in the surface.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent to update component definitions on a surface.');

/** Update components message type. */
export type UpdateComponentsMessage = z.infer<typeof UpdateComponentsMessageSchema>;

/** Schema for updating the data model on a surface in v1.0. */
export const UpdateDataModelMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    updateDataModel: z
      .object({
        surfaceId: z
          .string()
          .describe('The unique identifier for the UI surface data model update.'),
        path: z
          .string()
          .optional()
          .describe('Optional path within data model. Omitted or "/" targets root.'),
        value: z.any().describe('The data value to set at the specified path.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent to update data model values on a surface.');

/** Update data model message type. */
export type UpdateDataModelMessage = z.infer<typeof UpdateDataModelMessageSchema>;

/** Schema for deleting a surface in v1.0. */
export const DeleteSurfaceMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    deleteSurface: z
      .object({
        surfaceId: z.string().describe('The unique identifier for the UI surface to be deleted.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent to delete a surface container.');

/** Delete surface message type. */
export type DeleteSurfaceMessage = z.infer<typeof DeleteSurfaceMessageSchema>;

/** Schema for invoking a function on the renderer in v1.0. */
export const CallRendererFunctionMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    callRendererFunction: z
      .object({
        functionCallId: CallIdSchema.describe('Unique identifier for this function call instance.'),
        callFunction: FunctionCallSchema.extend({
          catalogId: z.string().describe('Catalog ID defining the function.'),
        }).describe('Function call parameters and name.'),
      })
      .strict(),
  })
  .strict()
  .describe('Message sent to execute a function locally on the renderer.');

/** Call renderer function message type. */
export type CallRendererFunctionMessage = z.infer<typeof CallRendererFunctionMessageSchema>;

/** Schema for returning response from an agent-executed function in v1.0. */
export const AgentFunctionResponseMessageSchema = z
  .object({
    version: z.literal('v1.0'),
    agentFunctionResponse: FunctionResponseSchema.describe('Function call response payload.'),
  })
  .strict()
  .describe('Message returning the result of an agent function call.');

/** Agent function response message type. */
export type AgentFunctionResponseMessage = z.infer<typeof AgentFunctionResponseMessageSchema>;

/** Union schema for all v1.0 Agent-to-Renderer messages. */
export const AgentToRendererMessageSchema = z
  .union([
    CreateSurfaceMessageSchema,
    UpdateComponentsMessageSchema,
    UpdateDataModelMessageSchema,
    DeleteSurfaceMessageSchema,
    CallRendererFunctionMessageSchema,
    AgentFunctionResponseMessageSchema,
  ])
  .describe('Union of all v1.0 messages sent from an agent to a renderer.');

/** Agent to renderer message union type for v1.0. */
export type AgentToRendererMessage = z.infer<typeof AgentToRendererMessageSchema>;

/** Schema for a list of v1.0 agent-to-renderer messages. */
export const AgentToRendererMessageListSchema = z
  .array(AgentToRendererMessageSchema)
  .describe('Array of v1.0 agent-to-renderer messages.');

/** List of agent to renderer messages type. */
export type AgentToRendererMessageList = z.infer<typeof AgentToRendererMessageListSchema>;

/** Schema wrapping a list of v1.0 agent-to-renderer messages. */
export const AgentToRendererMessageListWrapperSchema = z
  .object({
    messages: AgentToRendererMessageListSchema,
  })
  .strict()
  .describe('Object wrapper for a list of v1.0 agent-to-renderer messages.');

/** Wrapper for list of agent to renderer messages type. */
export type AgentToRendererMessageListWrapper = z.infer<
  typeof AgentToRendererMessageListWrapperSchema
>;
