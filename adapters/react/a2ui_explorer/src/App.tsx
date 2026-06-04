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

import {useState, useEffect, useSyncExternalStore, useCallback} from 'react';
import {MessageProcessor, SurfaceModel} from '@a2ui/web_core/v0_9';
import {
  basicCatalog,
  A2uiSurface,
  MarkdownContext,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {exampleFiles, getMessages} from './examples';
import {renderMarkdown} from '@a2ui/markdown-it';
import styles from './App.module.css';

const DataModelViewer = ({surface}: {surface: SurfaceModel<any>}) => {
  const subscribeHook = useCallback(
    (callback: () => void) => {
      const bound = surface.dataModel.subscribe('/', callback);
      return () => bound.unsubscribe();
    },
    [surface],
  );

  const getSnapshot = useCallback(() => {
    return JSON.stringify(surface.dataModel.get('/'), null, 2);
  }, [surface]);

  const dataString = useSyncExternalStore(subscribeHook, getSnapshot);

  return (
    <div style={{marginBottom: '1rem'}}>
      <strong>Surface: {surface.id}</strong>
      <pre style={{fontSize: '12px', margin: 0, whiteSpace: 'pre-wrap'}}>{dataString}</pre>
    </div>
  );
};

export default function App() {
  const [selectedExampleKey, setSelectedExampleKey] = useState(exampleFiles[0].key);
  const selectedExample = exampleFiles.find(e => e.key === selectedExampleKey)?.data as any;

  const [logs, setLogs] = useState<any[]>([]);
  const [processor, setProcessor] = useState<MessageProcessor<ReactComponentImplementation> | null>(
    null,
  );
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(-1);

  // Initialize or reset processor
  const resetProcessor = useCallback(
    (advanceToEnd: boolean = false) => {
      setProcessor(prevProcessor => {
        if (prevProcessor) {
          prevProcessor.model.dispose();
        }
        const newProcessor = new MessageProcessor<ReactComponentImplementation>(
          [basicCatalog],
          async (action: any) => {
            setLogs(l => [...l, {time: new Date().toISOString(), action}]);
          },
        );

        const msgs = getMessages(selectedExample);
        if (advanceToEnd && msgs) {
          newProcessor.processMessages(msgs);
        }
        return newProcessor;
      });

      setLogs([]);
      setSurfaces([]);

      const msgs = getMessages(selectedExample);
      if (advanceToEnd && msgs) {
        setCurrentMessageIndex(msgs.length - 1);
      } else {
        setCurrentMessageIndex(-1);
      }
    },
    [selectedExample],
  );

  // Effect to handle example selection change
  useEffect(() => {
    resetProcessor(true);
    // Cleanup on unmount or when changing examples
    return () => {
      setProcessor(prev => {
        if (prev) prev.model.dispose();
        return null;
      });
    };
  }, [selectedExampleKey, resetProcessor]);

  // Handle surface subscriptions
  useEffect(() => {
    if (!processor) {
      setSurfaces([]);
      return;
    }

    const updateSurfaces = () => {
      setSurfaces(Array.from(processor.model.surfacesMap.values()).map((s: any) => s.id as string));
    };

    updateSurfaces();

    const unsub1 = processor.model.onSurfaceCreated.subscribe(updateSurfaces);
    const unsub2 = processor.model.onSurfaceDeleted.subscribe(updateSurfaces);

    return () => {
      unsub1.unsubscribe();
      unsub2.unsubscribe();
    };
  }, [processor]);

  const advanceToMessage = (index: number) => {
    const msgs = getMessages(selectedExample);
    if (!processor || !msgs) return;

    // Process messages from currentMessageIndex + 1 to index
    const messagesToProcess = msgs.slice(currentMessageIndex + 1, index + 1);
    if (messagesToProcess.length > 0) {
      processor.processMessages(messagesToProcess);
      setCurrentMessageIndex(index);
    }
  };

  const handleReset = () => {
    resetProcessor(false);
  };

  const messages = getMessages(selectedExample) || [];

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.h1}>A2UI React Explorer</h1>
          <p className={styles.subtitle}>Preview and interact with React components</p>
        </div>
        <div className={styles.stepperControls}>
          <span>
            Message {currentMessageIndex + 1} of {messages.length}
          </span>
          <button className={styles.button} onClick={handleReset}>
            Reset
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {/* Left Column: Sample List */}
        <div className={styles.navPane}>
          {exampleFiles.map(ex => {
            const isActive = selectedExampleKey === ex.key;
            return (
              <button
                key={ex.key}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                onClick={() => setSelectedExampleKey(ex.key)}
              >
                <div className={styles.navTitle}>{(ex.data as any).name || ex.key}</div>
                <div className={styles.navDesc}>{ex.catalog}</div>
              </button>
            );
          })}
        </div>

        {/* Center Column: Preview & JSON Stepper */}
        <div className={styles.galleryPane}>
          <div className={styles.previewContent}>
            <div className={styles.surfaceContainer}>
              {surfaces.length === 0 && (
                <p style={{color: '#888', textAlign: 'center'}}>
                  No surfaces loaded. Advance the stepper to create one.
                </p>
              )}
              {surfaces.map(surfaceId => {
                const surface = processor?.model.getSurface(surfaceId);
                if (!surface) return null;
                return (
                  <div key={surfaceId} style={{marginBottom: '2rem'}}>
                    <MarkdownContext.Provider value={renderMarkdown}>
                      <A2uiSurface surface={surface} />
                    </MarkdownContext.Provider>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Messages Stepper at the bottom of gallery pane */}
          <div
            style={{
              height: '200px',
              borderTop: '1px solid rgba(148, 163, 184, 0.1)',
              padding: '1rem',
              overflowY: 'auto',
              background: '#1e293b',
            }}
          >
            <h3 style={{margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#94a3b8'}}>MESSAGES</h3>
            <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
              {messages.map((msg: any, i: number) => {
                const isActive = i <= currentMessageIndex;
                return (
                  <div
                    key={i}
                    style={{
                      border: '1px solid',
                      borderColor: isActive ? '#38bdf8' : '#475569',
                      opacity: isActive ? 1 : 0.6,
                      padding: '8px',
                      borderRadius: '4px',
                      background: isActive ? 'rgba(56, 189, 248, 0.1)' : '#0f172a',
                      color: '#f1f5f9',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}
                    >
                      <strong>Message {i + 1}</strong>
                      {!isActive && (
                        <button
                          className={styles.button}
                          onClick={() => advanceToMessage(i)}
                          style={{padding: '2px 8px', fontSize: '0.8rem'}}
                        >
                          Advance
                        </button>
                      )}
                    </div>
                    <pre
                      style={{
                        fontSize: '11px',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        maxHeight: '100px',
                        overflowY: 'auto',
                        fontFamily: 'monospace',
                      }}
                    >
                      {JSON.stringify(msg, null, 2)}
                    </pre>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Live DataModelViewer & Action Logs */}
        <div className={styles.inspectorPane}>
          <div className={styles.inspectorSection}>
            <h3 className={styles.inspectorHeader}>Data Model</h3>
            <div className={styles.inspectorBody}>
              {surfaces.length === 0 ? (
                <p style={{color: '#888', fontSize: '12px'}}>Empty Data Model</p>
              ) : null}
              {surfaces.map(surfaceId => {
                const surface = processor?.model.getSurface(surfaceId);
                if (!surface) return null;
                return <DataModelViewer key={surfaceId} surface={surface} />;
              })}
            </div>
          </div>

          <div className={styles.inspectorSection}>
            <h3 className={styles.inspectorHeader}>Action Logs</h3>
            <div className={styles.inspectorBody}>
              <div className={styles.logList}>
                {logs.length === 0 ? (
                  <p style={{color: '#888', fontSize: '12px'}}>No actions logged yet.</p>
                ) : null}
                {logs.map((log, i) => (
                  <div key={i} className={styles.logEntry}>
                    <strong style={{display: 'block', color: '#38bdf8'}}>{log.time}</strong>
                    <pre
                      style={{
                        margin: '4px 0 0 0',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(log.action, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
