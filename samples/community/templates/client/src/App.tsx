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

import React, {useState, useEffect, useRef} from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';

interface FeedItem {
  id: string;
  type: 'user' | 'assistant';
  text?: string;
  surfaceId?: string;
  raw?: string;
  messages?: any[];
}

const A2UI_THEME_VARS: React.CSSProperties = {
  // Card & Container
  ['--a2ui-card-border-radius' as any]: '16px',
  ['--a2ui-card-background' as any]: '#ffffff',
  ['--a2ui-card-border' as any]: '1px solid #e2e8f0',
  ['--a2ui-card-box-shadow' as any]:
    '0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
  ['--a2ui-card-padding' as any]: '18px 22px',
  ['--a2ui-card-margin' as any]: '8px 0',

  // Primitives & General
  ['--a2ui-border-radius' as any]: '12px',
  ['--a2ui-color-border' as any]: '#e2e8f0',
  ['--a2ui-color-surface' as any]: '#ffffff',
  ['--a2ui-color-on-surface' as any]: '#0f172a',

  // Primary Action & Button
  ['--a2ui-color-primary' as any]: '#2563eb',
  ['--a2ui-color-primary-hover' as any]: '#1d4ed8',
  ['--a2ui-color-on-primary' as any]: '#ffffff',
  ['--a2ui-button-border-radius' as any]: '10px',
  ['--a2ui-button-background' as any]: '#2563eb',
  ['--a2ui-button-padding' as any]: '8px 18px',
  ['--a2ui-button-font-weight' as any]: '600',
  ['--a2ui-button-box-shadow' as any]: '0 1px 2px rgba(37, 99, 235, 0.2)',

  // Spacing & Icons
  ['--a2ui-spacing-s' as any]: '6px',
  ['--a2ui-spacing-m' as any]: '12px',
  ['--a2ui-spacing-l' as any]: '20px',
  ['--a2ui-icon-size' as any]: '22px',
  ['--a2ui-icon-color' as any]: '#2563eb',

  // Typography & Dividers
  ['--a2ui-divider-color' as any]: '#f1f5f9',
  ['--a2ui-text-caption-color' as any]: '#64748b',
};

export default function App() {
  const [processor] = useState(() => new MessageProcessor([basicCatalog]));
  const [, setTick] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeInspector, setActiveInspector] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'express' | 'json'>('express');
  const [copied, setCopied] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const forceUpdate = () => setTick(t => t + 1);
    const subCreated = processor.onSurfaceCreated(forceUpdate);
    const subDeleted = processor.onSurfaceDeleted(forceUpdate);
    return () => {
      subCreated.unsubscribe();
      subDeleted.unsubscribe();
    };
  }, [processor]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [feed, loading]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendPrompt = async (promptText: string) => {
    const text = promptText.trim();
    if (!text || loading) return;

    setInput('');
    const surfaceId = `surface_${Date.now()}`;
    setFeed(prev => [...prev, {id: `user_${Date.now()}`, type: 'user', text}]);
    setLoading(true);

    try {
      const res = await fetch('http://127.0.0.1:8000/interact', {
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
        processor.processMessages(data.messages);
        const targetSurfaceId =
          data.surfaceId ||
          data.messages.find((m: any) => m.createSurface)?.createSurface?.surfaceId ||
          surfaceId;
        setFeed(prev => [
          ...prev,
          {
            id: `assistant_${Date.now()}`,
            type: 'assistant',
            text: data.text,
            surfaceId: targetSurfaceId,
            raw: data.raw,
            messages: data.messages,
          },
        ]);
      } else {
        setFeed(prev => [
          ...prev,
          {
            id: `assistant_${Date.now()}`,
            type: 'assistant',
            text: data.text || 'No response messages received.',
            raw: data.raw,
            messages: data.messages || [],
          },
        ]);
      }
    } catch (err: any) {
      setFeed(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          type: 'assistant',
          text: `Error contacting server: ${err.message}. Make sure the FastAPI server is running on http://127.0.0.1:8000.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        fontFamily:
          "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: '300px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}>
            <span
              className="material-symbols-outlined"
              style={{color: '#2563eb', fontSize: '24px'}}
            >
              dashboard_customize
            </span>
            <h2 style={{fontSize: '18px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
              A2UI Templates
            </h2>
          </div>
          <p style={{fontSize: '12px', margin: 0, color: '#64748b'}}>
            Synchronous server expansion · Basic Catalog
          </p>
        </div>

        <div style={{marginTop: '8px'}}>
          <h3
            style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              color: '#94a3b8',
              letterSpacing: '0.08em',
              fontWeight: 700,
              marginBottom: '12px',
            }}
          >
            Example Presets
          </h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
            {[
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
            ].map(btn => (
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
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }
                }}
                onMouseLeave={e => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }
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
          <strong>Template Inference Format</strong>
          <br />
          Click the <span style={{color: '#2563eb', fontWeight: 600}}>ℹ️ Inspect</span> button on
          any turn to compare raw LLM Express DSL with expanded JSON.
        </div>
      </div>

      {/* Main Chat Feed */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#f8fafc',
        }}
      >
        {/* Messages List */}
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
                maxWidth: '480px',
                padding: '40px',
                backgroundColor: '#ffffff',
                borderRadius: '20px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  backgroundColor: '#eff6ff',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px auto',
                }}
              >
                <span className="material-symbols-outlined" style={{fontSize: '32px'}}>
                  auto_awesome
                </span>
              </div>
              <h3 style={{color: '#0f172a', fontSize: '18px', fontWeight: 700, margin: '0 0 8px'}}>
                A2UI Templates Explorer
              </h3>
              <p style={{fontSize: '14px', lineHeight: 1.6, margin: 0, color: '#64748b'}}>
                Click a preset on the sidebar or send a custom prompt below to observe
                high-efficiency declarative templates expanded server-side into standard A2UI
                primitives.
              </p>
            </div>
          )}

          {feed.map(item => {
            const surface = item.surfaceId ? processor.model.getSurface(item.surfaceId) : undefined;
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

                      {/* Turn Inspector Button */}
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
                        {/* Tab Switcher & Actions */}
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
                              const content =
                                inspectorTab === 'express'
                                  ? item.raw || ''
                                  : JSON.stringify(item.messages, null, 2);
                              copyToClipboard(content);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: '1px solid #475569',
                              backgroundColor: '#0f172a',
                              color: '#cbd5e1',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{fontSize: '14px'}}>
                              {copied ? 'check' : 'content_copy'}
                            </span>
                            <span>{copied ? 'Copied!' : 'Copy'}</span>
                          </button>
                        </div>

                        {/* Code Display Area */}
                        <div style={{padding: '16px', maxHeight: '320px', overflowY: 'auto'}}>
                          <pre
                            style={{
                              margin: 0,
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
                              fontSize: '12px',
                              lineHeight: 1.5,
                              color: inspectorTab === 'express' ? '#7dd3fc' : '#a7f3d0',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {inspectorTab === 'express'
                              ? item.raw || 'No raw format data available.'
                              : JSON.stringify(item.messages, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Rendered A2UI Surface */}
                    {surface && (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '18px',
                          border: '1px solid #e2e8f0',
                          padding: '20px',
                          boxShadow:
                            '0 4px 20px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
                          ...A2UI_THEME_VARS,
                        }}
                      >
                        <A2uiSurface surface={surface} />
                      </div>
                    )}
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
                borderRadius: '18px 18px 18px 4px',
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
            placeholder="Type a template prompt (e.g. 'Show user profile' or custom request)..."
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
