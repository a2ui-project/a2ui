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

import {useState, useEffect, useCallback, useRef} from 'react';
import {MessageProcessor, type A2uiClientAction} from '@a2ui/web_core/v0_9';
import {A2uiSurface, MarkdownContext, type ReactCatalogComponent} from '@a2ui/react';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {demoCatalog} from './demo-catalog';
import {getDemoItems, type DemoItem} from './examples';
import {renderMarkdown} from '@a2ui/markdown-it';
import styles from './App.module.css';

const demoItemsV09 = getDemoItems('v0.9');
const demoItemsV10 = getDemoItems('v1.0');

function formatTime(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function applyPrimaryColorToMessages(
  messages: Record<string, unknown>[],
  primaryColor: string,
): Record<string, unknown>[] {
  if (!primaryColor) return messages;
  return messages.map(msg => {
    if (
      msg &&
      typeof msg === 'object' &&
      'createSurface' in msg &&
      msg.version !== 'v1.0' &&
      msg.createSurface &&
      typeof msg.createSurface === 'object'
    ) {
      const createSurface = msg.createSurface as Record<string, unknown>;
      const existingTheme =
        createSurface.theme && typeof createSurface.theme === 'object'
          ? (createSurface.theme as Record<string, unknown>)
          : {};
      return {
        ...msg,
        createSurface: {
          ...createSurface,
          theme: {
            ...existingTheme,
            primaryColor,
          },
        },
      };
    }
    return msg;
  });
}

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
   * Protocol version to select on initial component load. Defaults to 'v0.9'.
   * @internal @visibleForTesting
   */
  initialVersion?: 'v0.9' | 'v1.0';
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
  /** Formatted HH:mm:ss.SSS timestamp of when the event occurred. */
  timestamp: string;
  /** Event badge label (action name or 'Error'). */
  type: string;
  /** The intercepted payload object. */
  detail: unknown;
}

function getLocalStorageBool(key: string): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function setLocalStorageBool(key: string, value: boolean) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // Ignore in restricted environments
  }
}

