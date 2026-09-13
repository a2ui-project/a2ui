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
  metrics?: {
    latency?: number;
    thinkingTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    totalTokens?: number;
    isPreset?: boolean;
  };
}

interface TemplateDefinition {
  templateId: string;
  parameters: Record<string, any>;
  components: any[];
  description?: string;
  sampleData?: Record<string, any>;
  sampleMessages?: any[];
  isDynamic?: boolean;
  layoutTemplate?: Record<string, any>;
  resolvedData?: Record<string, any>;
  availablePresets?: Array<{label: string; value: string}>;
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
  const [currentView, setCurrentView] = useState<'chat' | 'library'>('chat');

  // Chat State
  const [chatProcessor] = useState(() => new MessageProcessor([basicCatalog]));
  const [, setChatTick] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeInspector, setActiveInspector] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'express' | 'json'>('express');
  const [copiedTurn, setCopiedTurn] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Library State
  const [libraryProcessor] = useState(() => new MessageProcessor([basicCatalog]));
  const [, setLibraryTick] = useState(0);
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('UserProfile');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  // Dynamic Template Interactive State
  const [selectedDynamicEmpId, setSelectedDynamicEmpId] = useState<string>('emp_101');
  const [dynamicResolvedData, setDynamicResolvedData] = useState<Record<string, any> | null>(null);
  const [dynamicTab, setDynamicTab] = useState<'input' | 'layout' | 'resolved'>('input');
  const [dynamicResolving, setDynamicResolving] = useState(false);

  // Subscriptions
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
    const forceUpdate = () => setLibraryTick(t => t + 1);
    const subCreated = libraryProcessor.onSurfaceCreated(forceUpdate);
    const subDeleted = libraryProcessor.onSurfaceDeleted(forceUpdate);
    return () => {
      subCreated.unsubscribe();
      subDeleted.unsubscribe();
    };
  }, [libraryProcessor]);

  useEffect(() => {
    if (currentView === 'chat') {
      chatBottomRef.current?.scrollIntoView({behavior: 'smooth'});
    }
  }, [feed, loading, currentView]);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLibraryLoading(true);
      try {
        const res = await fetch('http://127.0.0.1:8000/templates');
        if (res.ok) {
          const list: TemplateDefinition[] = await res.json();
          setTemplates(list);
          if (list.length > 0) {
            setSelectedTemplateId(prev =>
              list.find(t => t.templateId === prev) ? prev : list[0].templateId,
            );
            for (const item of list) {
              if (item.sampleMessages && item.sampleMessages.length > 0) {
                libraryProcessor.processMessages(item.sampleMessages);
                if (item.isDynamic) {
                  const empId = item.sampleData?.employeeId || 'emp_101';
                  const dynamicSurfaceId = `preview_${item.templateId}_${empId}`;
                  const dynamicMsgs = item.sampleMessages.map((m: any) => {
                    if (m.createSurface) {
                      return {
                        ...m,
                        createSurface: {
                          ...m.createSurface,
                          surfaceId: dynamicSurfaceId,
                        },
                      };
                    }
                    if (m.updateComponents) {
                      return {
                        ...m,
                        updateComponents: {
                          ...m.updateComponents,
                          surfaceId: dynamicSurfaceId,
                        },
                      };
                    }
                    return m;
                  });
                  libraryProcessor.processMessages(dynamicMsgs);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to load templates list:', e);
      } finally {
        setLibraryLoading(false);
      }
    };
    if (currentView === 'library' || templates.length === 0) {
      fetchTemplates();
    }
  }, [libraryProcessor, currentView]);

  const selectedTemplate = templates.find(t => t.templateId === selectedTemplateId);

  // When dynamic template selection changes, sync initial state
  useEffect(() => {
    if (selectedTemplate?.isDynamic) {
      if (selectedTemplate.resolvedData) {
        setDynamicResolvedData(selectedTemplate.resolvedData);
      }
      if (selectedTemplate.sampleData?.employeeId) {
        setSelectedDynamicEmpId(selectedTemplate.sampleData.employeeId);
      }
    }
  }, [selectedTemplate]);

  const handleResolveDynamicTemplate = async (empId: string) => {
    if (!selectedTemplate) return;
    setDynamicResolving(true);
    setSelectedDynamicEmpId(empId);
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/templates/${selectedTemplate.templateId}/resolve`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({params: {employeeId: empId}}),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setDynamicResolvedData(data.resolvedData);
        if (data.sampleMessages) {
          const dynamicSurfaceId = `preview_${selectedTemplate.templateId}_${empId}`;
          const updatedMessages = data.sampleMessages.map((m: any) => {
            if (m.createSurface) {
              return {
                ...m,
                createSurface: {
                  ...m.createSurface,
                  surfaceId: dynamicSurfaceId,
                },
              };
            }
            if (m.updateComponents) {
              return {
                ...m,
                updateComponents: {
                  ...m.updateComponents,
                  surfaceId: dynamicSurfaceId,
                },
              };
            }
            return m;
          });
          libraryProcessor.processMessages(updatedMessages);
          setLibraryTick(t => t + 1);
        }
      }
    } catch (err) {
      console.error('Failed to resolve dynamic template:', err);
    } finally {
      setDynamicResolving(false);
    }
  };

  const copyToClipboard = (text: string, isTemplate = false) => {
    navigator.clipboard.writeText(text);
    if (isTemplate) {
      setCopiedTemplate(true);
      setTimeout(() => setCopiedTemplate(false), 2000);
    } else {
      setCopiedTurn(true);
      setTimeout(() => setCopiedTurn(false), 2000);
    }
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
          text: `Error contacting server: ${err.message}. Make sure the FastAPI server is running on http://127.0.0.1:8000.`,
          surfaceId,
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
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#f8fafc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          zIndex: 10,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '18px',
            }}
          >
            <span className="material-symbols-outlined" style={{fontSize: '22px'}}>
              dashboard_customize
            </span>
          </div>
          <div>
            <h1 style={{fontSize: '16px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
              A2UI Templates
            </h1>
            <p style={{fontSize: '11px', color: '#64748b', margin: 0}}>
              Static & Dynamic Server Expansion · Basic Catalog
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#f1f5f9',
            padding: '3px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
          }}
        >
          <button
            onClick={() => setCurrentView('chat')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: currentView === 'chat' ? '#ffffff' : 'transparent',
              color: currentView === 'chat' ? '#2563eb' : '#64748b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: currentView === 'chat' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <span className="material-symbols-outlined" style={{fontSize: '16px'}}>
              chat
            </span>
            Interactive Chat
          </button>
          <button
            onClick={() => setCurrentView('library')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: currentView === 'library' ? '#ffffff' : 'transparent',
              color: currentView === 'library' ? '#2563eb' : '#64748b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: currentView === 'library' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <span className="material-symbols-outlined" style={{fontSize: '16px'}}>
              menu_book
            </span>
            Template Library
          </button>
        </div>
      </header>

      {/* Main Content View */}
      {currentView === 'chat' ? (
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
                {[
                  {
                    label: '🔒 Verified Salary',
                    prompt: 'show verified salary',
                    desc: 'Dynamic server-resolved compensation',
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
              Click the <span style={{color: '#2563eb', fontWeight: 600}}>ℹ️ Inspect</span> button
              on any turn to view the raw LLM Express DSL and expanded JSON.
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
                    A2UI Templates Explorer
                  </h3>
                  <p
                    style={{
                      fontSize: '13px',
                      lineHeight: 1.6,
                      margin: '0 0 20px',
                      color: '#64748b',
                    }}
                  >
                    Click a preset or select a suggested prompt below to observe static and dynamic
                    templates expanded server-side into standard A2UI primitives.
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
                      {[
                        {
                          icon: 'lock',
                          text: 'Show verified salary for Marcus Vance',
                          badge: 'Dynamic',
                        },
                        {
                          icon: 'person',
                          text: 'Show user profile for Alice Smith',
                          badge: 'Template',
                        },
                        {
                          icon: 'flag',
                          text: 'Show team goals for Core Protocol Engineering',
                          badge: 'Template',
                        },
                        {
                          icon: 'reviews',
                          text: 'Show feedback board for Frontend Guild',
                          badge: 'Template',
                        },
                        {
                          icon: 'groups',
                          text: 'Show team roster with Core Architecture',
                          badge: 'Template',
                        },
                        {
                          icon: 'monitoring',
                          text: 'Show user evaluation for Alice Smith',
                          badge: 'Composite',
                        },
                      ].map(chip => (
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
                                <span
                                  className="material-symbols-outlined"
                                  style={{fontSize: '16px'}}
                                >
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
                                <span
                                  className="material-symbols-outlined"
                                  style={{fontSize: '14px'}}
                                >
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
      ) : (
        /* Template Library View */
        <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
          {/* Library Sidebar List */}
          <div
            style={{
              width: '320px',
              backgroundColor: '#ffffff',
              borderRight: '1px solid #e2e8f0',
              padding: '24px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflowY: 'auto',
            }}
          >
            <div style={{padding: '0 8px 12px 8px'}}>
              <h2 style={{fontSize: '15px', fontWeight: 700, margin: '0 0 4px', color: '#0f172a'}}>
                Registered Templates
              </h2>
              <p style={{fontSize: '12px', color: '#64748b', margin: 0}}>
                Inspect static declarative templates and dynamic server resolvers.
              </p>
            </div>

            {templates.map(tmpl => {
              const isSelected = tmpl.templateId === selectedTemplateId;
              const paramCount = Object.keys(tmpl.parameters || {}).length;
              const compCount = (tmpl.components || []).length;

              return (
                <button
                  key={tmpl.templateId}
                  onClick={() => setSelectedTemplateId(tmpl.templateId)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: isSelected ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                    backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: '14px',
                        color: isSelected ? '#1d4ed8' : '#0f172a',
                      }}
                    >
                      {tmpl.templateId}
                    </span>
                    {tmpl.isDynamic ? (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#fef3c7',
                          color: '#b45309',
                          fontWeight: 700,
                          border: '1px solid #fde68a',
                        }}
                      >
                        ⚡ Dynamic
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: isSelected ? '#dbeafe' : '#f1f5f9',
                          color: isSelected ? '#1e40af' : '#64748b',
                          fontWeight: 600,
                        }}
                      >
                        {paramCount} params
                      </span>
                    )}
                  </div>
                  <span style={{fontSize: '11px', color: '#64748b'}}>
                    {tmpl.isDynamic
                      ? 'Server database resolver callback'
                      : `${compCount} primitive components`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Studio Content */}
          {selectedTemplate ? (
            selectedTemplate.isDynamic ? (
              /* Dynamic Template 3-Stage Inspector Studio */
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '24px',
                  gap: '20px',
                  overflowY: 'auto',
                }}
              >
                {/* Header Banner */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    padding: '20px 24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <h2 style={{fontSize: '18px', fontWeight: 800, margin: 0, color: '#0f172a'}}>
                        {selectedTemplate.templateId}
                      </h2>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#fef3c7',
                          color: '#b45309',
                          border: '1px solid #fde68a',
                        }}
                      >
                        ⚡ Dynamic Server Resolver
                      </span>
                    </div>
                    <p style={{fontSize: '13px', color: '#64748b', margin: 0, maxWidth: '700px'}}>
                      {selectedTemplate.description}
                    </p>
                  </div>

                  {/* Stage Switcher */}
                  <div
                    style={{
                      display: 'flex',
                      backgroundColor: '#f1f5f9',
                      padding: '3px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    {[
                      {id: 'input', label: '1. Input Interface'},
                      {id: 'layout', label: '2. Static Blueprint'},
                      {id: 'resolved', label: '3. Resolved Output'},
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setDynamicTab(tab.id as any)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: dynamicTab === tab.id ? '#ffffff' : 'transparent',
                          color: dynamicTab === tab.id ? '#2563eb' : '#64748b',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                          boxShadow:
                            dynamicTab === tab.id ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3-Stage Body */}
                <div
                  style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', flex: 1}}
                >
                  {/* Left Column: Interactive Stages */}
                  <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                    {dynamicTab === 'input' && (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '16px',
                          border: '1px solid #e2e8f0',
                          padding: '24px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        }}
                      >
                        <div>
                          <h3
                            style={{
                              fontSize: '15px',
                              fontWeight: 700,
                              margin: '0 0 4px',
                              color: '#0f172a',
                            }}
                          >
                            Step 1: Simple LLM Input Interface
                          </h3>
                          <p style={{fontSize: '13px', color: '#64748b', margin: 0}}>
                            The LLM generates only simple identifiers. Confidential figures are
                            never exposed in prompt context.
                          </p>
                        </div>

                        {/* Input Selector Form */}
                        <div
                          style={{
                            backgroundColor: '#f8fafc',
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                            padding: '16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <label style={{fontSize: '12px', fontWeight: 700, color: '#334155'}}>
                            Select Employee (Input Parameter `employeeId`):
                          </label>
                          <select
                            value={selectedDynamicEmpId}
                            onChange={e => handleResolveDynamicTemplate(e.target.value)}
                            style={{
                              padding: '10px 14px',
                              borderRadius: '8px',
                              border: '1px solid #cbd5e1',
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#0f172a',
                              backgroundColor: '#ffffff',
                              outline: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            {(
                              selectedTemplate.availablePresets || [
                                {label: 'Dr. Elena Vance (emp_101)', value: 'emp_101'},
                                {label: 'Marcus Vance (emp_102)', value: 'emp_102'},
                                {label: 'Aria Chen (emp_103)', value: 'emp_103'},
                                {label: 'Liam Kjell (emp_104)', value: 'emp_104'},
                              ]
                            ).map(opt => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          <div style={{marginTop: '8px'}}>
                            <div
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#64748b',
                                marginBottom: '4px',
                              }}
                            >
                              Generated Express DSL by LLM:
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                padding: '10px 14px',
                                backgroundColor: '#0f172a',
                                color: '#38bdf8',
                                borderRadius: '8px',
                                fontFamily: 'monospace',
                                fontSize: '13px',
                              }}
                            >
                              {`<a2ui>\nroot = EmployeeSalaryCard("${selectedDynamicEmpId}")\n</a2ui>`}
                            </pre>
                          </div>
                        </div>

                        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                          <button
                            onClick={() => handleResolveDynamicTemplate(selectedDynamicEmpId)}
                            disabled={dynamicResolving}
                            style={{
                              padding: '10px 20px',
                              borderRadius: '8px',
                              backgroundColor: '#2563eb',
                              color: '#ffffff',
                              border: 'none',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: dynamicResolving ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{fontSize: '16px'}}>
                              sync
                            </span>
                            <span>
                              {dynamicResolving ? 'Resolving...' : 'Execute Server Resolver'}
                            </span>
                          </button>
                          <span style={{fontSize: '12px', color: '#059669', fontWeight: 600}}>
                            ✓ Server resolver connected
                          </span>
                        </div>
                      </div>
                    )}

                    {dynamicTab === 'layout' && (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '16px',
                          border: '1px solid #e2e8f0',
                          padding: '24px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        }}
                      >
                        <div>
                          <h3
                            style={{
                              fontSize: '15px',
                              fontWeight: 700,
                              margin: '0 0 4px',
                              color: '#0f172a',
                            }}
                          >
                            Step 2: Underlying Layout Template (Static Blueprint)
                          </h3>
                          <p style={{fontSize: '13px', color: '#64748b', margin: 0}}>
                            The visual layout is declared once in JSON (salary_card.json). Parameter
                            placeholders like baseSalary and annualBonus are populated by the server
                            callback.
                          </p>
                        </div>

                        <pre
                          style={{
                            margin: 0,
                            padding: '16px',
                            backgroundColor: '#0f172a',
                            color: '#f8fafc',
                            borderRadius: '12px',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            lineHeight: '1.6',
                            maxHeight: '440px',
                            overflowY: 'auto',
                          }}
                        >
                          {JSON.stringify(selectedTemplate.layoutTemplate || {}, null, 2)}
                        </pre>
                      </div>
                    )}

                    {dynamicTab === 'resolved' && (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '16px',
                          border: '1px solid #e2e8f0',
                          padding: '24px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        }}
                      >
                        <div>
                          <h3
                            style={{
                              fontSize: '15px',
                              fontWeight: 700,
                              margin: '0 0 4px',
                              color: '#0f172a',
                            }}
                          >
                            Step 3: Server-Resolved Injected Data
                          </h3>
                          <p style={{fontSize: '13px', color: '#64748b', margin: 0}}>
                            Live record retrieved from the internal HR database for{' '}
                            {selectedDynamicEmpId}.
                          </p>
                        </div>

                        <pre
                          style={{
                            margin: 0,
                            padding: '16px',
                            backgroundColor: '#0f172a',
                            color: '#a5f3fc',
                            borderRadius: '12px',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            lineHeight: '1.6',
                          }}
                        >
                          {JSON.stringify(dynamicResolvedData || {}, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Live Inflated Preview */}
                  <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <h3 style={{fontSize: '15px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
                        Inflated Output Preview
                      </h3>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#ecfdf5',
                          color: '#047857',
                          border: '1px solid #a7f3d0',
                        }}
                      >
                        ✓ Live Inflated
                      </span>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '18px',
                        border: '1px solid #e2e8f0',
                        padding: '24px',
                        boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.06)',
                        minHeight: '280px',
                        ...A2UI_THEME_VARS,
                      }}
                    >
                      {(() => {
                        const dynSurface =
                          libraryProcessor.model.getSurface(
                            `preview_${selectedTemplate.templateId}_${selectedDynamicEmpId}`,
                          ) ||
                          libraryProcessor.model.getSurface(
                            `preview_${selectedTemplate.templateId}`,
                          );
                        return dynSurface ? (
                          <A2uiSurface surface={dynSurface} />
                        ) : (
                          <div style={{color: '#94a3b8', textAlign: 'center', padding: '40px'}}>
                            No preview surface available for this template.
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Standard Static Template Studio */
              <div
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '24px',
                  padding: '24px',
                  overflowY: 'auto',
                }}
              >
                {/* Left: Live Inflated Preview */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                  <div
                    style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}
                  >
                    <div>
                      <h3 style={{fontSize: '16px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
                        Inflated UI Preview
                      </h3>
                      <p style={{fontSize: '12px', color: '#64748b', margin: '2px 0 0'}}>
                        Rendered via @a2ui/react using declared sampleData
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: '8px',
                        backgroundColor: '#ecfdf5',
                        color: '#047857',
                        border: '1px solid #a7f3d0',
                      }}
                    >
                      ✓ Live Inflated
                    </span>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '18px',
                      border: '1px solid #e2e8f0',
                      padding: '24px',
                      boxShadow:
                        '0 4px 20px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
                      minHeight: '280px',
                      ...A2UI_THEME_VARS,
                    }}
                  >
                    {libraryProcessor.model.getSurface(`preview_${selectedTemplate.templateId}`) ? (
                      <A2uiSurface
                        surface={
                          libraryProcessor.model.getSurface(
                            `preview_${selectedTemplate.templateId}`,
                          )!
                        }
                      />
                    ) : (
                      <div style={{color: '#94a3b8', textAlign: 'center', padding: '40px'}}>
                        No preview surface available for this template.
                      </div>
                    )}
                  </div>

                  {selectedTemplate.sampleData && (
                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        padding: '16px',
                      }}
                    >
                      <h4
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: '#64748b',
                          letterSpacing: '0.05em',
                          margin: '0 0 8px',
                        }}
                      >
                        Sample Data Inputs
                      </h4>
                      <pre
                        style={{
                          margin: 0,
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: '12px',
                          color: '#0f172a',
                          backgroundColor: '#f8fafc',
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                          overflowX: 'auto',
                        }}
                      >
                        {JSON.stringify(selectedTemplate.sampleData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Right: Code with Line Numbers & Monospace Font */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                  <div
                    style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}
                  >
                    <div>
                      <h3 style={{fontSize: '16px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
                        Template Declaration (JSON)
                      </h3>
                      <p style={{fontSize: '12px', color: '#64748b', margin: '2px 0 0'}}>
                        Parameterized JSON definition & component graph
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        const cleanTemplate = {
                          templateId: selectedTemplate.templateId,
                          parameters: selectedTemplate.parameters,
                          components: selectedTemplate.components,
                          sampleData: selectedTemplate.sampleData,
                        };
                        copyToClipboard(JSON.stringify(cleanTemplate, null, 2), true);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        color: '#0f172a',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{fontSize: '15px'}}>
                        {copiedTemplate ? 'check' : 'content_copy'}
                      </span>
                      <span>{copiedTemplate ? 'Copied JSON!' : 'Copy Template JSON'}</span>
                    </button>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#0f172a',
                      borderRadius: '16px',
                      border: '1px solid #1e293b',
                      overflow: 'hidden',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
                      display: 'flex',
                      flexDirection: 'column',
                      maxHeight: '620px',
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
                        fontSize: '11px',
                        color: '#94a3b8',
                      }}
                    >
                      <span>{selectedTemplate.templateId.toLowerCase()}.json</span>
                      <span>JSON Schema draft 2020-12</span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        overflowY: 'auto',
                        padding: '16px 0',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '12px',
                        lineHeight: '20px',
                      }}
                    >
                      {(() => {
                        const jsonText = JSON.stringify(
                          {
                            templateId: selectedTemplate.templateId,
                            parameters: selectedTemplate.parameters,
                            components: selectedTemplate.components,
                            sampleData: selectedTemplate.sampleData,
                          },
                          null,
                          2,
                        );
                        const lines = jsonText.split('\n');

                        return (
                          <>
                            <div
                              style={{
                                padding: '0 12px 0 16px',
                                textAlign: 'right',
                                color: '#475569',
                                userSelect: 'none',
                                borderRight: '1px solid #1e293b',
                              }}
                            >
                              {lines.map((_, idx) => (
                                <div key={idx}>{idx + 1}</div>
                              ))}
                            </div>

                            <div
                              style={{
                                padding: '0 16px',
                                color: '#e2e8f0',
                                flex: 1,
                                whiteSpace: 'pre',
                                overflowX: 'auto',
                              }}
                            >
                              {lines.map((line, idx) => (
                                <div key={idx}>{line}</div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div style={{margin: 'auto', color: '#64748b'}}>
              {libraryLoading ? 'Loading templates...' : 'No templates available.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
