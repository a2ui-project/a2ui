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

import {A2UI_DATA_PART_RENDERER_ENTRY} from '@a2a_chat_canvas/a2a-renderer/catalog/a2ui-data-part/renderer-config';
import {A2UI_DATA_PART_RESOLVER} from '@a2a_chat_canvas/a2a-renderer/catalog/a2ui-data-part/resolver';
import {DEFAULT_TEXT_PART_RENDERER_ENTRY} from '@a2a_chat_canvas/a2a-renderer/catalog/default-text-part/renderer-config';
import {DEFAULT_TEXT_PART_RESOLVER} from '@a2a_chat_canvas/a2a-renderer/catalog/default-text-part/resolver';
import {ARTIFACT_RESOLVERS, PART_RESOLVERS, RENDERERS} from '@a2a_chat_canvas/a2a-renderer/tokens';
import {ArtifactResolver, PartResolver, RendererEntry} from '@a2a_chat_canvas/a2a-renderer/types';
import {theme as a2uiTheme} from '@a2a_chat_canvas/a2ui-catalog/theme';
import {A2A_SERVICE, A2aService} from '@a2a_chat_canvas/interfaces/a2a-service';
import {
  MARKDOWN_RENDERER_SERVICE,
  MarkdownRendererService,
} from '@a2a_chat_canvas/interfaces/markdown-renderer-service';
import {SanitizerMarkdownRendererService} from '@a2a_chat_canvas/services/sanitizer-markdown-renderer-service';
import {Catalog, Theme} from '@a2ui/angular';
import {
  EnvironmentProviders,
  Provider,
  Type,
  makeEnvironmentProviders,
  Injector,
} from '@angular/core';
import {DEFAULT_A2UI_CATALOG} from './a2ui-catalog/a2a-chat-canvas-catalog';
import {ChatService} from './services/chat-service';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from '@a2ui/angular/v0_9';

const DEFAULT_RENDERERS: readonly RendererEntry[] = [
  A2UI_DATA_PART_RENDERER_ENTRY,
  DEFAULT_TEXT_PART_RENDERER_ENTRY,
];

const DEFAULT_PART_RESOLVERS: readonly PartResolver[] = [
  A2UI_DATA_PART_RESOLVER,
  DEFAULT_TEXT_PART_RESOLVER,
];

/**
 * Call this function to configure the features that are enabled for
 * Chat/Canvas. This should only be called once per application inside the
 * call to bootstrap the application.
 */
export function configureChatCanvasFeatures(
  a2aFeature: A2aFeature,
  a2uiFeature: A2uiFeature,
  ...additionalFeatures: ReadonlyArray<Exclude<ChatCanvasFeatures, A2aFeature | A2uiFeature>>
): EnvironmentProviders {
  const defaultPartResolversFeature = usingPartResolvers(...DEFAULT_PART_RESOLVERS);
  const defaultRenderersFeature = usingRenderers(...DEFAULT_RENDERERS);

  return makeEnvironmentProviders([
    [
      a2aFeature,
      a2uiFeature,
      defaultPartResolversFeature,
      defaultRenderersFeature,
      ...additionalFeatures,
    ].map(feature => feature.providers),
  ]);
}

/**
 * Configures the Chat/Canvas to use the given A2A service.
 */
export function usingA2aService<T extends A2aService>(a2aServiceClass: Type<T>): A2aFeature {
  return {
    kind: ChatCanvasFeatureKind.A2A_FEATURE,
    providers: [{provide: A2A_SERVICE, useClass: a2aServiceClass}],
  };
}

/**
 * Configures the Chat/Canvas to use the given MarkdownRenderer.
 */
export function usingMarkdownRenderer<T extends MarkdownRendererService>(
  markdownRendererClass: Type<T>,
): MarkdownFeature {
  return {
    kind: ChatCanvasFeatureKind.MARKDOWN_FEATURE,
    providers: [{provide: MARKDOWN_RENDERER_SERVICE, useClass: markdownRendererClass}],
  };
}

/**
 * Configures the Chat/Canvas to use the default markdown rendering parsing
 * markdown as HTML.
 */
export function usingDefaultSanitizerMarkdownRenderer(): MarkdownFeature {
  return usingMarkdownRenderer(SanitizerMarkdownRendererService);
}

/**
 * Configures the Chat/Canvas to use the given PartResolvers.
 */
export function usingPartResolvers(...partResolvers: readonly PartResolver[]): PartResolverFeature {
  return {
    kind: ChatCanvasFeatureKind.PART_RESOLVER_FEATURE,
    providers: [
      partResolvers.map(resolver => ({
        provide: PART_RESOLVERS,
        useValue: resolver,
        multi: true,
      })),
    ],
  };
}

/**
 * Configures the Chat/Canvas to use the given ArtifactResolvers.
 */
export function usingArtifactResolvers(
  ...artifactResolvers: readonly ArtifactResolver[]
): ArtifactResolverFeature {
  return {
    kind: ChatCanvasFeatureKind.ARTIFACT_RESOLVER_FEATURE,
    providers: [
      artifactResolvers.map(resolver => ({
        provide: ARTIFACT_RESOLVERS,
        useValue: resolver,
        multi: true,
      })),
    ],
  };
}

/**
 * Configures the Chat/Canvas to use the given renderers.
 */
