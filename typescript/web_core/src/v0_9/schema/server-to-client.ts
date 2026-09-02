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
// Generated from specification/v0_9/json/ via scripts/generate-zod-schemas.mjs
import {z} from 'zod';

export const CreateSurfaceMessageSchema = z
  .object({
    'version': z.enum(['v0.9', 'v0.9.1']),
    'createSurface': z
      .object({
        'surfaceId': z
          .string()
          .describe('The unique identifier for the UI surface to be rendered.'),
        'catalogId': z
          .string()
          .describe(
            "A string that uniquely identifies this catalog. It is recommended to prefix this with an internet domain that you own, to avoid conflicts e.g. mycompany.com:somecatalog'.",
          ),
        'theme': z.any().optional(),
        'sendDataModel': z
          .boolean()
          .describe(
            'If true, the client will send the full data model of this surface in the metadata of every A2A message sent to the server that created the surface. Defaults to false.',
          )
          .optional(),
      })
      .strict()
      .describe(
        "Signals the client to create a new surface and begin rendering it. It is an error to send 'createSurface' for a surfaceId that already exists without first deleting it. When this message is sent, the client will expect 'updateComponents' and/or 'updateDataModel' messages for the same surfaceId that define the component tree.",
      ),
  })
  .strict();
export type CreateSurfaceMessage = z.infer<typeof CreateSurfaceMessageSchema>;

export const UpdateComponentsMessageSchema = z
  .object({
    'version': z.enum(['v0.9', 'v0.9.1']),
    'updateComponents': z
      .object({
        'surfaceId': z.string().describe('The unique identifier for the UI surface to be updated.'),
        'components': z
          .array(z.record(z.string(), z.any()))
          .min(1)
          .describe('A list containing all UI components for the surface.'),
      })
      .strict()
      .describe(
        "Updates a surface with a new set of components. This message can be sent multiple times to update the component tree of an existing surface. One of the components in one of the components lists MUST have an 'id' of 'root' to serve as the root of the component tree. The createSurface message MUST have been previously sent with the 'catalogId' that is in this message.",
      ),
  })
  .strict();
export type UpdateComponentsMessage = z.infer<typeof UpdateComponentsMessageSchema>;

export const UpdateDataModelMessageSchema = z
  .object({
    'version': z.enum(['v0.9', 'v0.9.1']),
    'updateDataModel': z
      .object({
        'surfaceId': z
          .string()
          .describe('The unique identifier for the UI surface this data model update applies to.'),
        'path': z
          .string()
          .describe(
            "An optional path to a location within the data model (e.g., '/user/name'). If omitted, or set to '/', refers to the entire data model.",
          )
          .optional(),
        'value': z
          .any()
          .describe(
            "The data to be updated in the data model. If present, the value at 'path' is replaced (or created). If omitted, the key at 'path' is removed.",
          )
          .optional(),
      })
      .strict()
      .describe(
        "Updates the data model for an existing surface. This message can be sent multiple times to update the data model. The createSurface message MUST have been previously sent with the 'catalogId' that is in this message.",
      ),
  })
  .strict();
export type UpdateDataModelMessage = z.infer<typeof UpdateDataModelMessageSchema>;

export const DeleteSurfaceMessageSchema = z
  .object({
    'version': z.enum(['v0.9', 'v0.9.1']),
    'deleteSurface': z
      .object({
        'surfaceId': z.string().describe('The unique identifier for the UI surface to be deleted.'),
      })
      .strict()
      .describe(
        "Signals the client to delete the surface identified by 'surfaceId'. The createSurface message MUST have been previously sent with the 'catalogId' that is in this message.",
      ),
  })
  .strict();
export type DeleteSurfaceMessage = z.infer<typeof DeleteSurfaceMessageSchema>;

export const A2uiMessageSchema = z.union([
  CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema,
]);
export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;

export const A2uiMessageListSchema = z.array(A2uiMessageSchema).describe('A list of messages.');
export type A2uiMessageList = z.infer<typeof A2uiMessageListSchema>;

export const A2uiMessageListWrapperSchema = z
  .object({
    messages: A2uiMessageListSchema,
  })
  .strict()
  .describe('An object wrapping a list of messages.');
export type A2uiMessageListWrapper = z.infer<typeof A2uiMessageListWrapperSchema>;