export const App = ({initialExampleId, initialVersion, onAction}: AppProps) => {
  const [selectedVersion, setSelectedVersion] = useState<'v0.9' | 'v1.0'>(() => {
    if (initialVersion) {
      return initialVersion;
    }
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const version = urlParams.get('version');
      if (version === 'v1.0' || version === '1.0') {
        return 'v1.0';
      }
    }
    return 'v0.9';
  });

  const demoItems: DemoItem[] = selectedVersion === 'v1.0' ? demoItemsV10 : demoItemsV09;

  const [selectedExampleId, setSelectedExampleId] = useState<string>(() => {
    if (initialExampleId) {
      return initialExampleId;
    }
    if (typeof window !== 'undefined') {
      const rawHash = window.location.hash.slice(1);
      if (rawHash) {
        const matched = demoItems.find(
          item =>
            item.id === rawHash ||
            item.filename === rawHash ||
            (item.filename ?? '').replace('.json', '') === rawHash,
        );
        if (matched) {
          return matched.id;
        }
      }
    }
    return demoItems[0]?.id ?? '';
  });

  const selectedItem = demoItems.find(e => e.id === selectedExampleId) ?? demoItems[0];

  const [customMessages, setCustomMessages] = useState<Record<string, unknown>[] | null>(null);
  const [primaryColor, setPrimaryColor] = useState<string>('#1177ee');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [processor, setProcessor] = useState<MessageProcessor<ReactCatalogComponent> | null>(null);
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [processedMessageCount, setProcessedMessageCount] = useState(0);

  const [currentCreateSurfaceMessageText, setCurrentCreateSurfaceMessageText] = useState('');
  const [messageError, setMessageError] = useState<string | null>(null);
  const [currentDataModelText, setCurrentDataModelText] = useState('{}');
  const [dataModelError, setDataModelError] = useState<string | null>(null);
  const jsonInputFocusedRef = useRef(false);

  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(() =>
    getLocalStorageBool('isLeftSidebarCollapsed'),
  );
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(() =>
    getLocalStorageBool('isRightSidebarCollapsed'),
  );
  const [isSurfaceMessageFolded, setIsSurfaceMessageFolded] = useState(() =>
    getLocalStorageBool('isSurfaceMessageFolded'),
  );
  const [isDataModelFolded, setIsDataModelFolded] = useState(() =>
    getLocalStorageBool('isDataModelFolded'),
  );
  const [isEventsLogFolded, setIsEventsLogFolded] = useState(() =>
    getLocalStorageBool('isEventsLogFolded'),
  );

  const navListRef = useRef<HTMLDivElement | null>(null);

  const selectExampleById = useCallback((id: string) => {
    setCustomMessages(null);
    setMessageError(null);
    setDataModelError(null);
    setSelectedExampleId(id);
  }, []);

  const handleVersionChange = (newVersion: 'v0.9' | 'v1.0') => {
    if (newVersion === selectedVersion) return;
    const currentFilename = selectedItem?.filename;
    setSelectedVersion(newVersion);
    setCustomMessages(null);
    const items = newVersion === 'v1.0' ? demoItemsV10 : demoItemsV09;
    if (items.length > 0) {
      const matched = currentFilename ? items.find(i => i.filename === currentFilename) : undefined;
      setSelectedExampleId((matched ?? items[0]).id);
    }
  };

  // Sync URL query (?version=) and hash (#<example-id>)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('version', selectedVersion === 'v1.0' ? '1.0' : '0.9');
      if (selectedItem?.filename) {
        url.hash = selectedItem.filename.replace('.json', '');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore URL update errors in test environments
    }
  }, [selectedVersion, selectedItem]);

  // Listen for external hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const rawHash = window.location.hash.slice(1);
      if (!rawHash) return;
      const matched = demoItems.find(
        item =>
          item.id === rawHash ||
          item.filename === rawHash ||
          (item.filename ?? '').replace('.json', '') === rawHash,
      );
      if (matched && matched.id !== selectedExampleId) {
        selectExampleById(matched.id);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [demoItems, selectedExampleId, selectExampleById]);

  const toggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarCollapsed(prev => {
      const next = !prev;
      setLocalStorageBool('isLeftSidebarCollapsed', next);
      return next;
    });
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setIsRightSidebarCollapsed(prev => {
      const next = !prev;
      setLocalStorageBool('isRightSidebarCollapsed', next);
      return next;
    });
  }, []);

  const toggleSurfaceMessage = useCallback(() => {
    setIsSurfaceMessageFolded(prev => {
      const next = !prev;
      setLocalStorageBool('isSurfaceMessageFolded', next);
      return next;
    });
  }, []);

  const toggleDataModel = useCallback(() => {
    setIsDataModelFolded(prev => {
      const next = !prev;
      setLocalStorageBool('isDataModelFolded', next);
      return next;
    });
  }, []);

  const toggleEventsLog = useCallback(() => {
    setIsEventsLogFolded(prev => {
      const next = !prev;
      setLocalStorageBool('isEventsLogFolded', next);
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
        setCustomMessages(null);
        setSelectedExampleId(prevId => {
          const currentIndex = demoItems.findIndex(e => e.id === prevId);
          const nextIndex = currentIndex < demoItems.length - 1 ? currentIndex + 1 : 0;
          return demoItems[nextIndex].id;
        });
        event.preventDefault();
      } else if (event.key === 'k') {
        setCustomMessages(null);
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
  }, [demoItems]);

  const activeMessages = customMessages ?? selectedItem?.messages ?? [];

  const createFreshProcessor = useCallback(() => {
    const newProcessor = new MessageProcessor<ReactCatalogComponent>(
      [demoCatalog, basicCatalogV10],
      async (action: A2uiClientAction) => {
        setLogs(l => [
          {
            timestamp: formatTime(new Date()),
            type: action.name || 'Action',
            detail: action,
          },
          ...l,
        ]);
        if (onActionRef.current) {
          onActionRef.current(action);
        }
      },
    );

    newProcessor.model.onSurfaceCreated.subscribe(surface => {
      surface.onError.subscribe(err => {
        setLogs(l => [
          {
            timestamp: formatTime(new Date()),
            type: 'Error',
            detail: err,
          },
          ...l,
        ]);
      });
    });

    return newProcessor;
  }, []);

  // Initialize or reset processor
  const resetProcessor = useCallback(
    (advanceToEnd: boolean = false) => {
      const modifiedMsgs = applyPrimaryColorToMessages(activeMessages, primaryColor);
      const createMsg = modifiedMsgs.find(m => 'createSurface' in m);
      if (createMsg && !jsonInputFocusedRef.current) {
        setCurrentCreateSurfaceMessageText(JSON.stringify(createMsg, null, 2));
        setMessageError(null);
      }

      setProcessor(prevProcessor => {
        if (prevProcessor) {
          prevProcessor.model.dispose();
        }
        const newProcessor = createFreshProcessor();
        if (advanceToEnd && modifiedMsgs.length > 0) {
          newProcessor.processMessages(
            structuredClone(modifiedMsgs) as Parameters<typeof newProcessor.processMessages>[0],
          );
        }
        return newProcessor;
      });

      setLogs([]);
      setSurfaces([]);
      setDataModelError(null);

      if (advanceToEnd && modifiedMsgs.length > 0) {
        setProcessedMessageCount(modifiedMsgs.length);
      } else {
        setProcessedMessageCount(0);
        if (!jsonInputFocusedRef.current) {
          setCurrentDataModelText('{}');
        }
      }
    },
    [activeMessages, primaryColor, createFreshProcessor],
  );

  // Effect to handle example, custom message, or primary color change
  useEffect(() => {
    resetProcessor(true);
    scrollToActiveExample();
    return () => {
      setProcessor(prev => {
        if (prev) prev.model.dispose();
        return null;
      });
    };
  }, [selectedExampleId, resetProcessor, scrollToActiveExample]);

  // Handle surface subscriptions & dataModel synchronization
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

  useEffect(() => {
    if (!processor || surfaces.length === 0) return;
    const primarySurface = processor.model.getSurface(surfaces[0]);
    if (!primarySurface) return;

    const sub = primarySurface.dataModel.subscribe('/', val => {
      if (!jsonInputFocusedRef.current) {
        setCurrentDataModelText(JSON.stringify(val || {}, null, 2));
        setDataModelError(null);
      }
    });

    return () => sub.unsubscribe();
  }, [processor, surfaces]);

  const advanceMessages = (all: boolean) => {
    if (!processor || activeMessages.length === 0) return;
    const toProcess = all
      ? activeMessages.slice(processedMessageCount)
      : activeMessages.slice(processedMessageCount, processedMessageCount + 1);

    if (toProcess.length === 0) return;

    const modifiedToProcess = applyPrimaryColorToMessages(toProcess, primaryColor);
    const createMsg = modifiedToProcess.find(m => 'createSurface' in m);
    if (createMsg && !jsonInputFocusedRef.current) {
      setCurrentCreateSurfaceMessageText(JSON.stringify(createMsg, null, 2));
      setMessageError(null);
    }

    processor.processMessages(
      structuredClone(modifiedToProcess) as Parameters<typeof processor.processMessages>[0],
    );
    setProcessedMessageCount(prev => prev + toProcess.length);
    setSurfaces(Array.from(processor.model.surfacesMap.values()).map(s => s.id));
  };

  const handleReset = () => {
    resetProcessor(false);
  };

  const handleSurfaceMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setCurrentCreateSurfaceMessageText(newValue);

    try {
      const parsed = JSON.parse(newValue);
      setMessageError(null);
      if (!parsed || typeof parsed !== 'object' || !('createSurface' in parsed)) {
        return;
      }
      const baseMessages = customMessages ?? selectedItem?.messages ?? [];
      setCustomMessages(baseMessages.map(m => ('createSurface' in m ? parsed : m)));
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleSurfaceMessageBlur = () => {
    jsonInputFocusedRef.current = false;
    try {
      const parsed = JSON.parse(currentCreateSurfaceMessageText);
      setCurrentCreateSurfaceMessageText(JSON.stringify(parsed, null, 2));
    } catch {
      // Ignore if invalid
    }
  };

  const handleDataModelChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setCurrentDataModelText(newValue);

    try {
      const parsed = JSON.parse(newValue);
      setDataModelError(null);
      if (processor && surfaces.length > 0) {
        const surface = processor.model.getSurface(surfaces[0]);
        surface?.dataModel.set('/', parsed);
      }
    } catch (err) {
      setDataModelError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleDataModelBlur = () => {
    jsonInputFocusedRef.current = false;
    try {
      const parsed = JSON.parse(currentDataModelText);
      setCurrentDataModelText(JSON.stringify(parsed, null, 2));
    } catch {
      // Ignore if invalid
    }
  };

  const handleSectionKeyDown = (e: React.KeyboardEvent, toggleFn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFn();
    }
  };

  const canAdvance = processedMessageCount < activeMessages.length;

  return (
    <div className={styles.app}>
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          </div>
          <div className={styles.navList} ref={navListRef}>
            {demoItems.map(item => {
              const isActive = selectedExampleId === item.id;
              return (
                <div
                  key={item.id}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                  onClick={() => selectExampleById(item.id)}
                >
                  <h3 className={styles.navTitle}>{item.title}</h3>
                  <p className={styles.navDesc}>{item.filename}</p>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Center Column: Combined Header & Surface Preview */}
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
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              )}
              <div className={styles.appBrand}>
                <h1 className={styles.h1}>A2UI React Explorer</h1>
              </div>
            </div>
            <div className={styles.agentControls}>
              <fieldset className={styles.versionControls}>
                <legend>Spec version</legend>
                <div
                  className={styles.versionSelector}
                  role="group"
                  aria-label="Specification version"
                >
                  <button
                    className={`${styles.versionBtn} ${selectedVersion === 'v0.9' ? styles.versionBtnActive : ''}`}
                    data-version="0.9"
                    onClick={() => handleVersionChange('v0.9')}
                  >
                    v0.9
                  </button>
                  <button
                    className={`${styles.versionBtn} ${selectedVersion === 'v1.0' ? styles.versionBtnActive : ''}`}
                    data-version="1.0"
                    onClick={() => handleVersionChange('v1.0')}
                  >
                    v1.0
                  </button>
                </div>
              </fieldset>
              <fieldset className={styles.messageControls}>
                <legend>
                  Messages: {processedMessageCount} / {activeMessages.length}
                </legend>
                <button className={styles.button} onClick={handleReset}>
                  Reset
                </button>
                <button
                  className={styles.button}
                  onClick={() => advanceMessages(false)}
                  disabled={!canAdvance}
                >
                  +1 Message
                </button>
                <button
                  className={styles.button}
                  onClick={() => advanceMessages(true)}
                  disabled={!canAdvance}
                >
                  All Messages
                </button>
              </fieldset>
              <fieldset className={styles.themeControls}>
                <legend>Primary color</legend>
                <div className={styles.colorInputGroup}>
                  <input
                    type="color"
                    value={primaryColor || '#1177ee'}
                    onChange={e => setPrimaryColor(e.target.value)}
                    className={styles.colorInput}
                    aria-label="Primary color"
                  />
                  <button className={styles.button} onClick={() => setPrimaryColor('')}>
                    Clear
                  </button>
                </div>
              </fieldset>
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
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
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
                <div style={{color: '#64748b', textAlign: 'center'}}>
                  Surface not initialized. Click &apos;+1 Message&apos; to begin.
                </div>
              )}
              {surfaces.map(surfaceId => {
                const surface = processor?.model.getSurface(surfaceId);
                if (!surface) return null;
                return (
                  <div key={surfaceId}>
                    <MarkdownContext.Provider value={renderMarkdown}>
                      <A2uiSurface surface={surface} />
                    </MarkdownContext.Provider>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Inspector Panel */}
        <aside
          className={`${styles.inspectorPane} ${isRightSidebarCollapsed ? styles.collapsed : ''}`}
          aria-label="Inspector Panel"
        >
          <div className={styles.inspectorPaneHeader}>
            <div className={styles.exampleInfo}>
              <h2>{selectedItem?.title || 'No selection'}</h2>
              <p className={styles.subtitle}>{selectedItem?.description}</p>
            </div>
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

          <div
            className={`${styles.inspectorSection} ${styles.surfaceSection} ${isSurfaceMessageFolded ? styles.folded : ''}`}
          >
            <div
              className={styles.inspectorHeader}
              role="button"
              tabIndex={0}
              aria-expanded={!isSurfaceMessageFolded}
              onClick={toggleSurfaceMessage}
              onKeyDown={e => handleSectionKeyDown(e, toggleSurfaceMessage)}
            >
              <div className={styles.headerLeft}>
                <span
                  className={`${styles.toggleIcon} ${!isSurfaceMessageFolded ? styles.expanded : ''}`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
                <h4 className={styles.sectionTitle}>Create Surface Message</h4>
              </div>
              <div>
                <span className={`${styles.badge} ${messageError ? styles.errorBadge : ''}`}>
                  {messageError ? 'Invalid' : 'Live'}
                </span>
              </div>
            </div>
            {!isSurfaceMessageFolded && (
              <div className={styles.inspectorBody}>
                {messageError && (
                  <div className={styles.errorMessage}>
                    <span>⚠️</span>
                    <span>{messageError}</span>
                  </div>
                )}
                <textarea
                  className={styles.surfaceMessageTextarea}
                  value={currentCreateSurfaceMessageText}
                  onChange={handleSurfaceMessageChange}
                  onFocus={() => {
                    jsonInputFocusedRef.current = true;
                  }}
                  onBlur={handleSurfaceMessageBlur}
                  aria-label="Create Surface Message JSON"
                />
              </div>
            )}
          </div>

          <div
            className={`${styles.inspectorSection} ${styles.dataSection} ${isDataModelFolded ? styles.folded : ''}`}
          >
            <div
              className={styles.inspectorHeader}
              role="button"
              tabIndex={0}
              aria-expanded={!isDataModelFolded}
              onClick={toggleDataModel}
              onKeyDown={e => handleSectionKeyDown(e, toggleDataModel)}
            >
              <div className={styles.headerLeft}>
                <span
                  className={`${styles.toggleIcon} ${!isDataModelFolded ? styles.expanded : ''}`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
                <h4 className={styles.sectionTitle}>Data Model</h4>
              </div>
              <div>
                <span className={`${styles.badge} ${dataModelError ? styles.errorBadge : ''}`}>
                  {dataModelError ? 'Invalid' : 'Live'}
                </span>
              </div>
            </div>
            {!isDataModelFolded && (
              <div className={styles.inspectorBody}>
                {dataModelError && (
                  <div className={styles.errorMessage}>
                    <span>⚠️</span>
                    <span>{dataModelError}</span>
                  </div>
                )}
                <textarea
                  className={styles.dataModelTextarea}
                  value={currentDataModelText}
                  onChange={handleDataModelChange}
                  onFocus={() => {
                    jsonInputFocusedRef.current = true;
                  }}
                  onBlur={handleDataModelBlur}
                  aria-label="Data Model JSON"
                />
              </div>
            )}
          </div>

          <div
            className={`${styles.inspectorSection} ${styles.eventsSection} ${isEventsLogFolded ? styles.folded : ''}`}
          >
            <div
              className={styles.inspectorHeader}
              role="button"
              tabIndex={0}
              aria-expanded={!isEventsLogFolded}
              onClick={toggleEventsLog}
              onKeyDown={e => handleSectionKeyDown(e, toggleEventsLog)}
            >
              <div className={styles.headerLeft}>
                <span
                  className={`${styles.toggleIcon} ${!isEventsLogFolded ? styles.expanded : ''}`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
                <h4 className={styles.sectionTitle}>Action Logs</h4>
              </div>
              <div>
                <button
                  className={styles.clearLogsBtn}
                  onClick={e => {
                    e.stopPropagation();
                    setLogs([]);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            {!isEventsLogFolded && (
              <div className={styles.inspectorBody}>
                {logs.length === 0 ? (
                  <div className={styles.emptyState}>No actions logged...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={styles.logItem}>
                      <div className={styles.logHeader}>
                        <span className={styles.logTime}>{log.timestamp}</span>
                        <span className={styles.logType}>{log.type}</span>
                      </div>
                      <pre className={styles.logDetails}>{JSON.stringify(log.detail, null, 2)}</pre>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};
