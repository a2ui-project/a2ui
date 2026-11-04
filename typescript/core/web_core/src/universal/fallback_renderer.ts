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

import {nothing} from 'lit';
import {Directive, directive, type DirectiveResult} from 'lit/directive.js';
import type {A2uiFallbackRequest} from '../resolution/fallbacks.js';

/**
 * Turns a fallback request into something Lit can render (a `TemplateResult`, a DOM node, a
 * directive such as `fallbackHost`), or into null, undefined or `nothing` to render nothing.
 * Universal elements can't render a framework's views themselves, so the adapter that renders
 * a surface registers one of these for it.
 */
export type A2uiFallbackRenderer = (request: A2uiFallbackRequest) => unknown;

/** Keyed by surface object; core's `SurfaceModel` stays unchanged. */
const renderers = new WeakMap<object, A2uiFallbackRenderer>();

/**
 * Makes `renderer` the fallback renderer of `surface`, replacing any other, and returns the
 * function that removes it again (unless another has replaced it since).
 */
export function registerFallbackRenderer(
  surface: object,
  renderer: A2uiFallbackRenderer,
): () => void {
  renderers.set(surface, renderer);
  return () => {
    if (renderers.get(surface) === renderer) renderers.delete(surface);
  };
}

/**
 * What the fallback renderer of `surface` returns for `request`, or `null` when the surface
 * has none, it returns nothing, or it throws (which is logged).
 */
export function renderFallback(surface: object, request: A2uiFallbackRequest): unknown {
  const renderer = renderers.get(surface);
  if (!renderer) return null;
  try {
    const view = renderer(request);
    return view === undefined || view === nothing ? null : view;
  } catch (e) {
    console.error(`A2UI ${request.category} fallback for '${request.info.componentId}' threw:`, e);
    return null;
  }
}

/** Marks the elements `fallbackHost` creates. */
const FALLBACK_HOST_ATTRIBUTE = 'data-a2ui-fallback-host';

/**
 * Keeps one element per position, so a parent re-render updates the host instead of
 * remounting what the adapter rendered into it.
 */
class FallbackHostDirective extends Directive {
  private tagName?: string;
  private element?: HTMLElement;

  render(tagName: string, properties: Record<string, unknown>) {
    if (!this.element || this.tagName !== tagName) {
      this.tagName = tagName;
      this.element = document.createElement(tagName);
      // Lets a container hide the slot of a host its adapter left empty (see List).
      this.element.setAttribute(FALLBACK_HOST_ATTRIBUTE, '');
    }
    Object.assign(this.element, properties);
    return this.element;
  }
}

const fallbackHostDirective = directive(FallbackHostDirective);

/**
 * For a fallback renderer: renders an element named `tagName` with `properties` assigned, for
 * an adapter to fill with its own fallback view (through a portal or an embedded view). A
 * parent re-render keeps the element at its position and assigns `properties` again. A host
 * the adapter leaves `:empty` (an Angular template that rendered no node) takes no List item.
 */
export function fallbackHost(
  tagName: string,
  properties: Record<string, unknown>,
): DirectiveResult<typeof FallbackHostDirective> {
  return fallbackHostDirective(tagName, properties);
}
