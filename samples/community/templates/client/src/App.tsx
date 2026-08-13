import {useState, useEffect, useRef} from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';

interface FeedItem {
  id: string;
  type: 'user' | 'assistant';
  text?: string;
  surfaceId?: string;
}

export default function App() {
  const [processor] = useState(() => new MessageProcessor([basicCatalog]));
  const [, setTick] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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
          },
        ]);
      } else {
        setFeed(prev => [
          ...prev,
          {
            id: `assistant_${Date.now()}`,
            type: 'assistant',
            text: data.text || 'No response messages received.',
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
    <div style={{display: 'flex', height: '100vh', fontFamily: 'sans-serif'}}>
      {/* Sidebar */}
      <div
        style={{
          width: '280px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{fontSize: '18px', margin: '0 0 4px 0', color: '#0f172a'}}>A2UI Templates</h2>
          <p style={{fontSize: '12px', margin: 0, color: '#64748b'}}>
            Server-side template expansion
          </p>
        </div>

        <div style={{marginTop: '12px'}}>
          <h3
            style={{
              fontSize: '12px',
              textTransform: 'uppercase',
              color: '#94a3b8',
              letterSpacing: '0.05em',
              marginBottom: '8px',
            }}
          >
            Example Presets
          </h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
            {[
              {label: '👤 User Profile', prompt: 'show user profile'},
              {label: '👥 Team Roster', prompt: 'show team roster'},
              {label: '🎯 Team Goals', prompt: 'show team goals'},
              {label: '💬 Feedback Board', prompt: 'show feedback board'},
              {label: '⭐ Competency Panel', prompt: 'show competency panel'},
            ].map(btn => (
              <button
                key={btn.prompt}
                onClick={() => sendPrompt(btn.prompt)}
                disabled={loading}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#f8fafc',
                  color: '#1e293b',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s',
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginTop: 'auto', fontSize: '11px', color: '#94a3b8'}}>
          Uses standard A2UI Basic Catalog components and synchronous template expansion.
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
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {feed.length === 0 && (
            <div
              style={{
                margin: 'auto',
                textAlign: 'center',
                color: '#64748b',
                maxWidth: '400px',
              }}
            >
              <h3 style={{color: '#0f172a', marginBottom: '8px'}}>
                Welcome to A2UI Templates Demo
              </h3>
              <p style={{fontSize: '14px', lineHeight: 1.5}}>
                Click one of the presets on the left or enter a prompt below to see parameterized
                templates expanded server-side and rendered with the standard A2UI React renderer.
              </p>
            </div>
          )}

          {feed.map(item => {
            const surface = item.surfaceId ? processor.model.getSurface(item.surfaceId) : undefined;

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
                      padding: '10px 16px',
                      borderRadius: '16px 16px 4px 16px',
                      fontSize: '14px',
                      maxWidth: '70%',
                    }}
                  >
                    {item.text}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      maxWidth: '85%',
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
                        }}
                      >
                        {item.text}
                      </div>
                    )}
                    {surface && (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '12px',
                          border: '1px solid #e2e8f0',
                          padding: '16px',
                          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
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
                padding: '10px 16px',
                borderRadius: '16px 16px 16px 4px',
                fontSize: '13px',
                color: '#64748b',
              }}
            >
              Expanding template...
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input Bar */}
        <div
          style={{
            padding: '16px 24px',
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
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button
            onClick={() => sendPrompt(input)}
            disabled={loading || !input.trim()}
            style={{
              padding: '0 20px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.6 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