export function usingRenderers(...renderers: readonly RendererEntry[]): RendererFeature {
  return {
    kind: ChatCanvasFeatureKind.RENDERER_FEATURE,
    providers: [
      renderers.map(renderer => ({
        provide: RENDERERS,
        useValue: renderer,
        multi: true,
      })),
    ],
  };
}

/**
 * Configures the Chat/Canvas to use A2UI Renderers.
 *
 * This function supports configuring both A2UI v0.8 (legacy) and A2UI v0.9 (latest) rendering pipelines
 * simultaneously. If the client or agent sends payloads matching either version, the appropriate
 * renderer and catalog are selected.
 *
 * @param customCatalogV08 Optional custom catalog to merge with the default A2UI catalog for v0.8 payloads.
 * @param customCatalogV09 Optional custom catalog to be registered with the v0.9 A2UI renderer service.
 * @param theme Optional custom theme configuration to be shared across all rendering versions.
 */
export function usingA2uiRenderers(
  customCatalogV08?: any,
  customCatalogV09?: any,
  theme?: any,
): A2uiFeature {
  // --- v0.8 Setup ---
  // Merge the user-provided v0.8 catalog with the default canvas catalog
  const mergedCatalog = {
    ...DEFAULT_A2UI_CATALOG,
    ...(customCatalogV08 ?? {}),
  };

  // --- v0.9 Setup ---
  // Collect v0.9 catalogs to be used by the A2uiRendererService
  const catalogsV09: any[] = [];
  if (customCatalogV09) {
    catalogsV09.push(customCatalogV09);
  }
  console.log(
    '[usingA2uiRenderers] customCatalogV09:',
    customCatalogV09,
    'catalogsV09:',
    catalogsV09,
  );

  return {
    kind: ChatCanvasFeatureKind.A2UI_FEATURE,
    providers: [
      // --- ALL VERSIONS (COMMON) ---
      // Theme config is shared by all rendering versions
      {provide: Theme, useValue: theme ?? a2uiTheme},

      // --- v0.8 PROVIDERS ---
      // Legacy v0.8 Catalog token for the v0.8 renderer
      {
        provide: Catalog,
        useValue: mergedCatalog,
      },

      // --- v0.9 PROVIDERS ---
      // v0.9 A2uiRendererService configuration (catalogs and action handler)
      {
        provide: A2UI_RENDERER_CONFIG,
        useFactory: (injector: Injector) => {
          return {
            catalogs: catalogsV09,
            actionHandler: (action: any) => {
              console.log('[usingA2uiRenderers] actionHandler invoked with action:', action);
              const envelope = {
                version: 'v0.9',
                action,
              };
              try {
                const chatService = injector.get(ChatService);
                console.log('[usingA2uiRenderers] Sending action envelope to agent:', envelope);
                chatService.sendMessage(JSON.stringify(envelope), true);
              } catch (e) {
                console.error('[usingA2uiRenderers] Failed to send action to agent:', e);
              }
            },
          };
        },
        deps: [Injector],
      },
      // The central v0.9 renderer service
      A2uiRendererService,
    ],
  };
}

/**
 * Helper type to represent a feature.
 */
export interface ChatCanvasFeature<FeatureKind extends ChatCanvasFeatureKind> {
  kind: FeatureKind;
  providers: readonly Provider[];
}

/**
 * Type alias for the markdown feature.
 */
export type MarkdownFeature = ChatCanvasFeature<ChatCanvasFeatureKind.MARKDOWN_FEATURE>;

/**
 * Type alias for the A2A feature.
 */
export type A2aFeature = ChatCanvasFeature<ChatCanvasFeatureKind.A2A_FEATURE>;

/**
 * Type alias for the Artifact Resolver feature.
 */
export type ArtifactResolverFeature =
  ChatCanvasFeature<ChatCanvasFeatureKind.ARTIFACT_RESOLVER_FEATURE>;

/**
 * Type alias for the Part Resolver feature.
 */
export type PartResolverFeature = ChatCanvasFeature<ChatCanvasFeatureKind.PART_RESOLVER_FEATURE>;

/**
 * Type alias for the Renderer feature.
 */
export type RendererFeature = ChatCanvasFeature<ChatCanvasFeatureKind.RENDERER_FEATURE>;

/**
 * Type alias for the A2UI Renderer feature.
 */
export type A2uiFeature = ChatCanvasFeature<ChatCanvasFeatureKind.A2UI_FEATURE>;

/**
 * A type alais for all of the features that can be enabled for Chat Canvas.
 */
export type ChatCanvasFeatures =
  | MarkdownFeature
  | A2aFeature
  | ArtifactResolverFeature
  | PartResolverFeature
  | RendererFeature
  | A2uiFeature;

/**
 * The list of features as an enum to uniquely type each feature.
 */
export enum ChatCanvasFeatureKind {
  /** Feature to configure the A2A service. */
  A2A_FEATURE,
  /** Feature to enable markdown rendering in the chat canvas. */
  MARKDOWN_FEATURE,
  /** Feature to enable artifact resolvers in the chat canvas. */
  ARTIFACT_RESOLVER_FEATURE,
  /** Feature to enable part resolvers in the chat canvas. */
  PART_RESOLVER_FEATURE,
  /** Feature to enable renderers in the chat canvas. */
  RENDERER_FEATURE,
  /** Feature to enable A2UI in the chat canvas. */
  A2UI_FEATURE,
}
