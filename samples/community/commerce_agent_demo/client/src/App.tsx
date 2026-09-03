import React, {useState, useEffect, useMemo, useSyncExternalStore} from 'react';
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog, A2uiSurface} from '@a2ui/react/v0_9';
import {commerceCatalog} from './commerceCatalog';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
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
  const [activeTab, setActiveTab] = useState<'canvas' | 'json' | 'express'>('canvas');
  const [rawExpress, setRawExpress] = useState<string>('');
  const [a2uiMessages, setA2uiMessages] = useState<any[]>([]);

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
      detail: 'Compiling modular skills (a2ui-core, a2ui-basic, a2ui-commerce)',
    },
    {
      id: 'agent',
      name: '3. Gemini Managed Agent',
      status: 'pending',
      detail: 'Configuring gemini-3.6-flash model & instructions',
    },
    {
      id: 'tools',
      name: '4. Tool Registry',
      status: 'pending',
      detail: 'Binding search_products & check_inventory tools',
    },
  ]);

  // Run Bootstrap Sequence on Mount
  useEffect(() => {
    runBootstrapSequence();
  }, []);

  const runBootstrapSequence = async () => {
    setBootstrapStatus('initializing');
    setBootstrapSteps(prev => prev.map(s => ({...s, status: 'pending'})));

    await new Promise(r => setTimeout(r, 400));
    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'catalogs' ? {...s, status: 'in_progress'} : s)),
    );
    await new Promise(r => setTimeout(r, 600));
    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'catalogs' ? {...s, status: 'completed'} : s)),
    );

    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'skills' ? {...s, status: 'in_progress'} : s)),
    );
    await new Promise(r => setTimeout(r, 700));
    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'skills' ? {...s, status: 'completed'} : s)),
    );

    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'agent' ? {...s, status: 'in_progress'} : s)),
    );
    await new Promise(r => setTimeout(r, 800));
    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'agent' ? {...s, status: 'completed'} : s)),
    );

    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'tools' ? {...s, status: 'in_progress'} : s)),
    );
    await new Promise(r => setTimeout(r, 500));
    setBootstrapSteps(prev =>
      prev.map(s => (s.id === 'tools' ? {...s, status: 'completed'} : s)),
    );

    setBootstrapStatus('ready');
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

    return new MessageProcessor(
      [basicCatalog, supersetCatalogV1, commerceCatalog],
      (action: any) => {
        console.log('Intercepted A2UI Action:', action);
      },
    );
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
        body: JSON.stringify({prompt: textToSend}),
      });

      const data = await response.json();

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
        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
