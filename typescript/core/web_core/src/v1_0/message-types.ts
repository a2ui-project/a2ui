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

/**
 * @fileoverview The v1.0 message and catalog definition types, as
 * `agent_to_renderer.json`, `renderer_to_agent.json`,
 * `renderer_capabilities.json` and `catalog_definition.json` describe them.
 * The common types are in `generated-common-types.ts`. Messages are
 * validated against the JSON documents themselves; these types only
 * describe them.
 */

import type {
  CallId,
  ComponentId,
  Extensions,
  FunctionCall,
  FunctionResponse,
} from './generated-common-types.js';

/**
 * A component of a message: an object with its `id`, its `component` type and
 * its properties, which the surface's catalog validates.
 */
export type AnyComponent = Record<string, any>;

/** A non-empty list of components. */
export type ComponentsList = AnyComponent[];

/** A template child list: a component repeated for each item of a data model list. */
export interface TemplateChildList {
  componentId: ComponentId;
  /** The path to the list of component property objects in the data model. */
  path: string;
}

/** The renderer capabilities, as an open record. */
export type RendererCapabilities = Record<string, any>;

/** The v1.0 renderer capabilities. */
export interface V10RendererCapabilities {
  /** The IDs of the catalogs the renderer supports. */
  supportedCatalogIds: string[];
  /** Inline catalog definitions, when the agent accepts them. */
  inlineCatalogs?: Record<string, any>[];
}

/** Signals the renderer to create a new surface and begin rendering it. */
export interface CreateSurfaceMessage {
  version: '1.0';
  createSurface: {
    /** The unique identifier for the UI surface to be rendered. */
    surfaceId: string;
    /** The catalog the surface renders with. */
    catalogId?: string;
    /** Whether the renderer sends the surface's data model with every message. */
    sendDataModel?: boolean;
    /** The surface's initial components. */
    components?: ComponentsList;
    /** The surface's initial data model. */
    dataModel?: Record<string, any>;
    metadata?: {
      extensions?: Extensions;
    };
  };
}

/** Updates a surface with a new set of components. */
export interface UpdateComponentsMessage {
  version: '1.0';
  updateComponents: {
    /** The unique identifier for the UI surface to be updated. */
    surfaceId: string;
    components: ComponentsList;
  };
}

/** Updates the data model for an existing surface. */
export interface UpdateDataModelMessage {
  version: '1.0';
  updateDataModel: {
    /** The unique identifier for the UI surface this data model update applies to. */
    surfaceId: string;
    /** A path in the data model (e.g., '/user/name'); omitted or '/' is the whole model. */
    path?: string;
    /** The value to set at `path`; when omitted, the key at `path` is removed. */
    value?: any;
  };
}

/** Signals the renderer to delete the surface identified by 'surfaceId'. */
export interface DeleteSurfaceMessage {
  version: '1.0';
  deleteSurface: {
    /** The unique identifier for the UI surface to be deleted. */
    surfaceId: string;
  };
}

/** Asks the renderer to run one of its functions. */
export interface CallRendererFunctionMessage {
  version: '1.0';
  callRendererFunction: {
    /** The surface the call runs in, if any. */
    surfaceId?: string;
    functionCallId: CallId;
    /** The call, naming the catalog that declares the function. */
    callFunction: FunctionCall & {catalogId: string; [key: string]: unknown};
  };
}

/** The agent's answer to a `callAgentFunction` message. */
export interface AgentFunctionResponseMessage {
  version: '1.0';
  agentFunctionResponse: FunctionResponse;
}

/** An agent-to-renderer message. */
export type AgentToRendererMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage
  | CallRendererFunctionMessage
  | AgentFunctionResponseMessage;

