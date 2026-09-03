import React, {useState} from 'react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  payload?: any;
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
  const [activePayload, setActivePayload] = useState<any>(null);

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
            ? 'Here are the matching products:'
            : `Returned response with warning: ${data.error || ''}`,
        payload: data.a2ui_messages,
      };

      setMessages(prev => [...prev, assistantMsg]);
      if (data.a2ui_messages) {
        setActivePayload(data.a2ui_messages);
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
    <div style={{display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f6f8'}}>
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
            A2UI
          </div>
          <h2 style={{margin: 0, fontSize: '18px', fontWeight: 600}}>Apex Commerce AI Assistant</h2>
        </div>
        <div style={{fontSize: '13px', color: '#94a3b8'}}>
          Powered by Google Gemini & Modular A2UI Skills
        </div>
      </header>

      {/* Main Split Body */}
      <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
        {/* Left Sidebar: Chat */}
        <div
          style={{
            width: '420px',
            background: '#ffffff',
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Messages */}
          <div style={{flex: 1, padding: '20px', overflowY: 'auto'}}>
            {messages.map(m => (
              <div
                key={m.id}
                style={{
                  marginBottom: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.sender === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    marginBottom: '4px',
                    fontWeight: 600,
                  }}
                >
                  {m.sender === 'user' ? 'YOU' : 'COMMERCE AGENT'}
                </div>
                <div
                  style={{
                    background: m.sender === 'user' ? '#2563eb' : '#f1f5f9',
                    color: m.sender === 'user' ? '#ffffff' : '#1e293b',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    maxWidth: '85%',
                    fontSize: '14px',
                    lineHeight: '1.4',
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div
                style={{padding: '12px', color: '#64748b', fontSize: '13px', fontStyle: 'italic'}}
              >
                Gemini Agent is retrieving inventory & generating UI...
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div
            style={{
              padding: '12px 20px',
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => handleSubmit('Show headphones and mechanical keyboards with prices')}
              style={{
                fontSize: '12px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '16px',
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              🔍 Search Electronics
            </button>
            <button
              onClick={() => handleSubmit('Check stock inventory for Aura Headphones')}
              style={{
                fontSize: '12px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '16px',
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              📦 Check Stock
            </button>
          </div>

          {/* Input Form */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSubmit();
            }}
            style={{padding: '16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px'}}
          >
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Ask about products, stock, pricing..."
              style={{
                flex: 1,
                padding: '10px 14px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </form>
        </div>

        {/* Right Canvas: Live A2UI UI Render */}
        <div style={{flex: 1, padding: '32px', overflowY: 'auto'}}>
          <h3 style={{marginTop: 0, color: '#334155', fontSize: '16px'}}>
            Dynamic A2UI Surface Canvas
          </h3>
          {activePayload ? (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            >
              <div
                style={{fontSize: '12px', color: '#16a34a', fontWeight: 600, marginBottom: '16px'}}
              >
                ✓ Validated A2UI Stream Message Envelopes Received
              </div>
              <pre
                style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  padding: '16px',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  fontSize: '13px',
                }}
              >
                {JSON.stringify(activePayload, null, 2)}
              </pre>
            </div>
          ) : (
            <div
              style={{
                height: '300px',
                border: '2px dashed #cbd5e1',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                fontSize: '14px',
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
