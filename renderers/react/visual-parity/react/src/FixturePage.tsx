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

import React, {useEffect, useState} from 'react';
import {useA2UI, A2UIRenderer} from '@a2ui/react';
import type {Types} from '@a2ui/lit/0.8';
import {allFixtures, type FixtureName, type ComponentFixture} from '../../fixtures';

/**
 * Convert a value to a ValueMap entry.
 * ValueMap uses typed fields: valueBoolean, valueString, valueNumber, valueMap
 */
function toValueMap(key: string, value: unknown): Types.ValueMap {
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
): Types.ServerToClientMessage[] {
  // Group values by parent path to avoid overwriting
  const byParentPath = new Map<string, Types.ValueMap[]>();

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
  const messages: Types.ServerToClientMessage[] = [];
  for (const [parentPath, contents] of byParentPath) {
    messages.push({
      dataModelUpdate: {
        surfaceId,
        path: parentPath,
        contents,
      },
    } as Types.ServerToClientMessage);
  }

  return messages;
}

/**
 * Convert a ComponentFixture to A2UI server messages.
 */
function fixtureToMessages(
  fixture: ComponentFixture,
  surfaceId: string,
): Types.ServerToClientMessage[] {
  const messages: Types.ServerToClientMessage[] = [];

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
  } as Types.ServerToClientMessage);

  // Begin rendering
  messages.push({
    beginRendering: {
      root: fixture.root,
      surfaceId,
    },
  } as Types.ServerToClientMessage);

  return messages;
}

export function FixturePage() {
  const {processMessages} = useA2UI();
  const [fixtureName, setFixtureName] = useState<FixtureName | null>(null);
  const [ready, setReady] = useState(false);

  // Get fixture name from URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('fixture') as FixtureName;
    if (name && name in allFixtures) {
      setFixtureName(name);
    }
  }, []);

  // Process fixture messages when fixture name changes
  useEffect(() => {
    if (!fixtureName) return;

    const fixture = allFixtures[fixtureName];
    const surfaceId = `fixture-${fixtureName}`;
    const messages = fixtureToMessages(fixture, surfaceId);

    processMessages(messages);
    setReady(true);
  }, [fixtureName, processMessages]);

  // No fixture specified - show list of available fixtures
  if (!fixtureName) {
    const currentTheme = new URLSearchParams(window.location.search).get('theme') || 'lit';
    const themes = ['lit', 'visualParity', 'minimal'];
    return (
      <div>
        <h1>Visual Parity - React</h1>
        <p>Available fixtures:</p>
        <ul>
          {Object.keys(allFixtures).map(name => (
            <li key={name}>
              <a href={`?fixture=${name}&theme=${currentTheme}`}>{name}</a>
            </li>
          ))}
        </ul>
        <h2>Available themes:</h2>
        <ul>
          {themes.map(theme => (
            <li key={theme}>
              <a href={`?theme=${theme}`}>{theme}</a> {theme === currentTheme ? '(current)' : ''}
            </li>
          ))}
        </ul>
        <p>
          Current theme: <strong>{currentTheme}</strong>
        </p>
      </div>
    );
  }

  // Loading
  if (!ready) {
    return <div>Loading...</div>;
  }

  // Render the fixture
  const surfaceId = `fixture-${fixtureName}`;
  return (
    <div className="fixture-container" data-fixture={fixtureName}>
      <A2UIRenderer surfaceId={surfaceId} />
    </div>
  );
}
