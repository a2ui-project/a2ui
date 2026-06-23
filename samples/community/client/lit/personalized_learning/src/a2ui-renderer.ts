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

/**
 * A2UI Renderer
 *
 * Renders A2UI JSON payloads into the chat interface using the A2UI web components.
 * Uses the signal-based model processor for proper reactivity.
 */

import {v0_8} from '@a2ui/lit';
import type {SourceInfo} from './a2a-client';
// Import the theme provider to register the custom element
import './theme-provider.js';

// Type alias for the processor - use the actual exported class name
type A2UIModelProcessorInstance = InstanceType<typeof v0_8.Data.A2uiMessageProcessor>;

// Extended element type for the theme provider wrapper
interface A2UIThemeProviderElement extends HTMLElement {
  surfaceId: string;
  surface: v0_8.Types.Surface;
  processor: A2UIModelProcessorInstance;
}

export class A2UIRenderer {
  private processors: Map<string, A2UIModelProcessorInstance> = new Map();

  /**
   * Render A2UI JSON into a message element.
   */
  render(messageElement: HTMLDivElement, a2uiMessages: unknown[], source?: SourceInfo): void {
    if (!a2uiMessages || a2uiMessages.length === 0) {
      return;
    }

    // Create a container for the A2UI content
    const container = document.createElement('div');
    container.className = 'a2ui-container';

    // Find the message content element
    const contentEl = messageElement.querySelector('.message-content');
    if (!contentEl) {
      console.error('[A2UIRenderer] Message content element not found');
      return;
    }

    contentEl.appendChild(container);

    // Create a model processor for this render
    const processor = v0_8.Data.createSignalA2uiMessageProcessor();

    // Process all A2UI messages to build the model
    try {
      processor.processMessages(a2uiMessages as v0_8.Types.ServerToClientMessage[]);
    } catch (error) {
      console.error('[A2UIRenderer] Error processing messages:', error);
    }

    // Render the surfaces
    const surfaces = processor.getSurfaces();
    for (const [surfaceId, surface] of surfaces.entries()) {
      this.renderSurface(container, surfaceId, surface, processor);
      this.processors.set(surfaceId, processor);
    }

    // Add source attribution if available
    if (source && (source.url || source.provider)) {
      this.renderSourceAttribution(container, source);
    }
  }

  /**
   * Render source attribution below the A2UI content.
   */
  private renderSourceAttribution(container: HTMLElement, source: SourceInfo): void {
    const attribution = document.createElement('div');
    attribution.className = 'source-attribution';

    // If we have a URL, make it a link; otherwise just show the text
    if (source.url) {
      attribution.innerHTML = `
        <span class="source-label">Source:</span>
        <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="source-link">
          ${source.title || source.provider}
        </a>
        <span class="source-provider">— ${source.provider}</span>
      `;
    } else {
      attribution.innerHTML = `
        <span class="source-label">Source:</span>
        <span class="source-link">${source.title || source.provider}</span>
        <span class="source-provider">— ${source.provider}</span>
      `;
    }
    container.appendChild(attribution);
  }

  /**
   * Render a surface using the theme provider wrapper.
   * The theme provider supplies the theme context required by A2UI components.
   */
  private renderSurface(
    container: HTMLElement,
    surfaceId: string,
    surface: v0_8.Types.Surface,
    processor: A2UIModelProcessorInstance,
  ): void {
    // Create the theme provider wrapper which contains the a2ui-surface
    const providerEl = document.createElement('a2ui-theme-provider') as A2UIThemeProviderElement;

    providerEl.surfaceId = surfaceId;
    providerEl.surface = surface;
    providerEl.processor = processor;

    // Add some styling for the container
    providerEl.style.display = 'block';
    providerEl.style.marginTop = '16px';

    container.appendChild(providerEl);
  }

  /**
   * Get a processor for a surface ID.
   */
  getProcessor(surfaceId: string): A2UIModelProcessorInstance | undefined {
    return this.processors.get(surfaceId);
  }

  /**
   * Clear all rendered surfaces.
   */
  clear(): void {
    this.processors.clear();
  }
}
