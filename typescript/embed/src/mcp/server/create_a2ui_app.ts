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

/// <reference types="node" />

import {readFile} from 'node:fs/promises';
import type {AgentToRendererMessage} from '@a2ui/web_core/v1_0';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import type {McpServer, RegisteredTool} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getParseErrorMessage,
  objectFromShape,
  safeParseAsync,
  type ShapeOutput,
  type ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import {
  ACTION_TOOL_NAME,
  ActionCallSchema,
  CONTRACT_VERSION,
  DEFAULT_RESOURCE_URI,
  toToolResult,
  type ActionCall,
  type CatalogSchemaFile,
} from '../../contract/index.js';
import {A2uiValidator, type A2uiValidationResult} from './a2ui_validator.js';
import {describeActionRoutes} from './describe_actions.js';
import {
  DEFAULT_MAX_VALUE_LENGTH,
  interpolateFollowUp,
  templatePlaceholders,
} from './follow_up_template.js';
import {loadCatalogSchemaFile} from './load_catalog_schema_file.js';

/** The origins the app may load resources from or connect to, enforced by the host's CSP. */
export interface A2uiAppCsp {
  /** Origins for images, scripts, stylesheets, fonts and media. */
  resourceDomains?: string[];
  /** Origins for fetch, XHR and WebSocket connections. */
  connectDomains?: string[];
}

/** Options of {@link createA2uiApp}. */
export interface A2uiAppOptions {
  /**
   * The app HTML built by `a2ui-embed build`: a path or URL to the file, read again on every
   * resource read so that a rebuilt app is served without restarting the server, or its content.
   */
  html: string | URL | {text: string};
  /**
   * The catalog schema file written next to the app HTML: a path or URL to the file, read once
   * when the app is created, or its parsed content.
   */
  catalogSchema: string | URL | CatalogSchemaFile;
  /** The URI of the app resource. Optional (default: `ui://a2ui/app.html`). */
  resourceUri?: string;
  /** The name of the app resource. Optional (default: `'A2UI app'`). */
  resourceName?: string;
  /** The origins the app needs beyond its own inline content. Optional (default: none). */
  csp?: A2uiAppCsp;
  /** Whether the app asks the host for a visible border. Optional (default: the host decides). */
  prefersBorder?: boolean;
}

/** The request context the MCP SDK passes to tool handlers. */
export type A2uiToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The configuration of a tool registered with {@link A2uiApp.tool}. */
export interface A2uiToolConfig<Args extends ZodRawShapeCompat> {
  /** A human-readable title. */
  title?: string;
  /** What the tool does, for the model. */
  description: string;
  /** The tool's arguments, as a zod raw shape. Optional (default: no arguments). */
  inputSchema?: Args;
  /** Hints about the tool's behavior. */
  annotations?: ToolAnnotations;
  /** Extra tool metadata. The app's `ui.resourceUri` is added to it. */
  _meta?: Record<string, unknown>;
}

/** What a tool handler returns. */
export interface A2uiToolOutput {
  /** A text summary of the result for the model. The model never sees the A2UI. */
  text: string;
  /** The A2UI messages that render the result in the app. Omit for a text-only result. */
  a2ui?: AgentToRendererMessage[];
}

/** A handler of a tool registered with {@link A2uiApp.tool}. */
export type A2uiToolHandler<Args extends ZodRawShapeCompat> = (
  args: ShapeOutput<Args>,
  extra: A2uiToolExtra,
) => A2uiToolOutput | Promise<A2uiToolOutput>;

/** The configuration of an action registered with {@link A2uiApp.action}. */
export interface A2uiActionConfig<Args extends ZodRawShapeCompat> {
  /** What the action does. */
  description?: string;
  /** The schema of the action's `context`, as a zod raw shape. */
  argsSchema: Args;
}

/** Where an action comes from. */
export interface A2uiActionContext {
  /** The surface that dispatched the action. */
  surfaceId: string;
  /** The component that dispatched the action, when the app knows it. */
  sourceComponentId?: string;
  /** The request context of the `a2ui_action` call. */
  extra: A2uiToolExtra;
}

/** What an action handler returns. */
export interface A2uiActionOutput {
  /** The A2UI messages to apply in place, typically updates to the dispatching surface. */
  a2ui?: AgentToRendererMessage[];
  /** A text summary of the outcome. */
  text?: string;
}

/** A handler of an action registered with {@link A2uiApp.action}. */
export type A2uiActionHandler<Args extends ZodRawShapeCompat> = (
  args: ShapeOutput<Args>,
  context: A2uiActionContext,
) => A2uiActionOutput | Promise<A2uiActionOutput>;

