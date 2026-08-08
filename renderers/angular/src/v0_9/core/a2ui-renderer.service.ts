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

import {
  Injectable,
  OnDestroy,
  InjectionToken,
  inject,
  EnvironmentInjector,
  Injector,
} from '@angular/core';
import {
  MessageProcessor,
  SurfaceGroupModel,
  ActionListener as ActionHandler,
  A2uiMessage,
} from '@a2ui/web_core/v0_9';
import {AngularCatalog, CatalogComponentDeclaration} from '../catalog/types';
import {prepareUniversalCatalog} from '../catalog/prepare_universal_catalog';
import {initializeAngularReactivity} from './reactivity';

/**
 * Configuration for the A2UI renderer.
 */
export interface RendererConfiguration {
  /**
   * The catalogs containing the available components and functions.
   * If omitted, defaults to an empty list of catalogs.
   */
  catalogs?: AngularCatalog[];
  /**
   * When true, uses W3C universal web components application-wide across all catalogs
   * instead of native Angular components.
   * When false (default), uses native Angular component implementations.
   */
  useUniversalComponents?: boolean;
  /**
   * Optional handler for actions dispatched from any surface.
   */
  actionHandler?: ActionHandler;
}

/**
 * Injection token for the A2UI renderer configuration.
 */
export const A2UI_RENDERER_CONFIG = new InjectionToken<RendererConfiguration>(
  'A2UI_RENDERER_CONFIG',
);

/**
 * Injection token to specify whether universal W3C web components should be used
 * application-wide across all catalogs instead of native Angular components.
 *
 * Defaults to `false` (native Angular components).
 */
export const A2UI_USE_UNIVERSAL_COMPONENTS = new InjectionToken<boolean>(
  'A2UI_USE_UNIVERSAL_COMPONENTS',
  {
    providedIn: 'root',
    factory: () => false,
  },
);

/**
 * Manages A2UI v0.9 rendering sessions by bridging the MessageProcessor to Angular.
 *
 * This service is the central entry point for the A2UI renderer. It maintains a
 * {@link MessageProcessor} that turns A2UI protocol messages into a reactive
 * {@link SurfaceGroupModel}.
 */
@Injectable({providedIn: 'root'})
export class A2uiRendererService implements OnDestroy {
  private _messageProcessor: MessageProcessor<CatalogComponentDeclaration>;
  private _catalogs: AngularCatalog[] = [];
  private _config = inject(A2UI_RENDERER_CONFIG, {optional: true});
  readonly useUniversalComponents: boolean;

  constructor() {
    const injector = inject(Injector);
    initializeAngularReactivity(injector.get(EnvironmentInjector));
    const injectedUniversal = inject(A2UI_USE_UNIVERSAL_COMPONENTS, {optional: true}) ?? false;
    this.useUniversalComponents = this._config?.useUniversalComponents ?? injectedUniversal;
    this.initCatalogs(injector);
    this._messageProcessor = new MessageProcessor<CatalogComponentDeclaration>(
      this._catalogs,
      this._config?.actionHandler as ActionHandler,
    );
  }

  private initCatalogs(injector: Injector): void {
    this._catalogs = this._config?.catalogs ?? [];
    if (this.useUniversalComponents) {
      for (const catalog of this._catalogs) {
        prepareUniversalCatalog(catalog, injector);
      }
    }
  }

  /**
   * Processes a list of A2UI messages and updates the internal surface models.
   *
   * This should be called whenever new messages arrive from an agent or orchestrator.
   *
   * @param messages The list of {@link A2uiMessage}s to process.
   */
  processMessages(messages: A2uiMessage[]): void {
    this._messageProcessor.processMessages(messages);
  }

  /**
   * The current surface group model containing all active surfaces.
   *
   * Surfaces can be retrieved from this group using their `surfaceId`.
   */
  get surfaceGroup(): SurfaceGroupModel<CatalogComponentDeclaration> {
    return this._messageProcessor.model;
  }

  ngOnDestroy(): void {
    this._messageProcessor.model.dispose();
  }
}
