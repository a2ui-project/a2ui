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
import {CallIdSchema, ComponentCommonSchema, ExtensionsSchema, FunctionCallSchema, FunctionResponseSchema} from './common-types.js';

/** Zod schema validating any component payload in a v1.0 message (excluding Surface). */
export const AnyComponentSchema = ComponentCommonSchema.extend({
  component: z.string(),
})
  .passthrough()
  .refine(comp => comp.component !== 'Surface', {
    message:
      'Component type cannot be "Surface". "Surface" is a top-level protocol container defined in createSurface, not a child component.',
  });
export type AnyComponent = z.infer<typeof AnyComponentSchema>;

/** Zod schema validating a non-empty array of UI component payloads. */
export const ComponentsListSchema = z.array(AnyComponentSchema).min(1);
export type ComponentsList = z.infer<typeof ComponentsListSchema>;

export const CreateSurfaceMessageSchema = z.object({ "version": z.literal("v1.0"), "createSurface": z.object({ "surfaceId": z.string().describe("The unique identifier for the UI surface to be rendered. It must be globally unique for the renderer's lifetime."), "catalogId": z.string().describe("A string that uniquely identifies the default catalog for this surface. It is recommended to prefix this with an internet domain that you own, to avoid conflicts e.g. 'mycompany.com:somecatalog'. Components and function calls that do not explicitly specify a catalogId will use this surface-level default catalogId.").optional(), "sendDataModel": z.boolean().describe("If true, the renderer will send the full data model of this surface in the metadata of every A2A message sent to the agent that created the surface. Defaults to false.").optional(), "components": ComponentsListSchema.optional(), "dataModel": z.record(z.string(), z.any()).describe("The initial root data model object for the surface.").optional(), "metadata": z.object({ "extensions": ExtensionsSchema.optional() }).strict().describe("Optional surface-level metadata.").optional() }).strict().describe("Signals the renderer to create a new surface and begin rendering it. Creating a surface implicitly instantiates the canonical 'Surface' container component ('common_types.json#/$defs/Surface') with 'child': 'root'. It is an error to try to create a surface with an existing ID without first deleting it; surfaceId MUST be globally unique for the renderer's lifetime. When this message is sent, the renderer expects 'updateComponents' and/or 'updateDataModel' messages for the same surfaceId to define the component tree.") }).strict()
export type CreateSurfaceMessage = z.infer<typeof CreateSurfaceMessageSchema>


export const UpdateComponentsMessageSchema = z.object({ "version": z.literal("v1.0"), "updateComponents": z.object({ "surfaceId": z.string().describe("The unique identifier for the UI surface to be updated. It must be globally unique for the renderer's lifetime."), "components": ComponentsListSchema }).strict().describe("Updates a surface with a new set of components. This message can be sent multiple times to update the component tree of an existing surface. One of the components in one of the components lists MUST have an 'id' of 'root' to serve as the root of the component tree. The createSurface message MUST have been previously sent for this surfaceId.") }).strict()
export type UpdateComponentsMessage = z.infer<typeof UpdateComponentsMessageSchema>


export const UpdateDataModelMessageSchema = z.object({ "version": z.literal("v1.0"), "updateDataModel": z.object({ "surfaceId": z.string().describe("The unique identifier for the UI surface this data model update applies to. It must be globally unique for the renderer's lifetime."), "path": z.string().describe("An optional path to a location within the data model (e.g., '/user/name'). If omitted, or set to '/', refers to the entire data model.").optional(), "value": z.any().describe("The data to be updated in the data model. To delete the key/value at 'path', set 'value' explicitly to null.") }).strict().describe("Updates the data model for an existing surface. This message can be sent multiple times to update the data model. The createSurface message MUST have been previously sent for this surfaceId.") }).strict()
export type UpdateDataModelMessage = z.infer<typeof UpdateDataModelMessageSchema>


export const DeleteSurfaceMessageSchema = z.object({ "version": z.literal("v1.0"), "deleteSurface": z.object({ "surfaceId": z.string().describe("The unique identifier for the UI surface to be deleted. It must be globally unique for the renderer's lifetime.") }).strict().describe("Signals the renderer to delete the surface identified by 'surfaceId'. The createSurface message MUST have been previously sent for this surfaceId.") }).strict()
export type DeleteSurfaceMessage = z.infer<typeof DeleteSurfaceMessageSchema>


export const CallRendererFunctionMessageSchema = z.object({ "version": z.literal("v1.0"), "callRendererFunction": z.object({ "functionCallId": CallIdSchema, "callFunction": z.intersection(FunctionCallSchema, z.any()) }).strict().describe("Signals the renderer to execute a function locally on behalf of the agent.") }).strict()
export type CallRendererFunctionMessage = z.infer<typeof CallRendererFunctionMessageSchema>


export const AgentFunctionResponseMessageSchema = z.object({ "version": z.literal("v1.0"), "agentFunctionResponse": FunctionResponseSchema }).strict()
export type AgentFunctionResponseMessage = z.infer<typeof AgentFunctionResponseMessageSchema>


/** Union schema validating any incoming v1.0 agent-to-renderer message envelope. */
export const AgentToRendererMessageSchema = z.union([
  CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema,
  CallRendererFunctionMessageSchema,
  AgentFunctionResponseMessageSchema,
]);
export type AgentToRendererMessage = z.infer<typeof AgentToRendererMessageSchema>;
