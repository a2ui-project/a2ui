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
import {Box, Text, useInput, useApp, useStdout} from 'ink';
import {MessageProcessor, type A2uiClientAction, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog, type InkComponentImplementation} from '../src/v0_9/index.js';
import {type ExampleItem, findExample, loadExamples} from './examples.js';

type Mode = 'list' | 'preview';

interface LogEntry {
  time: string;
  name: string;
  source: string;
}

function DataModelPanel({surface}: {surface: SurfaceModel<InkComponentImplementation>}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const sub = surface.dataModel.subscribe('/', () => setTick(t => t + 1));
    return () => sub.unsubscribe();
  }, [surface]);
  void tick;
  const json = JSON.stringify(surface.dataModel.get('/'), null, 2);
  const lines = json.split('\n');
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color="yellow">
        data model — {surface.id}
      </Text>
      {lines.slice(0, 16).map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}
      {lines.length > 16 ? <Text dimColor>… ({lines.length - 16} more lines)</Text> : null}
    </Box>
  );
}

function createProcessor(
  onAction: (action: A2uiClientAction) => void,
): MessageProcessor<InkComponentImplementation> {
  return new MessageProcessor<InkComponentImplementation>([basicCatalog], async action => {
    onAction(action as A2uiClientAction);
  });
}

