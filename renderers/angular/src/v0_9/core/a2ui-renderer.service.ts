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
  EnvironmentProviders,
  Injector,
  makeEnvironmentProviders,
} from '@angular/core';
import {
  MessageProcessor,
  MessageProcessorOptions,
  ProcessableMessagePayload,
  CallOptions,
  SurfaceGroupModel,
  ActionListener,
} from '@a2ui/web_core/v0_9';
import {AngularComponentImplementation, AngularCatalog} from '../catalog/types';
import {
  clearDefaultUniversalInjector,
  setDefaultUniversalInjector,
} from '../catalog/angular_wc_host';
import {setMarkdownRenderer} from '@a2ui/web_core/v0_9/basic_catalog';
import {MarkdownRenderer} from './markdown';
import {initializeAngularReactivity} from './reactivity';

/**
 * Configuration for the A2UI renderer.
 */
export interface RendererConfiguration {
  /** The catalogs containing the available components and functions. */
  catalogs: AngularCatalog[];
  /**
   * When true, catalog entries that are both an Angular component and a Web Component (see
   * `createComponentImplementation`) render as W3C universal Web Components application-wide.
   * When false (default), they render as native Angular components.
   *
   * This only affects components rendered directly by the Angular renderer. Children of a
   * universal container component are always rendered as Web Components, because the container
   * resolves them by tag name.
   */
  useUniversalComponents?: boolean;
  /**
   * Optional handler for actions dispatched from any surface.
   */
  actionHandler?: ActionListener;
  /**
   * Optional configuration options for the underlying MessageProcessor.
   */
  processorOptions?: MessageProcessorOptions;
}

/**
 * Injection token for the A2UI renderer configuration.
 */
export const A2UI_RENDERER_CONFIG = new InjectionToken<RendererConfiguration>(
  'A2UI_RENDERER_CONFIG',
);

/**
 * Provides the A2UI renderer configuration.
 *
 * @param configOrFactory The configuration or a factory function that returns the configuration.
 * @returns The providers for the A2UI renderer.
 */
export function provideA2Ui(
  configOrFactory: RendererConfiguration | (() => RendererConfiguration),
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: A2UI_RENDERER_CONFIG,
      ...(typeof configOrFactory === 'function'
        ? {useFactory: configOrFactory}
        : {useValue: configOrFactory}),
    },
  ]);
}

/**
 * Manages A2UI rendering sessions by bridging the MessageProcessor to Angular.
 *
 * This service is the central entry point for the A2UI renderer. It maintains a
 * {@link MessageProcessor} that turns A2UI protocol messages into a reactive
 * {@link SurfaceGroupModel}.
 */
@Injectable({providedIn: 'root'})
export class A2uiRendererService implements OnDestroy {
  private _messageProcessor: MessageProcessor<AngularComponentImplementation>;
  private _catalogs: AngularCatalog[] = [];
  private readonly _injector = inject(Injector);
  private readonly _config = inject(A2UI_RENDERER_CONFIG, {optional: true});
  private readonly _useUniversalComponents = this._config?.useUniversalComponents ?? false;

  constructor() {
    initializeAngularReactivity(this._injector.get(EnvironmentInjector));
    // Angular components wrapped as Web Components need an injector when a universal container
    // creates them outside of ComponentHostComponent.
    setDefaultUniversalInjector(this._injector);
    // Universal basic catalog elements render markdown through web_core's global renderer;
    // native Angular components inject `MarkdownRenderer` directly. Registering unconditionally
    // ensures Web Component-only catalogs (e.g. v1.0 BasicCatalog) always have markdown support.
    const markdownRenderer = this._injector.get(MarkdownRenderer, null);
    if (markdownRenderer) {
      setMarkdownRenderer((markdown, options) => markdownRenderer.render(markdown, options));
    }
    this._catalogs = this._config?.catalogs ?? [];
    this._messageProcessor = new MessageProcessor<AngularComponentImplementation>(
      this._catalogs,
      this._config?.actionHandler,
      this._config?.processorOptions,
    );
  }

  /**
   * Processes a list or envelope of A2UI messages and updates the internal surface models.
   *
   * This should be called whenever new messages arrive from an agent or orchestrator.
   *
   * @param messages The messages or envelope to process.
   */
  processMessages(
    messages: unknown[] | ProcessableMessagePayload | Record<string, unknown> | any,
  ): void {
    this._messageProcessor.processMessages(messages as ProcessableMessagePayload);
  }

  /**
   * Asynchronously processes a list or envelope of A2UI messages and awaits any pending
   * function calls.
   *
   * @param messages The messages or envelope to process.
   */
  async processMessagesAsync(
    messages: unknown[] | ProcessableMessagePayload | Record<string, unknown> | any,
  ): Promise<void> {
    await this._messageProcessor.processMessagesAsync(messages as ProcessableMessagePayload);
  }

  /**
   * Calls an agent function on a specific surface and returns a promise for the result.
   *
   * @param surfaceId The target surface ID.
   * @param call The function name or call descriptor.
   * @param argsOrOptions Function arguments or call options.
   * @param options Call options if arguments were provided.
   */
  callAgentFunction<TRes = unknown>(
    surfaceId: string,
    call: string | {call: string; args?: Record<string, unknown>; catalogId?: string},
    argsOrOptions?: Record<string, unknown> | CallOptions,
    options?: CallOptions,
  ): Promise<TRes> {
    if (typeof call === 'string') {
      const fnCall = {call, args: argsOrOptions as Record<string, unknown> | undefined};
      return this._messageProcessor.callAgentFunction<TRes>(surfaceId, fnCall as any, options);
    }
    return this._messageProcessor.callAgentFunction<TRes>(
      surfaceId,
      call as any,
      argsOrOptions as CallOptions | undefined,
    );
  }

  /**
   * The underlying MessageProcessor instance.
   */
  get processor(): MessageProcessor<AngularComponentImplementation> {
    return this._messageProcessor;
  }

  /**
   * The current surface group model containing all active surfaces.
   *
   * Surfaces can be retrieved from this group using their `surfaceId`.
   */
  get surfaceGroup(): SurfaceGroupModel<AngularComponentImplementation> {
    return this._messageProcessor.model;
  }

  /**
   * Whether universal web components rendering is enabled application-wide.
   */
  get useUniversalComponents(): boolean {
    return this._useUniversalComponents;
  }

  ngOnDestroy(): void {
    this._messageProcessor.dispose();
    this._messageProcessor.model.dispose();
    clearDefaultUniversalInjector(this._injector);
  }
}