/** The configuration of a follow-up registered with {@link A2uiApp.followUp}. */
export interface A2uiFollowUpConfig<Args extends ZodRawShapeCompat> {
  /** What the follow-up does. */
  description?: string;
  /**
   * The message posted to the conversation, with `{name}` placeholders for the action's context
   * values. Each value is quoted, so it can never read as part of the template's own text.
   */
  template: string;
  /** The schema of the action's `context`, as a zod raw shape. Must cover every placeholder. */
  argsSchema: Args;
  /** The length each value is truncated to. Optional (default: 80). */
  maxValueLength?: number;
}

/** An A2UI app served by an MCP server, created with {@link createA2uiApp}. */
export interface A2uiApp {
  /** The URI of the app resource. */
  readonly resourceUri: string;

  /**
   * Registers a tool whose result renders in the app. The handler returns a text summary for the
   * model and, optionally, A2UI messages for the app; the messages are validated before they are
   * sent, and an invalid result becomes an error result that lists the problems.
   */
  tool<Args extends ZodRawShapeCompat>(
    name: string,
    config: A2uiToolConfig<Args>,
    handler: A2uiToolHandler<Args>,
  ): RegisteredTool;

  /**
   * Registers an action that updates the app in place. When a component dispatches an event with
   * this name, the handler receives the event's context, validated against `argsSchema`, and
   * returns the A2UI messages to apply.
   */
  action<Args extends ZodRawShapeCompat>(
    name: string,
    config: A2uiActionConfig<Args>,
    handler: A2uiActionHandler<Args>,
  ): void;

  /**
   * Registers an action that posts a message to the conversation on the user's behalf. The
   * message comes from `template`, filled with the event's context values.
   */
  followUp<Args extends ZodRawShapeCompat>(name: string, config: A2uiFollowUpConfig<Args>): void;

  /**
   * Describes the app's registered actions and follow-ups as Markdown instructions for a model
   * that composes A2UI for the app. Returns `''` when none are registered.
   */
  describeActions(): string;

  /** Validates A2UI messages against the A2UI specification and the app's catalogs. */
  validate(messages: unknown): A2uiValidationResult;
}

type ActionRoute =
  | {
      kind: 'action';
      description?: string;
      argsSchema: ZodRawShapeCompat;
      handler: A2uiActionHandler<ZodRawShapeCompat>;
    }
  | {
      kind: 'followUp';
      description?: string;
      argsSchema: ZodRawShapeCompat;
      template: string;
      maxValueLength: number;
    };

/**
 * Serves an A2UI app from `server`: registers the app HTML as an MCP Apps resource and returns an
 * {@link A2uiApp} to register the tools that render in it and the actions it dispatches.
 *
 * @throws If the catalog schema cannot be read, is invalid, or was written for an incompatible
 *     contract version.
 */
