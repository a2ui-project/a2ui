/**
 * Copyright 2026 kokoro-ele
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

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {render, Box, Text, useInput, useApp} from 'ink';
import {
  MessageProcessor,
  type A2uiClientMessage,
  type A2uiMessage,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog, type InkComponentImplementation} from '../src/v0_9/index.js';
import {InkA2AClient} from './a2a-client.js';
import {
  createRestaurantListMessages,
  createBookingFormMessages,
  createConfirmationMessages,
} from '../../../samples/client/react/shell/src/mock/restaurantMessages.js';

const DEFAULT_AGENT = process.env['A2A_AGENT_URL'] ?? 'http://localhost:10002';
const DEFAULT_QUERY = 'Find Chinese restaurants in New York';

function parseArgs(argv: string[]) {
  const mock = argv.includes('--mock');
  const auto = argv.includes('--auto');
  const urlIdx = argv.indexOf('--url');
  const url = urlIdx >= 0 ? argv[urlIdx + 1] : DEFAULT_AGENT;
  const queryArg = argv.find((a, i) => !a.startsWith('--') && !(urlIdx >= 0 && i === urlIdx + 1));
  return {mock, auto, url: url ?? DEFAULT_AGENT, initialQuery: queryArg};
}

function getMockResponse(message: A2uiClientMessage | string): A2uiMessage[] {
  if (typeof message === 'object' && 'action' in message) {
    const action = message.action;
    const context = action.context || {};
    if (action.name === 'book_restaurant') {
      return createBookingFormMessages(
        String(context.restaurantName || 'Restaurant'),
        String(context.imageUrl || ''),
        String(context.address || ''),
      );
    }
    if (action.name === 'submit_booking') {
      return createConfirmationMessages(
        String(context.restaurantName || 'Restaurant'),
        String(context.partySize || '2'),
        String(context.reservationTime || ''),
        String(context.dietary || ''),
        String(context.imageUrl || ''),
      );
    }
  }
  return createRestaurantListMessages();
}

/** Minimal text prompt for the query line (active when not disabled). */
function Prompt({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit();
        return;
      }
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow) return;
      if (input) onChange(value + input);
    },
    {isActive: !disabled},
  );

  return (
    <Box borderStyle="single" borderColor={disabled ? 'gray' : 'cyan'} paddingX={1}>
      <Text color={disabled ? 'gray' : 'white'}>
        {value}
        {!disabled ? <Text color="cyan">█</Text> : null}
      </Text>
    </Box>
  );
}