/** Reports a user-initiated action from a component. */
export interface ActionMessage {
  version: '1.0';
  action: {
    /** The name of the action. */
    name: string;
    /** A message to show the user, if any. */
    userMessage?: string;
    /** The id of the surface where the action originated. */
    surfaceId: string;
    /** The id of the component that triggered the action. */
    sourceComponentId: string;
    /** An ISO 8601 timestamp of when the action occurred. */
    timestamp: string;
    /** The action's context, with all data bindings resolved. */
    context: Record<string, any>;
    metadata?: {
      extensions?: Extensions;
    };
  };
}

/** Asks the agent to run one of its functions. */
export interface CallAgentFunctionMessage {
  version: '1.0';
  callAgentFunction: {
    /** The surface ID where the call originated. */
    surfaceId: string;
    functionCallId: CallId;
    callFunction: FunctionCall;
  };
}

/** The renderer's answer to a `callRendererFunction` message. */
export interface RendererFunctionResponseMessage {
  version: '1.0';
  rendererFunctionResponse: FunctionResponse;
}

/** An error the renderer reports. */
export interface ErrorMessage {
  version: '1.0';
  error:
    | {
        code: 'VALIDATION_FAILED' | 'UNALLOWED_PARENT' | 'UNALLOWED_CHILD';
        /** The id of the surface where the error occurred. */
        surfaceId: string;
        /** The JSON pointer to the field that failed validation. */
        path: string;
        /** A short description of the error. */
        message: string;
      }
    | ({
        code: any;
        /** A short description of the error. */
        message: string;
        [key: string]: any;
      } & (
        | {surfaceId: string; functionCallId?: undefined}
        | {functionCallId: CallId; surfaceId?: undefined}
      ));
}

/** A renderer-to-agent message. */
export type RendererToAgentMessage =
  | ActionMessage
  | CallAgentFunctionMessage
  | RendererFunctionResponseMessage
  | ErrorMessage;

/** The JSON Schema of a call to one catalog function. */
export interface FunctionCallValidationSchema {
  type: 'object';
  description?: string;
  properties: {
    '@call': {const: string};
    args?: Record<string, any>;
  };
  required: string[];
  [key: string]: unknown;
}

/** {@link FunctionCallValidationSchema} as written, before defaults. */
export type FunctionCallValidationSchemaInput = FunctionCallValidationSchema;

/** A catalog's function definition. */
export type FunctionDefinition = Record<string, any> &
  FunctionCallValidationSchema & {
    /** The type of value the function returns. */
    returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
    /** Who may call the function. Defaults to `rendererOnly`. */
    allowedCallers: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    /** Whether the function needs a user gesture. Defaults to `false`. */
    requiresUserActivation: boolean;
  };

/** {@link FunctionDefinition} as written, before defaults. */
export type FunctionDefinitionInput = Record<string, any> &
  FunctionCallValidationSchema & {
    returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
    allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    requiresUserActivation?: boolean;
  };

/** A schema of a catalog's `$defs` that is not a component. */
export type LeafDefinition = Record<string, any>;

/** {@link LeafDefinition} as written. */
export type LeafDefinitionInput = LeafDefinition;

/** A catalog's component definition. */
export type ComponentDefinition = Record<string, any> & {
  /** The components this one may be a child of. */
  allowedParents?: string[];
  /** The components this one may have as children. */
  allowedChildren?: string[];
  metadata?: {
    extensions?: Extensions;
  };
};

/** {@link ComponentDefinition} as written. */
export type ComponentDefinitionInput = ComponentDefinition;

/** The result of a validation function. */
export interface ValidationResult {
  /** Whether the value is valid. */
  valid: boolean;
  /** A message describing the failure. */
  message?: string;
  /** A machine-readable code for the failure. */
  code?: string;
  /** How severe the failure is. Defaults to `error`. */
  severity: 'error' | 'warning' | 'info';
}

/** {@link ValidationResult} as written, before defaults. */
export interface ValidationResultInput {
  valid: boolean;
  message?: string;
  code?: string;
  severity?: 'error' | 'warning' | 'info';
}