export function ExplorerApp({initialId}: {initialId?: string}) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const allExamples = useMemo(() => loadExamples(), []);

  const initialIndex = useMemo(() => {
    if (!initialId) return 0;
    const hit = findExample(allExamples, initialId);
    return hit ? allExamples.indexOf(hit) : 0;
  }, [allExamples, initialId]);

  const [mode, setMode] = useState<Mode>(initialId ? 'preview' : 'list');
  const [filter, setFilter] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState(initialIndex);
  const [showData, setShowData] = useState(false);
  const [showActions, setShowActions] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messageIndex, setMessageIndex] = useState(-1);
  const [surfaces, setSurfaces] = useState<SurfaceModel<InkComponentImplementation>[]>([]);

  const processorRef = useRef<MessageProcessor<InkComponentImplementation> | null>(null);
  const [, bump] = useState(0);
  const forceRender = () => bump(n => n + 1);

  const logAction = useCallback((action: A2uiClientAction) => {
    setLogs(l => [
      ...l.slice(-20),
      {
        time: new Date().toLocaleTimeString(),
        name: action.name,
        source: action.sourceComponentId,
      },
    ]);
  }, []);

  const syncSurfaces = useCallback(() => {
    const p = processorRef.current;
    setSurfaces(p ? [...p.model.surfacesMap.values()] : []);
  }, []);

  const disposeProcessor = useCallback(() => {
    processorRef.current?.model.dispose();
    processorRef.current = null;
    setSurfaces([]);
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return allExamples;
    const q = filter.toLowerCase();
    return allExamples.filter(
      e => e.id.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
    );
  }, [allExamples, filter]);

  const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));
  const currentExample: ExampleItem | undefined = filtered[safeSelected];

  const loadExample = useCallback(
    (example: ExampleItem, advanceToEnd: boolean) => {
      disposeProcessor();
      const p = createProcessor(logAction);
      processorRef.current = p;
      setLogs([]);
      if (advanceToEnd) {
        p.processMessages(structuredClone(example.messages));
        setMessageIndex(example.messages.length - 1);
      } else {
        setMessageIndex(-1);
      }
      syncSurfaces();
      forceRender();
    },
    [disposeProcessor, logAction, syncSurfaces],
  );

  // Keep surface list in sync for the active processor.
  useEffect(() => {
    const p = processorRef.current;
    if (!p || mode !== 'preview') return;
    syncSurfaces();
    const c = p.onSurfaceCreated(() => syncSurfaces());
    const d = p.onSurfaceDeleted(() => syncSurfaces());
    return () => {
      c.unsubscribe();
      d.unsubscribe();
    };
  }, [mode, messageIndex, syncSurfaces]);

  // Boot into preview when launched with an id
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    if (!initialId) return;
    const hit = findExample(allExamples, initialId) ?? allExamples[initialIndex];
    if (!hit) return;
    booted.current = true;
    loadExample(hit, true);
    setMode('preview');
  }, [allExamples, initialId, initialIndex, loadExample]);

  useEffect(() => () => disposeProcessor(), [disposeProcessor]);

  const stepMessage = useCallback(() => {
    const example = currentExample;
    const p = processorRef.current;
    if (!example || !p) return;
    const next = messageIndex + 1;
    if (next >= example.messages.length) return;
    p.processMessages(structuredClone([example.messages[next]!]));
    setMessageIndex(next);
    syncSurfaces();
  }, [currentExample, messageIndex, syncSurfaces]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (mode === 'list') {
      if (filtering) {
        if (key.escape) {
          setFiltering(false);
          setFilter('');
          setSelected(0);
          return;
        }
        if (key.return) {
          setFiltering(false);
          return;
        }
        if (key.backspace || key.delete) {
          setFilter(f => f.slice(0, -1));
          setSelected(0);
          return;
        }
        if (key.upArrow) {
          setSelected(i => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSelected(i => Math.min(filtered.length - 1, i + 1));
          return;
        }
        if (!key.ctrl && !key.meta && input) {
          setFilter(f => f + input);
          setSelected(0);
        }
        return;
      }

      if (input === '/') {
        setFiltering(true);
        return;
      }
      if (input === 'q' || input === 'Q') {
        exit();
        return;
      }
      if (key.upArrow) {
        setSelected(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelected(i => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (key.return && currentExample) {
        loadExample(currentExample, true);
        setMode('preview');
      }
      return;
    }

    // preview: Ctrl-only chords so TextField typing is never stolen
    if (key.ctrl && (input === 'l' || input === 'L')) {
      disposeProcessor();
      setMessageIndex(-1);
      setMode('list');
      return;
    }
    if (key.ctrl && (input === 's' || input === 'S')) {
      if (!processorRef.current && currentExample) {
        loadExample(currentExample, false);
      }
      stepMessage();
      return;
    }
    if (key.ctrl && (input === 'r' || input === 'R')) {
      if (currentExample) loadExample(currentExample, true);
      return;
    }
    if (key.ctrl && (input === 'x' || input === 'X')) {
      if (currentExample) loadExample(currentExample, false);
      return;
    }
    if (key.ctrl && (input === 'd' || input === 'D')) {
      setShowData(v => !v);
      return;
    }
    if (key.ctrl && (input === 'a' || input === 'A')) {
      setShowActions(v => !v);
    }
  });

  const listHeight = Math.max(8, (stdout?.rows ?? 24) - 10);
  const start = Math.max(
    0,
    Math.min(safeSelected - Math.floor(listHeight / 2), filtered.length - listHeight),
  );
  const visible = filtered.slice(start, start + listHeight);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">
        A2UI Ink Explorer
      </Text>

      {mode === 'list' ? (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="single" borderColor={filtering ? 'cyan' : 'gray'} paddingX={1}>
            <Text dimColor={!filtering}>filter: </Text>
            <Text color={filtering ? 'white' : 'gray'}>
              {filter || (filtering ? '' : '(press / to filter)')}
              {filtering ? <Text color="cyan">█</Text> : null}
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {visible.map((item, i) => {
              const index = start + i;
              const active = index === safeSelected;
              return (
                <Box key={item.id}>
                  <Text inverse={active} color={active ? 'cyan' : undefined} bold={active}>
                    {active ? '▸ ' : '  '}
                    {item.id}
                  </Text>
                  <Text dimColor> {item.title}</Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              {filtered.length}/{allExamples.length} · ↑/↓ · Enter open · / filter · q quit
            </Text>
          </Box>
        </Box>
      ) : currentExample ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{currentExample.title}</Text>
          {currentExample.description ? <Text dimColor>{currentExample.description}</Text> : null}
          <Text dimColor>
            msg {messageIndex + 1}/{currentExample.messages.length} · Ctrl+S step · Ctrl+X reset ·
            Ctrl+R apply-all · Ctrl+D data · Ctrl+A actions · Ctrl+L list
          </Text>

          <Box marginTop={1} flexDirection="column">
            {surfaces.length === 0 ? (
              <Text color="yellow">No surface yet — Ctrl+S to apply the next message</Text>
            ) : (
              surfaces.map(surface => (
                <Box
                  key={surface.id}
                  flexDirection="column"
                  borderStyle="round"
                  borderColor="gray"
                  padding={1}
                  marginBottom={1}
                >
                  <A2uiSurface surface={surface} />
                </Box>
              ))
            )}
          </Box>

          {showData ? surfaces.map(s => <DataModelPanel key={`data-${s.id}`} surface={s} />) : null}

          {showActions ? (
            <Box
              flexDirection="column"
              borderStyle="single"
              borderColor="green"
              paddingX={1}
              marginTop={1}
            >
              <Text bold color="green">
                actions
              </Text>
              {logs.length === 0 ? (
                <Text dimColor>(none yet)</Text>
              ) : (
                logs.slice(-5).map((log, i) => (
                  <Text key={`${i}-${log.time}-${log.name}`} color="yellow">
                    ⚡ {log.time} {log.name} ← {log.source}
                  </Text>
                ))
              )}
            </Box>
          ) : null}
        </Box>
      ) : (
        <Text color="red">No example selected</Text>
      )}
    </Box>
  );
}
