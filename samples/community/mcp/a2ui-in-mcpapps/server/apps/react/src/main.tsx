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

/**
 * Generic A2UI renderer for MCP Apps.
 *
 * This view contains zero server-specific logic. Any MCP server can serve
 * the built react.html as its ui:// resource if it follows two conventions:
 *  1. A2UI payloads are embedded resources with mimeType
 *     application/a2ui+json in tool results (including the entry tool's).
 *  2. Each A2UI action name matches an app-visible tool name, and the
 *     action's resolved context becomes the tool's arguments.
 */

import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App as McpApp} from '@modelcontextprotocol/ext-apps';
import {
  A2uiSurface,
  basicCatalog,
  MarkdownContext,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {MessageProcessor, type A2uiMessage, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';

const A2UI_MIME_TYPES = ['application/a2ui+json', 'application/json+a2ui'];

/**
 * Collects and parses every A2UI embedded resource from a tool result's
 * content blocks. Each resource may hold a single message or an array.
 */
function extractA2uiMessages(content: unknown): A2uiMessage[] {
  if (!Array.isArray(content)) return [];
  const messages: A2uiMessage[] = [];
  for (const block of content) {
    if (block?.type !== 'resource') continue;
    const resource = block.resource;
    if (!A2UI_MIME_TYPES.includes(resource?.mimeType) || typeof resource?.text !== 'string') {
      continue;
    }
    try {
      const parsed = JSON.parse(resource.text);
      messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch (err) {
      console.error('Failed to parse A2UI payload:', err);
    }
  }
  return messages;
}

// Module-level singletons so the tool-result handler is registered before
// connect() and both survive React re-renders.
const mcpApp = new McpApp({name: 'generic-a2ui-react-app', version: '1.0.0'});

const processor = new MessageProcessor([basicCatalog], action => {
  // A2UI action name = server tool name; resolved context = tool arguments.
  mcpApp
    .callServerTool({
      name: action.name,
      arguments: (action.context ?? {}) as Record<string, unknown>,
    })
    .then(result => {
      // Apply the response incrementally — no surface reset.
      const messages = extractA2uiMessages(result.content);
      if (messages.length > 0) {
        processor.processMessages(messages);
      }
    })
    .catch(err => {
      console.error(`Tool call '${action.name}' failed:`, err);
    });
});

function GenericA2uiApp() {
  const [status, setStatus] = useState('Connecting to MCP host…');
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactComponentImplementation>[]>(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  useEffect(() => {
    const created = processor.onSurfaceCreated(surface => {
      setSurfaces(prev => [...prev, surface]);
    });
    const deleted = processor.onSurfaceDeleted(id => {
      setSurfaces(prev => prev.filter(s => s.id !== id));
    });

    // The entry tool's result is a full render: reset all surfaces first.
    mcpApp.ontoolresult = params => {
      Array.from(processor.model.surfacesMap.keys()).forEach(id => {
        processor.model.deleteSurface(id);
      });
      const messages = extractA2uiMessages(params.content);
      if (messages.length > 0) {
        processor.processMessages(messages);
      } else {
        setStatus('Tool result contained no A2UI payload.');
      }
    };

    mcpApp
      .connect()
      .then(() => setStatus('Connected. Waiting for tool result…'))
      .catch(err => setStatus(`Failed to connect to host: ${err}`));

    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, []);

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      {surfaces.length === 0 && <p style={{padding: '8px', color: '#666'}}>{status}</p>}
      {surfaces.map(surface => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </MarkdownContext.Provider>
  );
}

// No <StrictMode>: its double-invoked effects would call connect() twice and
// re-send ui/initialize to the host.
createRoot(document.getElementById('root')!).render(<GenericA2uiApp />);
