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

import {
  Directive,
  effect,
  inject,
  input,
  ViewContainerRef,
  Type,
  PLATFORM_ID,
  ComponentRef,
} from '@angular/core';
import {DOCUMENT, isPlatformBrowser} from '@angular/common';
import {structuralStyles} from '@a2ui/web_core/styles/index';
import {Catalog} from './catalog';
import {MessageProcessor} from '../data';
import type {AnyComponentNode, SurfaceID} from '../types';
import {DynamicComponent} from './dynamic-component';

@Directive({
  selector: '[a2ui-renderer]',
  standalone: true,
})
export class Renderer {
  private static hasInsertedStyles = false;

  private readonly catalog = inject(Catalog);
  private readonly container = inject(ViewContainerRef);
  private readonly processor: MessageProcessor = inject(MessageProcessor);

  readonly surfaceId = input.required<SurfaceID>();
  readonly component = input.required<AnyComponentNode>();

  private currentId: string | null = null;
  private currentType: string | null = null;
  private currentComponentRef: ComponentRef<DynamicComponent<AnyComponentNode>> | null = null;

  constructor() {
    const platformId = inject(PLATFORM_ID);
    const document = inject(DOCUMENT);

    if (!Renderer.hasInsertedStyles && isPlatformBrowser(platformId)) {
      const styleElement = document.createElement('style');
      styleElement.textContent = structuralStyles;
      document.head.appendChild(styleElement);
      Renderer.hasInsertedStyles = true;
    }

    effect(() => {
      // Explicitly depend on the MessageProcessor's version signal. This ensures that the effect re-runs
      // whenever data model changes occur, even if the node's object reference remains identical
      // (as in the case of in-place mutations from local updates).
      this.processor.version();

      let node = this.component();
      const surfaceId = this.surfaceId();

      // Handle v0.8 wrapped component format
      if (!node.type && (node as any).component) {
        const wrapped = (node as any).component;
        const type = Object.keys(wrapped)[0];
        if (type) {
          node = {
            ...node,
            type: type as any,
            properties: wrapped[type],
          };
        }
      }

      const id = node.id;
      const type = node.type;

      // Focus Loss Prevention:
      // If we have an existing component and its unique identity (ID and Type) hasn't changed,
      // we update its @Input() values in-place. This preserves the underlying DOM element,
      // maintaining focus, text selection, and cursor position.
      if (this.currentComponentRef && this.currentId === id && this.currentType === type) {
        this.updateInputs(this.currentComponentRef, node, surfaceId);
        return;
      }

      // Otherwise, clear and re-create the component because its identity has changed.
      const container = this.container;
      container.clear();
      this.currentComponentRef = null;
      this.currentId = id;
      this.currentType = type;

      const config = this.catalog[node.type];
      if (!config) {
        console.error(`Unknown component type: ${node.type}`);
        return;
      }

      this.render(container, node, surfaceId, config);
    });
  }

  private render(
    container: ViewContainerRef,
    node: AnyComponentNode,
    surfaceId: string,
    config: any,
  ) {
    const componentTypeOrPromise = this.resolveComponentType(config);

    if (componentTypeOrPromise instanceof Promise) {
      componentTypeOrPromise.then(componentType => {
        // Ensure we are still supposed to render this component
        if (this.currentId === node.id && this.currentType === node.type) {
          const componentRef = container.createComponent(componentType) as ComponentRef<
            DynamicComponent<AnyComponentNode>
          >;
          this.currentComponentRef = componentRef;
          this.updateInputs(componentRef, node, surfaceId);
        }
      });
    } else if (componentTypeOrPromise) {
      const componentRef = container.createComponent(componentTypeOrPromise) as ComponentRef<
        DynamicComponent<AnyComponentNode>
      >;
      this.currentComponentRef = componentRef;
      this.updateInputs(componentRef, node, surfaceId);
    }
  }

  private resolveComponentType(config: any): Type<unknown> | Promise<Type<unknown>> | null {
    if (typeof config === 'function') {
      return config();
    } else if (typeof config === 'object' && config !== null) {
      if (typeof config.type === 'function') {
        return config.type();
      } else {
        return config.type;
      }
    }
    return null;
  }

  /**
   * Updates the inputs of an existing component instance with the latest data from the node.
   * This is called during component reuse to keep the UI in sync without losing DOM state (like focus).
   */
  private updateInputs(
    componentRef: ComponentRef<DynamicComponent<AnyComponentNode>>,
    node: AnyComponentNode,
    surfaceId: string,
  ) {
    componentRef.setInput('surfaceId', surfaceId);
    componentRef.setInput('component', node);
    componentRef.setInput('weight', node.weight ?? 0);

    if (node.properties) {
      const props = node.properties as Record<string, unknown>;
      for (const [key, value] of Object.entries(props)) {
        try {
          componentRef.setInput(key, value);
        } catch (e) {
          console.warn(
            `[Renderer] Property "${key}" could not be set on component ${node.type}. If this property is required by the specification, ensure the component declares it as an input.`,
          );
        }
      }
    }
    componentRef.changeDetectorRef.markForCheck();
  }
}
