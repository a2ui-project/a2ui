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

export const A2uiClientActionSchema = z
  .object({
    'name': z
      .string()
      .describe("The name of the action, taken from the component's action.event.name property."),
    'surfaceId': z.string().describe('The id of the surface where the event originated.'),
    'sourceComponentId': z.string().describe('The id of the component that triggered the event.'),
    'timestamp': z
      .string()
      .datetime({offset: true})
      .describe('An ISO 8601 timestamp of when the event occurred.'),
    'context': z
      .record(z.string(), z.any())
      .describe(
        "A JSON object containing the key-value pairs from the component's action.event.context, after resolving all data bindings.",
      ),
  })
  .describe('Reports a user-initiated action from a component.');
export type A2uiClientAction = z.infer<typeof A2uiClientActionSchema>;

export const A2uiValidationErrorSchema = z
  .object({
    'code': z.literal('VALIDATION_FAILED'),
    'surfaceId': z.string().describe('The id of the surface where the error occurred.'),
    'path': z
      .string()
      .describe(
        "The JSON pointer to the field that failed validation (e.g. '/components/0/text').",
      ),
    'message': z
      .string()
      .describe('A short one or two sentence description of why validation failed.'),
  })
  .strict();

export const A2uiGenericErrorSchema = z
  .object({
    'code': z
      .any()
      .refine(
        value => !z.literal('VALIDATION_FAILED').safeParse(value).success,
        'Invalid input: Should NOT be valid against schema',
      ),
    'message': z
      .string()
      .describe('A short one or two sentence description of why the error occurred.'),
    'surfaceId': z.string().describe('The id of the surface where the error occurred.'),
  })
  .catchall(z.any());

export const A2uiClientErrorSchema = z.union([A2uiValidationErrorSchema, A2uiGenericErrorSchema]);
export type A2uiClientError = z.infer<typeof A2uiClientErrorSchema>;

export const A2uiClientMessageSchema = z
  .object({
    version: z.enum(['v0.9', 'v0.9.1']),
  })
  .and(
    z.union([z.object({action: A2uiClientActionSchema}), z.object({error: A2uiClientErrorSchema})]),
  );
export type A2uiClientMessage = z.infer<typeof A2uiClientMessageSchema>;

export const A2uiClientDataModelSchema = z
  .object({
    'version': z.enum(['v0.9', 'v0.9.1']),
    'surfaces': z
      .record(
        z.string(),
        z
          .record(z.string(), z.any())
          .describe('The current data model for the surface, as a standard JSON object.'),
      )
      .describe('A map of surface IDs to their current data models.'),
  })
  .strict()
  .describe(
    'Schema for attaching the client data model to A2A message metadata. This object should be placed in the `a2uiClientDataModel` field of the metadata.',
  );
export type A2uiClientDataModel = z.infer<typeof A2uiClientDataModelSchema>;

export const A2uiClientMessageListSchema = z
  .array(A2uiClientMessageSchema)
  .describe('A list of client messages.');
export type A2uiClientMessageList = z.infer<typeof A2uiClientMessageListSchema>;

export const A2uiClientMessageListWrapperSchema = z
  .object({
    messages: A2uiClientMessageListSchema,
  })
  .strict()
  .describe('An object wrapping a list of client messages.');
export type A2uiClientMessageListWrapper = z.infer<typeof A2uiClientMessageListWrapperSchema>;
