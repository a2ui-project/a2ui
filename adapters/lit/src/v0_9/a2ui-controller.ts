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

import {ReactiveController, LitElement} from 'lit';
import {
  GenericBinder,
  ComponentContext,
  ComponentApi,
  ResolveA2uiProps,
  InferredComponentApiSchemaType,
} from '@a2ui/web_core/v0_9';
import {A2uiLitElement} from './a2ui-lit-element.js';

/**
 * A Lit ReactiveController that binds an A2UI component context to its API schema.
 *
 * This controller manages the subscription to the GenericBinder, updating the
 * component props and requesting a host update whenever the underlying layer data changes.
 *
 * @template Api The specific A2UI component API interface this controller is bound to.
 */
export class A2uiController<Api extends ComponentApi> implements ReactiveController {
  /**
   * The current reactive properties of the A2UI component, matching the expected output schema.
   */
  public props: ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;
  private binder: GenericBinder<InferredComponentApiSchemaType<Api>>;
  private subscription?: {unsubscribe: () => void};

  /**
   * Initializes the controller, binding it to the given Lit element and API schema.
   *
   * @param host The A2uiLitElement acting as the component host.
   * @param api The A2UI component API defining the schema for this element.
   */
  constructor(
    private host: A2uiLitElement<any>,
    api: Api,
  ) {
    this.binder = new GenericBinder(this.host.context, api.schema);
    this.props = this.binder.snapshot as ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;
    this.host.addController(this);
    if (this.host.isConnected) {
      this.hostConnected();
    }
  }

  /**
   * Subscribes to the GenericBinder updates when the host connects.
   *
   * Triggers a request update on the host element when new props are received.
   */
  hostConnected() {
    if (!this.subscription) {
      this.subscription = this.binder.subscribe(newProps => {
        this.props = newProps as ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;
        this.host.requestUpdate();
      });
    }
  }

  /**
   * Unsubscribes from the GenericBinder updates when the host disconnects.
   */
  hostDisconnected() {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  /**
   * Disposes the underlying GenericBinder to clean up resources from the context.
   */
  dispose() {
    this.binder.dispose();
  }
}
