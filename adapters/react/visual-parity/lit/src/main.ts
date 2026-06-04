/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {v0_8} from '@a2ui/lit';
import * as UI from '@a2ui/lit/ui';
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {provide} from '@lit/context';
import {renderMarkdown} from '@a2ui/markdown-it';
import {allFixtures, type FixtureName, type ComponentFixture} from '../../fixtures';
import {getTheme, themeNames, type ThemeName} from '../../fixtures/themes';

// Themed surface component that provides theme context directly
// This matches the pattern from @copilotkit/a2ui-renderer's themed-a2ui-surface
// Key insight: @lit/context doesn't propagate through <slot>, so we must
// provide the theme directly on a component that renders a2ui-surface as a child
@customElement('themed-a2ui-surface')
class ThemedA2UISurface extends LitElement {
  @provide({context: UI.Context.themeContext})
  @property({attribute: false})
  accessor theme: v0_8.Types.Theme | undefined = undefined;

  @provide({context: UI.Context.markdown})
  accessor markdownRenderer: v0_8.Types.MarkdownRenderer = renderMarkdown;

  @property({attribute: false})
  accessor surfaceId: string = '';

  @property({attribute: false})
  accessor surface: any = undefined;

  @property({attribute: false})
  accessor processor: any = undefined;

  render() {
    return html`<a2ui-surface
      .surfaceId=${this.surfaceId}
      .surface=${this.surface}
      .processor=${this.processor}
    ></a2ui-surface>`;
  }
}

/**
 * Convert a value to a ValueMap entry.
 * ValueMap uses typed fields: valueBoolean, valueString, valueNumber, valueMap
 */
function toValueMap(key: string, value: unknown): v0_8.Types.ValueMap {
  if (typeof value === 'boolean') {
    return {key, valueBoolean: value};
  } else if (typeof value === 'string') {
    return {key, valueString: value};
  } else if (typeof value === 'number') {
    return {key, valueNumber: value};
  } else if (typeof value === 'object' && value !== null) {
    return {
      key,
      valueMap: Object.entries(value).map(([k, v]) => toValueMap(k, v)),
    };
  }
  return {key, valueString: String(value)};
}

/**
 * Convert fixture data to dataModelUpdate messages.
 * Paths like "/checkbox/checked" need to be split into parent path + key.
 * Multiple keys under the same parent path are grouped into one message
 * to avoid overwriting (each dataModelUpdate replaces data at that path).
 */
function dataToMessages(
  data: Record<string, unknown>,
  surfaceId: string,
): v0_8.Types.ServerToClientMessage[] {
  // Group values by parent path to avoid overwriting
  const byParentPath = new Map<string, v0_8.Types.ValueMap[]>();

  for (const [path, value] of Object.entries(data)) {
    // Split path into parent and key (e.g., "/checkbox/checked" -> "/checkbox", "checked")
    const lastSlash = path.lastIndexOf('/');
    const parentPath = lastSlash > 0 ? path.substring(0, lastSlash) : '/';
    const key = path.substring(lastSlash + 1);

    if (!byParentPath.has(parentPath)) {
      byParentPath.set(parentPath, []);
    }
    byParentPath.get(parentPath)!.push(toValueMap(key, value));
  }

  // Create one message per parent path with all contents grouped
  const messages: v0_8.Types.ServerToClientMessage[] = [];
  for (const [parentPath, contents] of byParentPath) {
    messages.push({
      dataModelUpdate: {
        surfaceId,
        path: parentPath,
        contents,
      },
    } as v0_8.Types.ServerToClientMessage);
  }

  return messages;
}

/**
 * Convert a ComponentFixture to A2UI server messages.
 */
function fixtureToMessages(
  fixture: ComponentFixture,
  surfaceId: string,
): v0_8.Types.ServerToClientMessage[] {
  const messages: v0_8.Types.ServerToClientMessage[] = [];

  // Send initial data model values (before components render)
  if (fixture.data) {
    messages.push(...dataToMessages(fixture.data, surfaceId));
  }

  // Send component definitions
  messages.push({
    surfaceUpdate: {
      surfaceId,
      components: fixture.components.map(c => ({
        id: c.id,
        component: c.component,
      })),
    },
  } as v0_8.Types.ServerToClientMessage);

  // Begin rendering
  messages.push({
    beginRendering: {
      root: fixture.root,
      surfaceId,
    },
  } as v0_8.Types.ServerToClientMessage);

  return messages;
}

/**
 * Initialize and render the fixture page.
 */
function init() {
  const app = document.getElementById('app')!;
  const params = new URLSearchParams(window.location.search);
  const fixtureName = params.get('fixture') as FixtureName;
  const themeName = params.get('theme') as ThemeName | null;

  // Get the selected theme (default to 'lit' since Lit renderer requires a theme)
  const selectedTheme = getTheme(themeName || 'lit');

  // Add theme info to document for debugging
  if (themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
  }

  // Log available themes for debugging
  console.log('[Visual Parity - Lit] Available themes:', themeNames);
  console.log('[Visual Parity - Lit] Selected theme:', themeName || 'default');

  // Default to 'lit' theme if none specified (Lit renderer requires a theme)
  const effectiveTheme = themeName || 'lit';

  // No fixture specified - show list of available fixtures
  if (!fixtureName || !(fixtureName in allFixtures)) {
    app.innerHTML = `
      <h1>Visual Parity - Lit</h1>
      <p>Available fixtures:</p>
      <ul>
        ${Object.keys(allFixtures)
          .map(name => `<li><a href="?fixture=${name}&theme=${effectiveTheme}">${name}</a></li>`)
          .join('')}
      </ul>
      <h2>Available themes:</h2>
      <ul>
        ${themeNames
          .filter(t => t !== 'default')
          .map(
            theme =>
              `<li><a href="?theme=${theme}">${theme}</a> ${theme === effectiveTheme ? '(current)' : ''}</li>`,
          )
          .join('')}
      </ul>
      <p>Current theme: <strong>${effectiveTheme}</strong></p>
    `;
    return;
  }

  // Create the processor and process messages
  const processor = new v0_8.Data.A2uiMessageProcessor();
  const fixture = allFixtures[fixtureName];
  const surfaceId = `fixture-${fixtureName}`;
  const messages = fixtureToMessages(fixture, surfaceId);

  processor.processMessages(messages);

  // Get the surface data
  const surface = processor.getSurfaces().get(surfaceId);
  if (!surface) {
    app.innerHTML = `<div>Error: Failed to process fixture</div>`;
    return;
  }

  // Create container for fixture
  const container = document.createElement('div');
  container.className = 'fixture-container';
  container.setAttribute('data-fixture', fixtureName);
  if (themeName) {
    container.setAttribute('data-theme', themeName);
  }

  // Create themed surface that provides theme context directly (not through slot)
  const themedSurface = document.createElement('themed-a2ui-surface') as ThemedA2UISurface;
  themedSurface.theme = selectedTheme;
  themedSurface.surfaceId = surfaceId;
  themedSurface.surface = surface;
  themedSurface.processor = processor;

  container.appendChild(themedSurface);
  app.appendChild(container);
}

// Run initialization
init();
