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
 * @fileoverview The v0.9 message types, as `server_to_client.json`,
 * `client_to_server.json`, `client_capabilities.json` and
 * `client_data_model.json` describe them. The common types are in
 * `generated-common-types.ts`. Messages are validated against the JSON
 * documents themselves; these types only describe them.
 */

import type {ComponentId} from './generated-common-types.js';

/** The `version` of a v0.9 message. */
export type V09MessageVersion = 'v0.9' | 'v0.9.1';

/** A JSON Schema object. */
export type JsonSchema = Record<string, unknown>;

/** Describes a function's interface. */
export interface FunctionDefinition {
  /** The unique name of the function. */
  name: string;
  /** A human-readable description of what the function does and how to use it. */
  description?: string;
  parameters: Record<string, any>;
  /** The type of value this function returns. */
  returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
}

/** A collection of component and function definitions. */
export interface InlineCatalog {
  /** Unique identifier for this catalog. */
  catalogId: string;
  /** Definitions for UI components supported by this catalog. */
  components?: Record<string, Record<string, any>>;
  /** Definitions for functions supported by this catalog. */
  functions?: FunctionDefinition[];
  /** The schema of each theme property, by property name. */
  theme?: Record<string, Record<string, any>>;
}

/** The capabilities structure for version 0.9 of the A2UI protocol. */
export interface A2uiVersionCapabilities {
  /** The IDs of the catalogs the client supports. */
  supportedCatalogIds: string[];
  /** Inline catalog definitions, when the agent accepts them. */
  inlineCatalogs?: InlineCatalog[];
}

/** The client capabilities, keyed by protocol version. */
export type A2uiClientCapabilities =
  | {
      'v0.9': any;
      'v0.9.1'?: any;
    }
  | {
      'v0.9'?: any;
      'v0.9.1': any;
    };

/** Reports a user-initiated action from a component. */
export interface A2uiClientAction {
  /** The name of the action, taken from the component's action.event.name property. */
  name: string;
  /** The id of the surface where the event originated. */
  surfaceId: string;
  /** The id of the component that triggered the event. */
  sourceComponentId: string;
  /** An ISO 8601 timestamp of when the event occurred. */
  timestamp: string;
  /** The key-value pairs of the component's action.event.context, with all data bindings resolved. */
  context: Record<string, any>;
}

/** An error the client reports. */
export type A2uiClientError =
  | {
      code: 'VALIDATION_FAILED';
      /** The id of the surface where the error occurred. */
      surfaceId: string;
      /** The JSON pointer to the field that failed validation (e.g. '/components/0/text'). */
      path: string;
      /** A short one or two sentence description of why validation failed. */
      message: string;
    }
  | {
      code?: any;
      /** A short one or two sentence description of why the error occurred. */
      message: string;
      /** The id of the surface where the error occurred. */
      surfaceId: string;
      [key: string]: any;
    };

/** A client-to-server message. */
export type A2uiClientMessage = {version: V09MessageVersion} & (
  | {action: A2uiClientAction}
  | {error: A2uiClientError}
);

/** The client data model, attached to A2A message metadata as `a2uiClientDataModel`. */
export interface A2uiClientDataModel {
  version: V09MessageVersion;
  /** A map of surface IDs to their current data models. */
  surfaces: Record<string, Record<string, any>>;
}

/** A list of client messages. */
export type A2uiClientMessageList = A2uiClientMessage[];

/** An object wrapping a list of client messages. */
export interface A2uiClientMessageListWrapper {
  messages: A2uiClientMessageList;
}

/** Signals the client to create a new surface and begin rendering it. */
export interface CreateSurfaceMessage {
  version: V09MessageVersion;
  createSurface: {
    /** The unique identifier for the UI surface to be rendered. */
    surfaceId: string;
    /** The catalog the surface renders with. */
    catalogId: string;
    theme?: any;
    /** Whether the client sends the surface's data model with every message. */
    sendDataModel?: boolean;
  };
}

/** Updates a surface with a new set of components. */
export interface UpdateComponentsMessage {
  version: V09MessageVersion;
  updateComponents: {
    /** The unique identifier for the UI surface to be updated. */
    surfaceId: string;
    /** A list containing all UI components for the surface. */
    components: Record<string, any>[];
  };
}

/** Updates the data model for an existing surface. */
export interface UpdateDataModelMessage {
  version: V09MessageVersion;
  updateDataModel: {
    /** The unique identifier for the UI surface this data model update applies to. */
    surfaceId: string;
    /** A path in the data model (e.g., '/user/name'); omitted or '/' is the whole model. */
    path?: string;
    /** The value to set at `path`; when omitted, the key at `path` is removed. */
    value?: any;
  };
}

/** Signals the client to delete the surface identified by 'surfaceId'. */
export interface DeleteSurfaceMessage {
  version: V09MessageVersion;
  deleteSurface: {
    /** The unique identifier for the UI surface to be deleted. */
    surfaceId: string;
  };
}

/** A server-to-client message. */
export type A2uiMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

/** A list of messages. */
export type A2uiMessageList = A2uiMessage[];

/** An object wrapping a list of messages. */
export interface A2uiMessageListWrapper {
  messages: A2uiMessageList;
}

/** A template child list: a component repeated for each item of a data model list. */
export interface TemplateChildList {
  componentId: ComponentId;
  /** The path to the list of component property objects in the data model. */
  path: string;
}

/** A generic A2UI component definition. */
export interface AnyComponent {
  /** The type name of the component. */
  component: string;
  id?: ComponentId;
  weight?: number;
  [key: string]: unknown;
}
