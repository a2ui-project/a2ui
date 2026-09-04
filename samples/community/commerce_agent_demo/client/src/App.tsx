import React, {useState, useEffect, useMemo, useSyncExternalStore} from 'react';
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog, A2uiSurface} from '@a2ui/react/v0_9';
import {commerceCatalog} from './commerceCatalog';

interface LoadedSkill {
  id: string;
  name: string;
  description: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  loadedSkills?: LoadedSkill[];
}

interface SkillItem {
  name: string;
  path: string;
  content: string;
}

interface BootstrapStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  detail: string;
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_1',
      sender: 'assistant',
      text: 'Welcome to Apex Commerce! Ask me to search products, check stock levels, compare electronics, or manage your cart.',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [surfaceId, setSurfaceId] = useState<string>('main');

  // Inspector & Code Tabs
  const [activeTab, setActiveTab] = useState<'canvas' | 'json' | 'express' | 'skills'>('canvas');
  const [rawExpress, setRawExpress] = useState<string>('');
  const [a2uiMessages, setA2uiMessages] = useState<any[]>([]);

  // Skills Viewer State
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [activeSkillTab, setActiveSkillTab] = useState<string>('a2ui-core');
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);

  // Bootstrap Tracker State
  const [bootstrapStatus, setBootstrapStatus] = useState<'initializing' | 'ready'>('initializing');
  const [bootstrapSteps, setBootstrapSteps] = useState<BootstrapStep[]>([
    {
      id: 'catalogs',
      name: '1. Catalog Loader',
      status: 'pending',
      detail: 'Loading basic & commerce catalog schemas',
    },
    {
      id: 'skills',
      name: '2. SkillGenerator',
      status: 'pending',
      detail: 'Compiling modular skills into .agents/skills/',
    },
    {
      id: 'agent',
      name: '3. Managed Agent',
      status: 'pending',
      detail: 'Bootstrapping antigravity-preview-05-2026 remote interaction',
    },
    {
      id: 'tools',
      name: '4. Tool Registry',
      status: 'pending',
      detail: 'Binding search_products & check_inventory tools',
    },
  ]);

  // Run Bootstrap Sequence & Fetch Generated Skills on Mount
  useEffect(() => {
    runBootstrapSequence();
    fetch('/api/skills')
      .then(res => res.json())
      .then(data => {
        if (data.skills && Array.isArray(data.skills)) {
          setSkills(data.skills);
        }
      })
      .catch(err => console.error('Failed to fetch skills:', err));
  }, []);

  const runBootstrapSequence = async () => {
    setBootstrapStatus('initializing');
    setBootstrapSteps(prev => prev.map(s => ({...s, status: 'pending'})));

    await new Promise(r => setTimeout(r, 200));
    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'catalogs' ? {...s, status: 'in_progress'} : s)),
    );

    try {
      setBootstrapSteps(prev =>
        prev.map(s => (s.id === 'catalogs' ? {...s, status: 'completed'} : s)),
      );
      setBootstrapSteps(prev =>
        prev.map(s => (s.id === 'skills' ? {...s, status: 'in_progress'} : s)),
      );

      const res = await fetch('/api/bootstrap');
      const data = await res.json();

      setBootstrapSteps(prev =>
        prev.map(s => (s.id === 'skills' ? {...s, status: 'completed'} : s)),
      );

      const sessIdShort = data.session_id ? `${data.session_id.substring(0, 16)}...` : '';

      setBootstrapSteps(prev =>
        prev.map(s =>
          s.id === 'agent'
            ? {
                ...s,
                status: 'completed',
                detail: `antigravity-preview-05-2026 (${sessIdShort})`,
              }
            : s,
        ),
      );

      setBootstrapSteps(prev =>
        prev.map(s => (s.id === 'tools' ? {...s, status: 'completed'} : s)),
      );

      if (data.session_id) {
        setAgentSessionId(data.session_id);
      }
      setBootstrapStatus('ready');
    } catch (err: any) {
      console.error('Error bootstrapping Managed Agent:', err);
    }
  };

  // Superset Catalogs combining basicCatalog (both v0.9 & v1.0 URIs) and commerceCatalog for client rendering
  const processor = useMemo(() => {
    const supersetCatalogV1 = new Catalog(
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      [
        ...Array.from(basicCatalog.components.values()),
        ...Array.from(commerceCatalog.components.values()),
      ],
      [
        ...Array.from(basicCatalog.functions.values()),
        ...Array.from(commerceCatalog.functions.values()),
      ],
    );

    const proc = new MessageProcessor(
      [basicCatalog, supersetCatalogV1, commerceCatalog],
      (action: any) => {
        console.log('Intercepted A2UI Action:', action);
      },
    );

    // Synchronously create shared surface main on initialization
    proc.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'main',
          catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
        },
      },
    ]);

    return proc;
  }, []);

  // Subscribe to A2UI surface group model changes
  const subscribeSurfaces = (callback: () => void) => {
    const sub = processor.model.onSurfaceCreated.subscribe(callback);
    const sub2 = processor.model.onSurfaceDeleted.subscribe(callback);
    return () => {
      sub.unsubscribe();
      sub2.unsubscribe();
    };
  };

  const getSurfacesSnapshot = () => {
    return processor.model.surfacesMap.size;
  };

  useSyncExternalStore(subscribeSurfaces, getSurfacesSnapshot);

  const activeSurface =
    processor.model.getSurface(surfaceId) ||
    Array.from(processor.model.surfacesMap.values())[0];

  const handleSubmit = async (queryText?: string) => {
    const textToSend = queryText || prompt;
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: textToSend,
    };

    setMessages(prev => [...prev, userMsg]);
    setPrompt('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt: textToSend, session_id: agentSessionId}),
      });

      const data = await response.json();

      if (data.session_id) {
        setAgentSessionId(data.session_id);
      }

      if (data.raw) {
        setRawExpress(data.raw);
      }

      if (data.a2ui_messages && Array.isArray(data.a2ui_messages)) {
        setA2uiMessages(data.a2ui_messages);
        processor.processMessages(data.a2ui_messages);
        for (const messageEnvelope of data.a2ui_messages) {
          if (messageEnvelope.createSurface?.surfaceId) {
            setSurfaceId(messageEnvelope.createSurface.surfaceId);
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: `ast_${Date.now()}`,
        sender: 'assistant',
        text:
          data.status === 'success'
            ? 'Here are the requested results rendered via A2UI React:'
            : `Error: ${data.error || 'Failed to fetch'}`,
        loadedSkills: data.loaded_skills || [
          {id: 'a2ui-core', name: 'a2ui-core', description: 'Express DSL Grammar & Syntax Rules'},
          {id: 'a2ui-basic', name: 'a2ui-basic', description: 'Standard Basic Component Catalog'},
          {id: 'a2ui-commerce', name: 'a2ui-commerce', description: 'Commerce Catalog (ProductCard, ProductGrid)'},
        ],
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'assistant',
          text: `Error connecting to backend server: ${err.message}`,
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
        background: '#f4f6f8',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Top Header Bar */}
      <header
        style={{
          background: '#0f172a',
          color: '#ffffff',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
          <div
            style={{
              background: '#38bdf8',
              borderRadius: '8px',
              padding: '6px 12px',
              fontWeight: 'bold',
              color: '#0f172a',
            }}
          >
            A2UI React
          </div>
          <h2 style={{margin: 0, fontSize: '18px', fontWeight: 600}}>
            Apex Commerce AI Assistant
          </h2>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
          <button
            onClick={() => setActiveTab('skills')}
            style={{
              background: activeTab === 'skills' ? '#38bdf8' : 'rgba(255,255,255,0.12)',
              color: activeTab === 'skills' ? '#0f172a' : '#ffffff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            📚 View Generated Skills
          </button>
          <span
            style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '16px',
              fontWeight: 600,
              background: bootstrapStatus === 'ready' ? '#059669' : '#d97706',
              color: '#ffffff',
            }}
          >
            {bootstrapStatus === 'ready'
              ? '● Agent Status: Online & Ready'
              : '⏳ Agent Status: Bootstrapping...'}
          </span>
          <button
            onClick={runBootstrapSequence}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#1e293b',
              color: '#f8fafc',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            🔄 Re-bootstrap Agent
          </button>
        </div>
      </header>

      {/* Managed Agent Bootstrap Tracker Bar */}
      <div
        style={{
          background: '#1e293b',
          borderBottom: '1px solid #334155',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{display: 'flex', gap: '24px', flex: 1}}>
          {bootstrapSteps.map(step => (
            <div
              key={step.id}
              style={{display: 'flex', alignItems: 'center', gap: '8px'}}
            >
              <div style={{fontSize: '14px'}}>
                {step.status === 'completed' && '🟢'}
                {step.status === 'in_progress' && '⏳'}
                {step.status === 'pending' && '⚪'}
              </div>
              <div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color:
                      step.status === 'completed'
                        ? '#34d399'
                        : step.status === 'in_progress'
                          ? '#fbbf24'
                          : '#94a3b8',
                  }}
                >
                  {step.name}
                </div>
                <div style={{fontSize: '11px', color: '#64748b'}}>{step.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Container */}
      <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
        {/* Left Sidebar: Chat Interface */}
        <div
          style={{
            width: '420px',
            borderRight: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Chat Messages Log */}
          <div style={{flex: 1, padding: '20px', overflowY: 'auto'}}>
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  marginBottom: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#64748b',
                    marginBottom: '4px',
                    textTransform: 'uppercase',
                  }}
                >
                  {msg.sender === 'user' ? 'You' : 'Commerce Agent'}
                </div>
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: msg.sender === 'user' ? '#2563eb' : '#f1f5f9',
                    color: msg.sender === 'user' ? '#ffffff' : '#0f172a',
                    fontSize: '14px',
                    lineHeight: 1.5,
                  }}
                >
                  {msg.text}
                </div>
                {msg.loadedSkills && msg.loadedSkills.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      flexWrap: 'wrap',
                      marginTop: '6px',
                      marginBottom: '4px',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#64748b',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Skills Loaded:
                    </span>
                    {msg.loadedSkills.map(sk => (
                      <span
                        key={sk.id}
                        onClick={() => {
                          setActiveSkillTab(sk.name);
                          setActiveTab('skills');
                        }}
                        style={{
                          fontSize: '11px',
                          background: sk.name.includes('core')
                            ? '#e0f2fe'
                            : sk.name.includes('basic')
                            ? '#f0fdf4'
                            : '#fef3c7',
                          color: sk.name.includes('core')
                            ? '#0369a1'
                            : sk.name.includes('basic')
                            ? '#15803d'
                            : '#b45309',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontWeight: 600,
                          border: '1px solid rgba(0,0,0,0.08)',
                          cursor: 'pointer',
                        }}
                        title={`Click to inspect source code of ${sk.name} skill`}
                      >
                        {sk.name.includes('core')
                          ? '🧠 '
                          : sk.name.includes('basic')
                          ? '📦 '
                          : '🛍️ '}
                        {sk.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{color: '#64748b', fontSize: '14px', fontStyle: 'italic'}}>
                Agent is generating UI response...
              </div>
            )}
          </div>

          {/* Prompt Suggestions */}
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
            }}
          >
            <button
              onClick={() => handleSubmit('Search electronics and wireless earbuds')}
              style={{
                fontSize: '12px',
                padding: '6px 12px',
                borderRadius: '16px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                cursor: 'pointer',
              }}
            >
              🔍 Search Electronics
            </button>
            <button
              onClick={() => handleSubmit('Check stock levels for Laptop Stand')}
              style={{
                fontSize: '12px',
                padding: '6px 12px',
                borderRadius: '16px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                cursor: 'pointer',
              }}
            >
              📦 Check Stock
            </button>
          </div>

          {/* Query Input Box */}
          <div
            style={{
              padding: '16px 20px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              gap: '8px',
            }}
          >
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Ask about products, stock, pricing..."
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={loading || bootstrapStatus !== 'ready'}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: bootstrapStatus === 'ready' ? '#2563eb' : '#cbd5e1',
                color: '#ffffff',
                fontWeight: 600,
                cursor: bootstrapStatus === 'ready' ? 'pointer' : 'not-allowed',
              }}
            >
              Send
            </button>
          </div>
        </div>

        {/* Right Canvas: Real A2UI React Surface Rendering & Inspector Tabs */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: '#f8fafc',
            overflow: 'hidden',
          }}
        >
          {/* Inspector Tab Header Bar */}
          <div
            style={{
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              padding: '12px 24px 0 24px',
              display: 'flex',
              gap: '16px',
            }}
          >
            <button
              onClick={() => setActiveTab('canvas')}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom:
                  activeTab === 'canvas'
                    ? '3px solid #2563eb'
                    : '3px solid transparent',
                background: 'transparent',
                fontWeight: activeTab === 'canvas' ? 700 : 500,
                color: activeTab === 'canvas' ? '#2563eb' : '#64748b',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              🎨 Rendered Canvas
            </button>
            <button
              onClick={() => setActiveTab('json')}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom:
                  activeTab === 'json'
                    ? '3px solid #2563eb'
                    : '3px solid transparent',
                background: 'transparent',
                fontWeight: activeTab === 'json' ? 700 : 500,
                color: activeTab === 'json' ? '#2563eb' : '#64748b',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              📄 A2UI JSON Messages ({a2uiMessages.length})
            </button>
            <button
              onClick={() => setActiveTab('express')}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom:
                  activeTab === 'express'
                    ? '3px solid #2563eb'
                    : '3px solid transparent',
                background: 'transparent',
                fontWeight: activeTab === 'express' ? 700 : 500,
                color: activeTab === 'express' ? '#2563eb' : '#64748b',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              ⚡ Raw Express DSL
            </button>
            <button
              onClick={() => setActiveTab('skills')}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom:
                  activeTab === 'skills'
                    ? '3px solid #2563eb'
                    : '3px solid transparent',
                background: 'transparent',
                fontWeight: activeTab === 'skills' ? 700 : 500,
                color: activeTab === 'skills' ? '#2563eb' : '#64748b',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              📚 Generated Skills ({skills.length || 3})
            </button>
          </div>

          {/* Tab Content Panel */}
          <div style={{flex: 1, padding: '24px', overflowY: 'auto'}}>
            {activeTab === 'canvas' && (
              <>
                <h3 style={{margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a'}}>
                  Dynamic A2UI Surface Canvas
                </h3>
                {activeSurface ? (
                  <div
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '24px',
                      background: '#ffffff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      minHeight: '400px',
                    }}
                  >
                    <A2uiSurface surface={activeSurface} />
                  </div>
                ) : (
                  <div
                    style={{
                      border: '2px dashed #cbd5e1',
                      borderRadius: '12px',
                      padding: '48px',
                      textAlign: 'center',
                      color: '#64748b',
                    }}
                  >
                    Submit a prompt to view generated interactive A2UI components here.
                  </div>
                )}
              </>
            )}

            {activeTab === 'json' && (
              <div>
                <h3 style={{margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a'}}>
                  Validated A2UI JSON Envelopes Payload
                </h3>
                {a2uiMessages.length > 0 ? (
                  <pre
                    style={{
                      background: '#0f172a',
                      color: '#38bdf8',
                      padding: '20px',
                      borderRadius: '12px',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      overflowX: 'auto',
                      maxHeight: '600px',
                    }}
                  >
                    {JSON.stringify(a2uiMessages, null, 2)}
                  </pre>
                ) : (
                  <div
                    style={{
                      border: '2px dashed #cbd5e1',
                      borderRadius: '12px',
                      padding: '48px',
                      textAlign: 'center',
                      color: '#64748b',
                    }}
                  >
                    No A2UI JSON payload received yet. Submit a query to inspect.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'express' && (
              <div>
                <h3 style={{margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a'}}>
                  Raw Express DSL Generated by Gemini LLM
                </h3>
                {rawExpress ? (
                  <pre
                    style={{
                      background: '#1e1e1e',
                      color: '#d4d4d4',
                      padding: '20px',
                      borderRadius: '12px',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      overflowX: 'auto',
                      maxHeight: '600px',
                    }}
                  >
                    {rawExpress}
                  </pre>
                ) : (
                  <div
                    style={{
                      border: '2px dashed #cbd5e1',
                      borderRadius: '12px',
                      padding: '48px',
                      textAlign: 'center',
                      color: '#64748b',
                    }}
                  >
                    No Express DSL text generated yet. Submit a query to inspect.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'skills' && (
              <div>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
                  <h3 style={{margin: 0, fontSize: '18px', color: '#0f172a'}}>
                    Compiled Modular Skills Source Code
                  </h3>
                  <div style={{fontSize: '12px', color: '#64748b'}}>
                    Generated dynamically by <code style={{background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px'}}>SkillGenerator</code>
                  </div>
                </div>

                {/* Sub-tabs for Skill Selection */}
                <div style={{display: 'flex', gap: '8px', marginBottom: '16px'}}>
                  {(skills.length > 0
                    ? skills
                    : [
                        {name: 'a2ui-core', path: 'a2ui-core/SKILL.md', content: 'Loading skill content...'},
                        {name: 'a2ui-basic', path: 'a2ui-basic/SKILL.md', content: 'Loading skill content...'},
                        {name: 'a2ui-commerce', path: 'a2ui-commerce/SKILL.md', content: 'Loading skill content...'},
                      ]
                  ).map(sk => {
                    const cleanLabel = sk.name.includes('core')
                      ? 'a2ui-core'
                      : sk.name.includes('basic')
                      ? 'a2ui-basic'
                      : 'a2ui-commerce';
                    const isSelected =
                      activeSkillTab === cleanLabel ||
                      activeSkillTab === sk.name ||
                      (activeSkillTab === 'a2ui-core' && sk.name.includes('core'));
                    return (
                      <button
                        key={sk.name}
                        onClick={() => setActiveSkillTab(cleanLabel)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid #2563eb' : '1px solid #cbd5e1',
                          background: isSelected ? '#eff6ff' : '#ffffff',
                          color: isSelected ? '#1d4ed8' : '#475569',
                          fontWeight: isSelected ? 700 : 500,
                          fontSize: '13px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {cleanLabel.includes('core')
                          ? '🧠 '
                          : cleanLabel.includes('basic')
                          ? '📦 '
                          : '🛍️ '}
                        {cleanLabel}
                      </button>
                    );
                  })}
                </div>

                {/* Display Content for Active Skill */}
                {(() => {
                  const currentSkill =
                    skills.find(s => s.name === activeSkillTab || s.path.startsWith(activeSkillTab)) ||
                    skills[0];

                  return currentSkill ? (
                    <div style={{background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden'}}>
                      <div style={{background: '#f8fafc', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <span style={{fontSize: '12px', fontFamily: 'monospace', color: '#475569', fontWeight: 600}}>
                          📁 samples/community/commerce_agent_demo/skills/{currentSkill.path}
                        </span>
                        <span style={{fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: '10px', fontWeight: 600}}>
                          A2UI Modular Skill
                        </span>
                      </div>
                      <pre
                        style={{
                          background: '#0f172a',
                          color: '#e2e8f0',
                          padding: '20px',
                          margin: 0,
                          fontSize: '13px',
                          lineHeight: 1.5,
                          overflowX: 'auto',
                          maxHeight: '520px',
                          fontFamily: 'Consolas, Monaco, monospace',
                        }}
                      >
                        {currentSkill.content}
                      </pre>
                    </div>
                  ) : (
                    <div style={{border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '48px', textAlign: 'center', color: '#64748b'}}>
                      Loading skill packages from server...
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
