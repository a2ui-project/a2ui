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

import {useState, useEffect, useRef} from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
import {FeedItem} from '../types';
import {A2UI_THEME_VARS} from '../theme';
import {API_BASE_URL} from '../config';

const PRESET_BUTTONS = [
  {
    label: '🔒 Verified Salary',
    prompt: 'show verified salary',
    desc: 'Dynamic server-resolved compensation',
  },
  {
    label: '💰 Payroll Summary',
    prompt: 'show payroll summary',
    desc: 'Programmatic dynamic template table',
  },
  {
    label: '📊 User Evaluation',
    prompt: 'show user evaluation',
    desc: 'Composite review & goals dashboard',
  },
  {
    label: '👤 User Profile',
    prompt: 'show user profile',
    desc: 'Single card profile',
  },
  {
    label: '👥 Team Roster',
    prompt: 'show team roster',
    desc: 'Nested team member cards',
  },
  {
    label: '🎯 Team Goals',
    prompt: 'show team goals',
    desc: 'Unrolled objectives list',
  },
  {
    label: '💬 Feedback Board',
    prompt: 'show feedback board',
    desc: 'Review cards with ratings',
  },
  {
    label: '⭐ Competency Panel',
    prompt: 'show competency panel',
    desc: 'Metrics & stats summary',
  },
];

const SUGGESTED_PROMPTS = [
  {
    icon: 'lock',
    text: 'Show verified salary for Marcus Vance',
    badge: 'Dynamic',
  },
  {
    icon: 'person',
    text: 'Show user profile for Alice Smith',
    badge: 'Macro',
  },
  {
    icon: 'flag',
    text: 'Show team goals for Core Protocol Engineering',
    badge: 'Macro',
  },
  {
    icon: 'reviews',
    text: 'Show feedback board for Frontend Guild',
    badge: 'Macro',
  },
  {
    icon: 'groups',
    text: 'Show team roster with Core Architecture',
    badge: 'Macro',
  },
  {
    icon: 'monitoring',
    text: 'Show user evaluation for Alice Smith',
    badge: 'Composite',
  },
];

