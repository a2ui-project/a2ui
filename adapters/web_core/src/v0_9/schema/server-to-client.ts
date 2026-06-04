/*
 * Copyright 2025 Google LLC
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
import {AnyComponentSchema} from './common-types.js';

export const CreateSurfaceMessageSchema = z
  .object({
    version: z.literal('v0.9'),
    createSurface: z
      .object({
        surfaceId: z.string().describe('The unique identifier for the UI surface to be rendered.'),
        catalogId: z.string().describe('A string that uniquely identifies this catalog.'),
        theme: z.any().optional().describe('Theme parameters for the surface.'),
        sendDataModel: z
          .boolean()
          .optional()
          .describe('If true, the client will send the full data model.'),
      })
      .strict(),
  })
  .strict();

export const UpdateComponentsMessageSchema = z
  .object({
    version: z.literal('v0.9'),
    updateComponents: z
      .object({
        surfaceId: z.string().describe('The unique identifier for the UI surface to be updated.'),
        components: z
          .array(AnyComponentSchema)
          .min(1)
          .describe('A list containing all UI components for the surface.'),
      })
      .strict(),
  })
  .strict();

export const UpdateDataModelMessageSchema = z
  .object({
    version: z.literal('v0.9'),
    updateDataModel: z
      .object({
        surfaceId: z
          .string()
          .describe('The unique identifier for the UI surface this data model update applies to.'),
        path: z
          .string()
          .optional()
          .describe('An optional path to a location within the data model.'),
        value: z.any().optional().describe('The data to be updated in the data model.'),
      })
      .strict(),
  })
  .strict();

export const DeleteSurfaceMessageSchema = z
  .object({
    version: z.literal('v0.9'),
    deleteSurface: z
      .object({
        surfaceId: z.string().describe('The unique identifier for the UI surface to be deleted.'),
      })
      .strict(),
  })
  .strict();

export declare interface CreateSurfaceMessage extends z.infer<typeof CreateSurfaceMessageSchema> {
  version: 'v0.9';
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: any;
    sendDataModel?: boolean;
  };
}
export declare interface UpdateComponentsMessage extends z.infer<
  typeof UpdateComponentsMessageSchema
> {
  version: 'v0.9';
  updateComponents: {
    surfaceId: string;
    components: any[];
  };
}
export declare interface UpdateDataModelMessage extends z.infer<
  typeof UpdateDataModelMessageSchema
> {
  version: 'v0.9';
  updateDataModel: {
    surfaceId: string;
    path?: string;
    value?: any;
  };
}
export declare interface DeleteSurfaceMessage extends z.infer<typeof DeleteSurfaceMessageSchema> {
  version: 'v0.9';
  deleteSurface: {
    surfaceId: string;
  };
}

export const A2uiMessageSchema = z.union([
  CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema,
]);

/** A message sent from the A2UI server to the client. */
export type A2uiMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

export const A2uiMessageListSchema = z.array(A2uiMessageSchema).describe('A list of messages.');

export type A2uiMessageList = z.infer<typeof A2uiMessageListSchema>;

export const A2uiMessageListWrapperSchema = z
  .object({
    messages: A2uiMessageListSchema,
  })
  .strict()
  .describe('An object wrapping a list of messages.');

export type A2uiMessageListWrapper = z.infer<typeof A2uiMessageListWrapperSchema>;
