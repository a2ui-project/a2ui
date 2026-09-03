import React, {useState, useMemo, useSyncExternalStore} from 'react';
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog, A2uiSurface} from '@a2ui/react/v0_9';
import {commerceCatalog} from './commerceCatalog';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
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

  // Superset Catalogs combining basicCatalog (both v0.9 & v1.0 URIs) and commerceCatalog for client rendering
  const processor = useMemo(() => {
    const basicCatalogV1 = new Catalog(
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      Array.from(basicCatalog.components.values()),
      basicCatalog.functions,
    );

    return new MessageProcessor(
      [basicCatalog, basicCatalogV1, commerceCatalog],
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
      const assistantMsg: ChatMessage = {
        id: `ast_${Date.now()}`,
        sender: 'assistant',
        text:
          data.status === 'success'
            ? 'Here are the requested results rendered via A2UI React:'
            : `Error: ${data.error || 'Failed to fetch'}`,
      };

      setMessages(prev => [...prev, assistantMsg]);

      if (data.a2ui_messages && Array.isArray(data.a2ui_messages)) {
        processor.processMessages(data.a2ui_messages);
        for (const messageEnvelope of data.a2ui_messages) {
          if (messageEnvelope.createSurface?.surfaceId) {
            setSurfaceId(messageEnvelope.createSurface.surfaceId);
          }
        }
      }
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
        <div style={{fontSize: '13px', color: '#94a3b8'}}>
          Powered by Gemini LLM & Modular A2UI Skills
        </div>
      </header>

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
              disabled={loading}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#2563eb',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </div>

        {/* Right Canvas: Real A2UI React Surface Rendering */}
        <div style={{flex: 1, padding: '24px', overflowY: 'auto', background: '#f8fafc'}}>
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
        </div>
      </div>
    </div>
  );
}