export function createA2uiApp(server: McpServer, options: A2uiAppOptions): A2uiApp {
  const resourceUri = options.resourceUri ?? DEFAULT_RESOURCE_URI;
  const validator = new A2uiValidator(loadCatalogSchemaFile(options.catalogSchema));
  const routes = new Map<string, ActionRoute>();
  let actionToolRegistered = false;

  const uiMeta = {
    csp: {...options.csp},
    ...(options.prefersBorder === undefined ? {} : {prefersBorder: options.prefersBorder}),
  };
  registerAppResource(
    server,
    options.resourceName ?? 'A2UI app',
    resourceUri,
    {mimeType: RESOURCE_MIME_TYPE, _meta: {ui: uiMeta}},
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readHtml(options.html),
          _meta: {ui: uiMeta},
        },
      ],
    }),
  );

  /** Validates `messages` and builds the result that sends them, or an error result. */
  function send(source: string, text: string, messages: AgentToRendererMessage[]): CallToolResult {
    const validation = validator.validate(messages);
    if (!validation.ok) {
      return errorResult(
        `${source} returned invalid A2UI, so nothing was rendered:\n` +
          validation.errors.map(error => `- ${error.message}`).join('\n'),
      );
    }
    validator.remember(messages);
    return toToolResult({text, payload: {contractVersion: CONTRACT_VERSION, messages}});
  }

  async function dispatch(call: ActionCall, extra: A2uiToolExtra): Promise<CallToolResult> {
    const route = routes.get(call.name);
    if (!route) {
      return errorResult(`Unknown action "${call.name}".`);
    }
    const parsed = await safeParseAsync(objectFromShape(route.argsSchema), call.context);
    if (!parsed.success) {
      return errorResult(
        `Invalid context for action "${call.name}": ${getParseErrorMessage(parsed.error)}`,
      );
    }
    const args = parsed.data as Record<string, unknown>;
    if (route.kind === 'followUp') {
      const followUp = interpolateFollowUp(route.template, args, route.maxValueLength);
      if (!followUp.ok) {
        return errorResult(
          `Cannot build the follow-up for action "${call.name}": ${followUp.message}`,
        );
      }
      return toToolResult({
        text: followUp.text,
        payload: {contractVersion: CONTRACT_VERSION, messages: [], followUp: {text: followUp.text}},
      });
    }
    let output: A2uiActionOutput;
    try {
      output = await route.handler(args, {
        surfaceId: call.surfaceId,
        sourceComponentId: call.sourceComponentId,
        extra,
      });
    } catch (error) {
      return errorResult(`Action "${call.name}" failed: ${errorMessage(error)}`);
    }
    return send(
      `Action "${call.name}"`,
      output.text ?? `Action "${call.name}" handled.`,
      output.a2ui ?? [],
    );
  }

  function addRoute(name: string, route: ActionRoute): void {
    if (!name) {
      throw new Error('An action name must not be empty.');
    }
    if (routes.has(name)) {
      throw new Error(`An action or follow-up named "${name}" is already registered.`);
    }
    routes.set(name, route);
    if (actionToolRegistered) return;
    actionToolRegistered = true;
    registerAppTool(
      server,
      ACTION_TOOL_NAME,
      {
        description: 'Handles the actions of the A2UI app. Only the app calls this tool.',
        inputSchema: ActionCallSchema.shape,
        _meta: {ui: {visibility: ['app']}},
      },
      (call, extra) => dispatch(call, extra),
    );
  }

  return {
    resourceUri,

    tool<Args extends ZodRawShapeCompat>(
      name: string,
      config: A2uiToolConfig<Args>,
      handler: A2uiToolHandler<Args>,
    ): RegisteredTool {
      if (name === ACTION_TOOL_NAME) {
        throw new Error(`The tool name "${ACTION_TOOL_NAME}" is reserved for app actions.`);
      }
      const meta = config._meta ?? {};
      const ui = meta['ui'];
      const inputSchema: ZodRawShapeCompat = config.inputSchema ?? {};
      return registerAppTool(
        server,
        name,
        {
          title: config.title,
          description: config.description,
          inputSchema,
          annotations: config.annotations,
          _meta: {...meta, ui: {...(isRecord(ui) ? ui : {}), resourceUri}},
        },
        async (args, extra): Promise<CallToolResult> => {
          let output: A2uiToolOutput;
          try {
            // The SDK parsed `args` with `inputSchema`, which is `config.inputSchema`.
            output = await handler(args as ShapeOutput<Args>, extra);
          } catch (error) {
            return errorResult(`Tool "${name}" failed: ${errorMessage(error)}`);
          }
          if (output.a2ui === undefined) {
            return {content: [{type: 'text', text: output.text}]};
          }
          return send(`Tool "${name}"`, output.text, output.a2ui);
        },
      );
    },

    action<Args extends ZodRawShapeCompat>(
      name: string,
      config: A2uiActionConfig<Args>,
      handler: A2uiActionHandler<Args>,
    ): void {
      addRoute(name, {
        kind: 'action',
        description: config.description,
        argsSchema: config.argsSchema,
        handler: handler as A2uiActionHandler<ZodRawShapeCompat>,
      });
    },

    followUp<Args extends ZodRawShapeCompat>(name: string, config: A2uiFollowUpConfig<Args>): void {
      const maxValueLength = config.maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH;
      if (!Number.isInteger(maxValueLength) || maxValueLength < 1) {
        throw new Error(
          `The maxValueLength of follow-up "${name}" must be a positive integer, got ${maxValueLength}.`,
        );
      }
      const unknown = templatePlaceholders(config.template).filter(
        placeholder => !Object.hasOwn(config.argsSchema, placeholder),
      );
      if (unknown.length > 0) {
        throw new Error(
          `The template of follow-up "${name}" uses placeholders missing from its argsSchema: ${unknown.map(key => `{${key}}`).join(', ')}.`,
        );
      }
      addRoute(name, {
        kind: 'followUp',
        description: config.description,
        argsSchema: config.argsSchema,
        template: config.template,
        maxValueLength,
      });
    },

    describeActions(): string {
      return describeActionRoutes(routes);
    },

    validate(messages: unknown): A2uiValidationResult {
      return validator.validate(messages);
    },
  };
}

async function readHtml(html: A2uiAppOptions['html']): Promise<string> {
  if (typeof html === 'string' || html instanceof URL) {
    return readFile(html, 'utf8');
  }
  return html.text;
}

function errorResult(text: string): CallToolResult {
  return {content: [{type: 'text', text}], isError: true};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
