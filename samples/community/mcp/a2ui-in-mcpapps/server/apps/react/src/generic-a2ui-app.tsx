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
 * Generic A2UI renderer component for MCP Apps.
 *
 * Contains zero server-specific logic. Any MCP server can drive this
 * component if it follows two conventions:
 *  1. A2UI payloads are embedded resources with mimeType
 *     application/a2ui+json in tool results (including the entry tool's).
 *  2. Each A2UI action maps to an app-visible tool (by the action's own
 *     name, unless overridden via the actionToToolName prop), and the
 *     action's resolved context becomes the tool's arguments.
 */

import {useEffect, useRef, useState} from 'react';
import {App as McpApp} from '@modelcontextprotocol/ext-apps';
import {
  A2uiSurface,
  basicCatalog,
  MarkdownContext,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {MessageProcessor, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';
import {extractA2uiMessages} from './extract-a2ui-messages';

export interface GenericA2uiAppProps {
  /**
   * Optional mapping from A2UI action names to server tool names. Actions
   * without an entry call the tool named after the action itself.
   */
  actionToToolName?: Record<string, string>;
}

export function GenericA2uiApp({actionToToolName}: GenericA2uiAppProps) {
  const [status, setStatus] = useState('Connecting to MCP host…');

  // Keep the latest mapping visible to the long-lived action handler.
  const actionToToolNameRef = useRef(actionToToolName);
  useEffect(() => {
    actionToToolNameRef.current = actionToToolName;
  }, [actionToToolName]);

  // The MCP App bridge and the A2UI processor live for the component's
  // whole lifetime; the action handler is registered before connect().
  const [mcpApp] = useState(() => new McpApp({name: 'generic-a2ui-react-app', version: '1.0.0'}));
  const [processor] = useState(() => {
    const p = new MessageProcessor<ReactComponentImplementation>([basicCatalog], action => {
      // A2UI action name = server tool name (unless remapped); resolved
      // context = tool arguments.
      const toolName = actionToToolNameRef.current?.[action.name] ?? action.name;
      mcpApp
        .callServerTool({
          name: toolName,
          arguments: (action.context ?? {}) as Record<string, unknown>,
        })
        .then(result => {
          // Apply the response incrementally — no surface reset.
          const messages = extractA2uiMessages(result.content);
          if (messages.length > 0) {
            p.processMessages(messages);
          }
        })
        .catch(err => {
          console.error(`Tool call '${toolName}' failed:`, err);
        });
    });
    return p;
  });

  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactComponentImplementation>[]>(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  const connectStartedRef = useRef(false);

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

    // connect() must run exactly once for this App instance, even if the
    // effect re-runs (e.g. React StrictMode double-invocation).
    if (!connectStartedRef.current) {
      connectStartedRef.current = true;
      mcpApp
        .connect()
        .then(() => setStatus('Connected. Waiting for tool result…'))
        .catch(err => setStatus(`Failed to connect to host: ${err}`));
    }

    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
      mcpApp.ontoolresult = undefined;
    };
  }, [mcpApp, processor]);

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      {surfaces.length === 0 && <p style={{padding: '8px', color: '#666'}}>{status}</p>}
      {surfaces.map(surface => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </MarkdownContext.Provider>
  );
}