export function ChatView() {
  const [chatProcessor] = useState(() => new MessageProcessor([basicCatalog]));
  const [, setChatTick] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeInspector, setActiveInspector] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'express' | 'json'>('express');
  const [copiedTurn, setCopiedTurn] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const forceUpdate = () => setChatTick(t => t + 1);
    const subCreated = chatProcessor.onSurfaceCreated(forceUpdate);
    const subDeleted = chatProcessor.onSurfaceDeleted(forceUpdate);
    return () => {
      subCreated.unsubscribe();
      subDeleted.unsubscribe();
    };
  }, [chatProcessor]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [feed, loading]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTurn(true);
    setTimeout(() => setCopiedTurn(false), 2000);
  };

  const sendPrompt = async (promptText: string) => {
    const text = promptText.trim();
    if (!text || loading) return;

    setInput('');
    const surfaceId = `surface_${Date.now()}`;
    setFeed(prev => [...prev, {id: `user_${Date.now()}`, type: 'user', text}]);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/interact`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          prompt: text,
          surfaceId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        chatProcessor.processMessages(data.messages);
      }

      let actualSurfaceId = data.surfaceId || surfaceId;
      if (data.messages && data.messages.length > 0) {
        const found =
          data.messages.find((m: any) => m.createSurface?.surfaceId)?.createSurface?.surfaceId ||
          data.messages.find((m: any) => m.updateComponents?.surfaceId)?.updateComponents
            ?.surfaceId;
        if (found) {
          actualSurfaceId = found;
        }
      }

      setFeed(prev => [
        ...prev,
        {
          id: `assistant_${Date.now()}`,
          type: 'assistant',
          text: data.text,
          surfaceId: actualSurfaceId,
          raw: data.raw,
          messages: data.messages,
          metrics: data.metrics,
        },
      ]);
    } catch (err: any) {
      setFeed(prev => [
        ...prev,
        {
          id: `assistant_${Date.now()}`,
          type: 'assistant',
          text: `Error contacting server: ${err.message}. Make sure the FastAPI server is running on ${API_BASE_URL}.`,
          surfaceId,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
      {/* Presets Sidebar */}
      <div
        style={{
          width: '280px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#64748b',
              letterSpacing: '0.05em',
              margin: '0 0 12px 8px',
            }}
          >
            Example Presets
          </h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
            {PRESET_BUTTONS.map(btn => (
              <button
                key={btn.prompt}
                onClick={() => sendPrompt(btn.prompt)}
                disabled={loading}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#f8fafc',
                  color: '#1e293b',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <span>{btn.label}</span>
                <span style={{fontSize: '11px', color: '#64748b', fontWeight: 400}}>
                  {btn.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: 'auto',
            padding: '12px',
            backgroundColor: '#f8fafc',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            fontSize: '11px',
            color: '#64748b',
            lineHeight: 1.4,
          }}
        >
          <strong>Macro Inference Format</strong>
          <br />
          Click the <span style={{color: '#2563eb', fontWeight: 600}}>ℹ️ Inspect</span> button on
          any turn to view the raw LLM Express DSL and expanded JSON.
        </div>
      </div>

      {/* Chat Feed */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#f8fafc',
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {feed.length === 0 && (
            <div
              style={{
                margin: 'auto',
                textAlign: 'center',
                color: '#64748b',
                maxWidth: '580px',
                padding: '36px 32px',
                backgroundColor: '#ffffff',
                borderRadius: '20px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '16px',
                  backgroundColor: '#eff6ff',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px auto',
                }}
              >
                <span className="material-symbols-outlined" style={{fontSize: '30px'}}>
                  auto_awesome
                </span>
              </div>
              <h3
                style={{
                  color: '#0f172a',
                  fontSize: '18px',
                  fontWeight: 700,
                  margin: '0 0 8px',
                }}
              >
                A2UI Macros Explorer
              </h3>
              <p
                style={{
                  fontSize: '13px',
                  lineHeight: 1.6,
                  margin: '0 0 20px',
                  color: '#64748b',
                }}
              >
                Click a preset or select a suggested prompt below to observe programmatic macros
                expanded server-side into standard A2UI primitives.
              </p>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#94a3b8',
                    textAlign: 'center',
                  }}
                >
                  Suggested Prompts
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '8px',
                  }}
                >
                  {SUGGESTED_PROMPTS.map(chip => (
                    <button
                      key={chip.text}
                      onClick={() => sendPrompt(chip.text)}
                      disabled={loading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 14px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        color: '#1e293b',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.backgroundColor = '#eff6ff';
                        e.currentTarget.style.borderColor = '#93c5fd';
                        e.currentTarget.style.color = '#1d4ed8';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.backgroundColor = '#f8fafc';
                        e.currentTarget.style.borderColor = '#e2e8f0';
                        e.currentTarget.style.color = '#1e293b';
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{fontSize: '18px', color: '#2563eb', flexShrink: 0}}
                      >
                        {chip.icon}
                      </span>
                      <span style={{flex: 1, lineHeight: 1.4}}>{chip.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {feed.map(item => {
            const targetSurfaceId =
              item.surfaceId ||
              item.messages?.find((m: any) => m.createSurface?.surfaceId)?.createSurface
                ?.surfaceId ||
              item.messages?.find((m: any) => m.updateComponents?.surfaceId)?.updateComponents
                ?.surfaceId;
            const surface = targetSurfaceId
              ? chatProcessor.model.getSurface(targetSurfaceId)
              : undefined;
            const isInspectorOpen = activeInspector === item.id;
            const hasInspectionData = Boolean(
              item.raw || (item.messages && item.messages.length > 0),
            );

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: item.type === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                {item.type === 'user' ? (
                  <div
                    style={{
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      padding: '12px 18px',
                      borderRadius: '18px 18px 4px 18px',
                      fontSize: '14px',
                      fontWeight: 500,
                      maxWidth: '70%',
                      boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
                    }}
                  >
                    {item.text}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      maxWidth: '85%',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        width: '100%',
                      }}
                    >
                      {item.text && (
                        <div
                          style={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e2e8f0',
                            color: '#0f172a',
                            padding: '10px 16px',
                            borderRadius: '16px 16px 16px 4px',
                            fontSize: '14px',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                          }}
                        >
                          {item.text}
                        </div>
                      )}

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginLeft: 'auto',
                          flexWrap: 'wrap',
                        }}
                      >
                        {item.metrics && (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '8px',
                              backgroundColor: '#ffffff',
                              border: '1px solid #e2e8f0',
                              padding: '5px 12px',
                              borderRadius: '20px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#475569',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                              }}
                              title="Response Latency in seconds"
                            >
                              <span style={{color: '#059669'}}>⏱️</span>
                              <span>{item.metrics.latency}s</span>
                            </span>

                            {item.metrics.thinkingTokens !== undefined &&
                              item.metrics.thinkingTokens > 0 && (
                                <>
                                  <span style={{color: '#cbd5e1'}}>•</span>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      color: '#7c3aed',
                                    }}
                                    title="Gemini Thinking Tokens"
                                  >
                                    <span>🧠</span>
                                    <span>{item.metrics.thinkingTokens} think</span>
                                  </span>
                                </>
                              )}

                            {item.metrics.outputTokens !== undefined &&
                              item.metrics.outputTokens > 0 && (
                                <>
                                  <span style={{color: '#cbd5e1'}}>•</span>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      color: '#0284c7',
                                    }}
                                    title="Output Candidates Tokens"
                                  >
                                    <span>📝</span>
                                    <span>{item.metrics.outputTokens} out</span>
                                  </span>
                                </>
                              )}
                          </div>
                        )}

                        {hasInspectionData && (
                          <button
                            onClick={() =>
                              setActiveInspector(curr => (curr === item.id ? null : item.id))
                            }
                            title="Inspect raw LLM Express DSL and expanded A2UI JSON"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 12px',
                              borderRadius: '20px',
                              border: '1px solid #e2e8f0',
                              backgroundColor: isInspectorOpen ? '#eff6ff' : '#ffffff',
                              borderColor: isInspectorOpen ? '#93c5fd' : '#e2e8f0',
                              color: isInspectorOpen ? '#1d4ed8' : '#64748b',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{fontSize: '16px'}}>
                              data_object
                            </span>
                            <span>{isInspectorOpen ? 'Hide Payload' : 'Inspect Format'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inspector Drawer */}
                    {isInspectorOpen && (
                      <div
                        style={{
                          backgroundColor: '#0f172a',
                          color: '#f8fafc',
                          borderRadius: '16px',
                          border: '1px solid #1e293b',
                          overflow: 'hidden',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
                          marginTop: '4px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 16px',
                            backgroundColor: '#1e293b',
                            borderBottom: '1px solid #334155',
                          }}
                        >
                          <div style={{display: 'flex', gap: '8px'}}>
                            <button
                              onClick={() => setInspectorTab('express')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                border: 'none',
                                backgroundColor:
                                  inspectorTab === 'express' ? '#334155' : 'transparent',
                                color: inspectorTab === 'express' ? '#38bdf8' : '#94a3b8',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              ⚡ Raw Express DSL
                            </button>
                            <button
                              onClick={() => setInspectorTab('json')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                border: 'none',
                                backgroundColor:
                                  inspectorTab === 'json' ? '#334155' : 'transparent',
                                color: inspectorTab === 'json' ? '#38bdf8' : '#94a3b8',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              📦 Expanded A2UI JSON
                            </button>
                          </div>

                          <button
                            onClick={() => {
                              const textToCopy =
                                inspectorTab === 'express'
                                  ? item.raw || ''
                                  : JSON.stringify(item.messages || [], null, 2);
                              copyToClipboard(textToCopy);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid #475569',
                              backgroundColor: '#334155',
                              color: '#cbd5e1',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{fontSize: '14px'}}>
                              {copiedTurn ? 'check' : 'content_copy'}
                            </span>
                            <span>{copiedTurn ? 'Copied!' : 'Copy'}</span>
                          </button>
                        </div>

                        <div
                          style={{
                            padding: '16px',
                            maxHeight: '360px',
                            overflowY: 'auto',
                            fontFamily:
                              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: '12px',
                            lineHeight: '1.6',
                          }}
                        >
                          {inspectorTab === 'express' ? (
                            <pre style={{margin: 0, color: '#38bdf8', whiteSpace: 'pre-wrap'}}>
                              {item.raw || '// No raw Express DSL received'}
                            </pre>
                          ) : (
                            <pre style={{margin: 0, color: '#a5f3fc', whiteSpace: 'pre-wrap'}}>
                              {JSON.stringify(item.messages || [], null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Rendered A2UI Surface */}
                    {surface ? (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '16px',
                          border: '1px solid #e2e8f0',
                          padding: '20px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                          ...A2UI_THEME_VARS,
                        }}
                      >
                        <A2uiSurface surface={surface} />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                padding: '12px 18px',
                borderRadius: '16px 16px 16px 4px',
                fontSize: '13px',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: '18px',
                  animation: 'spin 1.5s linear infinite',
                  color: '#2563eb',
                }}
              >
                progress_activity
              </span>
              Expanding template...
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input Bar */}
        <div
          style={{
            padding: '18px 32px',
            backgroundColor: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            gap: '12px',
          }}
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendPrompt(input)}
            placeholder="Type a template prompt (e.g. 'Show verified salary' or 'Show user profile')..."
            disabled={loading}
            style={{
              flex: 1,
              padding: '14px 18px',
              borderRadius: '12px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              outline: 'none',
              transition: 'border-color 0.15s ease',
            }}
            onFocus={e => (e.target.style.borderColor = '#2563eb')}
            onBlur={e => (e.target.style.borderColor = '#cbd5e1')}
          />
          <button
            onClick={() => sendPrompt(input)}
            disabled={loading || !input.trim()}
            style={{
              padding: '0 24px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.6 : 1,
              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
              transition: 'all 0.15s ease',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