function LiveApp({
  mock,
  agentUrl,
  initialQuery,
  auto,
}: {
  mock: boolean;
  agentUrl: string;
  initialQuery?: string;
  auto: boolean;
}) {
  const {exit} = useApp();
  const [query, setQuery] = useState(initialQuery ?? DEFAULT_QUERY);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(
    mock ? 'mock mode — press Enter to send' : `agent ${agentUrl}`,
  );
  const [surfaces, setSurfaces] = useState<SurfaceModel<InkComponentImplementation>[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  // When surfaces are showing, Tab focuses UI widgets; prompt is inactive
  // until Ctrl+N opens a new query.
  const [promptActive, setPromptActive] = useState(true);

  const client = useMemo(() => (mock ? null : new InkA2AClient(agentUrl)), [mock, agentUrl]);
  const sendRef = useRef<((message: A2uiClientMessage | string) => Promise<void>) | null>(null);

  const processor = useMemo(
    () =>
      new MessageProcessor<InkComponentImplementation>([basicCatalog], action => {
        const line = `${action.name} ← ${action.sourceComponentId}`;
        setActions(prev => [...prev.slice(-2), line]);
        void sendRef.current?.({version: 'v0.9', action});
      }),
    [],
  );

  useEffect(() => {
    const created = processor.onSurfaceCreated(surface => {
      setSurfaces(prev => [...prev.filter(s => s.id !== surface.id), surface]);
    });
    const deleted = processor.onSurfaceDeleted(id => {
      setSurfaces(prev => prev.filter(s => s.id !== id));
    });
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  const sendAndProcess = useCallback(
    async (message: A2uiClientMessage | string) => {
      try {
        setRequesting(true);
        setError(null);
        setStatus(
          typeof message === 'string'
            ? `sending: ${message}`
            : 'action' in message
              ? `action: ${message.action.name}`
              : 'sending client message',
        );
        setPromptActive(false);

        const clearSurfaces = () => {
          for (const id of processor.model.surfacesMap.keys()) {
            processor.model.deleteSurface(id);
          }
          setSurfaces([]);
        };

        if (mock) {
          await new Promise(r => setTimeout(r, 300));
          const response = getMockResponse(message);
          // Clear + apply synchronously so React never paints an empty frame.
          clearSurfaces();
          processor.processMessages(structuredClone(response));
          setStatus(
            'mock response ready — Tab focus · Enter activate · Ctrl+N new query · Ctrl+C quit',
          );
        } else {
          clearSurfaces();
          await client!.send(message, chunk => {
            processor.processMessages(chunk);
            setStatus(`streaming… ${processor.model.surfacesMap.size} surface(s)`);
          });
          setStatus('ready — Tab focus · Enter activate · Ctrl+N new query · Ctrl+C quit');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error — fix agent / try --mock · Ctrl+C quit');
        setPromptActive(true);
      } finally {
        setRequesting(false);
      }
    },
    [client, mock, processor],
  );

  useEffect(() => {
    sendRef.current = sendAndProcess;
  }, [sendAndProcess]);

  // Global keys: quit, or Ctrl+N for a new query (bare "n" would steal
  // keystrokes from TextField / DateTimeInput on the booking form).
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }
    if (!promptActive && !requesting && key.ctrl && (input === 'n' || input === 'N')) {
      setPromptActive(true);
      setStatus('type a new query, then Enter · Esc cancels back to UI');
    }
    if (promptActive && !requesting && key.escape && surfaces.length > 0) {
      setPromptActive(false);
      setStatus('ready — Tab focus · Enter activate · Ctrl+N new query · Ctrl+C quit');
    }
  });

  // Auto-send on launch when --auto or an explicit query arg is given.
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current) return;
    if (!auto && initialQuery === undefined) return;
    autoSent.current = true;
    void sendAndProcess(initialQuery ?? DEFAULT_QUERY);
  }, [auto, initialQuery, sendAndProcess]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">
        A2UI Ink — Restaurant Finder {mock ? '(mock)' : '(live)'}
      </Text>
      <Text dimColor>{status}</Text>

      {promptActive ? (
        <Box flexDirection="column" marginY={1} gap={1}>
          <Text dimColor>Query (Enter to send):</Text>
          <Prompt
            value={query}
            onChange={setQuery}
            disabled={requesting}
            onSubmit={() => {
              if (!query.trim() || requesting) return;
              void sendAndProcess(query.trim());
            }}
          />
        </Box>
      ) : null}

      {requesting ? <Text color="yellow">⏳ waiting for agent…</Text> : null}
      {error ? <Text color="red">✗ {error}</Text> : null}

      {!promptActive
        ? surfaces.map(surface => (
            <Box
              key={surface.id}
              marginTop={1}
              borderStyle="round"
              borderColor="gray"
              padding={1}
              flexDirection="column"
            >
              <A2uiSurface surface={surface} />
            </Box>
          ))
        : null}

      {actions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            actions:
          </Text>
          {actions.map((line, i) => (
            <Text key={`${i}-${line}`} color="yellow">
              ⚡ {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

const {mock, auto, url, initialQuery} = parseArgs(process.argv.slice(2));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: yarn demo:live [--mock] [--url http://localhost:10002] [--auto] [query]

  --mock   Use React shell restaurant mock messages (no agent needed)
  --url    Agent base URL (default: ${DEFAULT_AGENT} or $A2A_AGENT_URL)
  --auto   Send the default/given query immediately
  query    Optional initial query text

Examples:
  yarn demo:live --mock --auto
  yarn demo:live --auto "Find sushi near me"
  # Start agent first: cd samples/agent/adk/restaurant_finder && uv run .
  yarn demo:live --auto
`);
  process.exit(0);
}

render(<LiveApp mock={mock} agentUrl={url} initialQuery={initialQuery} auto={auto} />);
