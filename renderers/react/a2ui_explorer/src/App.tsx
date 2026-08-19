/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {useState, useEffect, useSyncExternalStore, useCallback, useRef} from 'react';
import {MessageProcessor, type SurfaceModel, type A2uiClientAction} from '@a2ui/web_core/v0_9';
import {
  basicCatalog,
  A2uiSurface,
  MarkdownContext,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {getDemoItems} from './examples';
import {renderMarkdown} from '@a2ui/markdown-it';
import styles from './App.module.css';

const demoItems = getDemoItems();

const DataModelViewer = ({surface}: {surface: SurfaceModel<ReactComponentImplementation>}) => {
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

/**
 * Properties for the main explorer application component.
 */
export interface AppProps {
  /**
   * Id of the example to select on initial component load.
   * @internal @visibleForTesting
   */
  initialExampleId?: string;
  /**
   * Callback to intercept dispatched actions.
   * @internal @visibleForTesting
   */
  onAction?: (action: A2uiClientAction) => void;
}

/**
 * Represents an entry in the explorer action dispatch log.
 */
interface LogEntry {
  /** ISO timestamp of when the action was intercepted. */
  time: string;
  /** The intercepted client action object. */
  action: A2uiClientAction;
}

export const App = ({initialExampleId, onAction}: AppProps) => {
  const [selectedExampleId, setSelectedExampleId] = useState(initialExampleId ?? demoItems[0].id);
  const selectedItem = demoItems.find(e => e.id === selectedExampleId);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [processor, setProcessor] = useState<MessageProcessor<ReactComponentImplementation> | null>(
    null,
  );
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(-1);

  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(() => {
    try {
      return (
        typeof window !== 'undefined' && localStorage.getItem('isLeftSidebarCollapsed') === 'true'
      );
    } catch {
      return false;
    }
  });

  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(() => {
    try {
      return (
        typeof window !== 'undefined' && localStorage.getItem('isRightSidebarCollapsed') === 'true'
      );
    } catch {
      return false;
    }
  });

  const navListRef = useRef<HTMLDivElement | null>(null);

  const toggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarCollapsed(prev => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('isLeftSidebarCollapsed', String(next));
        }
      } catch {
        // Ignore in restricted environments
      }
      return next;
    });
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setIsRightSidebarCollapsed(prev => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('isRightSidebarCollapsed', String(next));
        }
      } catch {
        // Ignore in restricted environments
      }
      return next;
    });
  }, []);

  const scrollToActiveExample = useCallback(() => {
    setTimeout(() => {
      const activeEl = navListRef.current?.querySelector(`.${styles.navItem}.${styles.active}`);
      activeEl?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }, 0);
  }, []);

  const onActionRef = useRef(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  // Handle keyboard shortcuts ('j' and 'k')
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeEl =
        typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      const targetEl = event.target as HTMLElement | null;
      const focusedEl = (activeEl && activeEl.isConnected ? activeEl : null) || targetEl;

      if (
        focusedEl &&
        (focusedEl.tagName === 'INPUT' ||
          focusedEl.tagName === 'TEXTAREA' ||
          focusedEl.tagName === 'SELECT' ||
          focusedEl.isContentEditable)
      ) {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key === 'j') {
        setSelectedExampleId(prevId => {
          const currentIndex = demoItems.findIndex(e => e.id === prevId);
          const nextIndex = currentIndex < demoItems.length - 1 ? currentIndex + 1 : 0;
          return demoItems[nextIndex].id;
        });
        event.preventDefault();
      } else if (event.key === 'k') {
        setSelectedExampleId(prevId => {
          const currentIndex = demoItems.findIndex(e => e.id === prevId);
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : demoItems.length - 1;
          return demoItems[prevIndex].id;
        });
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Initialize or reset processor
  const resetProcessor = useCallback(
    (advanceToEnd: boolean = false) => {
      setProcessor(prevProcessor => {
        if (prevProcessor) {
          prevProcessor.model.dispose();
        }
        const newProcessor = new MessageProcessor<ReactComponentImplementation>(
          [basicCatalog],
          async (action: A2uiClientAction) => {
            setLogs(l => [...l, {time: new Date().toISOString(), action}]);
            if (onActionRef.current) {
              onActionRef.current(action);
            }
          },
        );

        const msgs = selectedItem?.messages;
        if (advanceToEnd && msgs) {
          newProcessor.processMessages(structuredClone(msgs));
        }
        return newProcessor;
      });

      setLogs([]);
      setSurfaces([]);

      const msgs = selectedItem?.messages;
      if (advanceToEnd && msgs) {
        setCurrentMessageIndex(msgs.length - 1);
      } else {
        setCurrentMessageIndex(-1);
      }
    },
    [selectedItem],
  );

  // Effect to handle example selection change
  useEffect(() => {
    resetProcessor(true);
    scrollToActiveExample();
    // Cleanup on unmount or when changing examples
    return () => {
      setProcessor(prev => {
        if (prev) prev.model.dispose();
        return null;
      });
    };
  }, [selectedExampleId, resetProcessor, scrollToActiveExample]);

  // Handle surface subscriptions
  useEffect(() => {
    if (!processor) {
      setSurfaces([]);
      return;
    }

    const updateSurfaces = () => {
      setSurfaces(Array.from(processor.model.surfacesMap.values()).map(s => s.id));
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
    const msgs = selectedItem?.messages;
    if (!processor || !msgs) return;

    // Process messages from currentMessageIndex + 1 to index
    const messagesToProcess = msgs.slice(currentMessageIndex + 1, index + 1);
    if (messagesToProcess.length > 0) {
      processor.processMessages(structuredClone(messagesToProcess));
      setCurrentMessageIndex(index);
    }
  };

  const handleReset = () => {
    resetProcessor(false);
  };

  const messages = selectedItem?.messages ?? [];

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div>
            <h1 className={styles.h1}>A2UI React Explorer</h1>
            <p className={styles.subtitle}>Preview and interact with React components</p>
          </div>
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
        <nav
          className={`${styles.navPane} ${isLeftSidebarCollapsed ? styles.collapsed : ''}`}
          aria-label="Examples Navigation"
        >
          <div className={styles.navHeader}>
            <h3 className={styles.navHeaderTitle}>Examples</h3>
            <button
              className={`${styles.iconBtn} ${styles.collapseLeftBtn}`}
              onClick={toggleLeftSidebar}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          </div>
          <div className={styles.navList} ref={navListRef}>
            {demoItems.map(item => {
              const isActive = selectedExampleId === item.id;
              return (
                <button
                  key={item.id}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                  onClick={() => setSelectedExampleId(item.id)}
                >
                  <div className={styles.navTitle}>{item.title}</div>
                  <div className={styles.navDesc}>{item.description}</div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Center Column: Preview & JSON Stepper */}
        <div className={styles.galleryPane}>
          <div className={styles.previewHeader}>
            <div className={styles.previewHeaderLeft}>
              {isLeftSidebarCollapsed && (
                <button
                  className={`${styles.iconBtn} ${styles.expandLeftBtn}`}
                  onClick={toggleLeftSidebar}
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              )}
              <div>
                <h2>{selectedItem?.title || 'No selection'}</h2>
                <p className={styles.subtitle}>{selectedItem?.description}</p>
              </div>
            </div>
            <div className={styles.previewHeaderRight}>
              {isRightSidebarCollapsed && (
                <button
                  className={`${styles.iconBtn} ${styles.expandRightBtn}`}
                  onClick={toggleRightSidebar}
                  title="Expand inspector"
                  aria-label="Expand inspector"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </button>
              )}
            </div>
          </div>

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
              {messages.map((msg, i) => {
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
        <aside
          className={`${styles.inspectorPane} ${isRightSidebarCollapsed ? styles.collapsed : ''}`}
          aria-label="Inspector Panel"
        >
          <div className={styles.inspectorPaneHeader}>
            <h4 className={styles.inspectorPaneTitle}>Inspector</h4>
            <button
              className={`${styles.iconBtn} ${styles.collapseRightBtn}`}
              onClick={toggleRightSidebar}
              title="Collapse inspector"
              aria-label="Collapse inspector"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

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
        </aside>
      </main>
    </div>
  );
};
