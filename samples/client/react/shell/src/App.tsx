/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {useState, useEffect, useCallback, useMemo, useRef, FormEvent} from 'react';
import {
  A2uiSurface,
  basicCatalog,
  MarkdownContext,
  ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {A2uiClientMessage, A2uiMessage, MessageProcessor, SurfaceModel} from '@a2ui/web_core/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';
import {A2UIClient} from './client';
import {AppConfig, restaurantConfig} from './configs';
import {
  createRestaurantListMessages,
  createBookingFormMessages,
  createConfirmationMessages,
} from './mock';

import './App.css';

// Available app configs
const configs: Record<string, AppConfig> = {
  restaurant: restaurantConfig,
};

// Check if mock mode is enabled via URL parameter
const urlParams = new URLSearchParams(window.location.search);
const isMockMode = urlParams.get('mock') === 'true';

export function App() {
  // Load config from URL parameter
  const config = useMemo(() => {
    const appKey = urlParams.get('app') || 'restaurant';
    return configs[appKey] || configs.restaurant;
  }, []);

  // Create client instance
  const client = useMemo(() => new A2UIClient(), []);

  // Set document title and background on mount
  useEffect(() => {
    document.title = config.title;
    if (config.background) {
      document.documentElement.style.setProperty('--background', config.background);
    }
  }, [config]);

  // Use a ref to hold the sendAndProcess function that will be set by ShellContent
  const sendAndProcessRef = useRef<((message: A2uiClientMessage | string) => Promise<void>) | null>(
    null,
  );

  const processor = useMemo(() => {
    return new MessageProcessor([basicCatalog], action => {
      console.log('User action:', action);
      if (sendAndProcessRef.current) {
        sendAndProcessRef.current({version: 'v0.9', action});
      }
    });
  }, []);

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <ShellContent
        config={config}
        client={client}
        sendAndProcessRef={sendAndProcessRef}
        processor={processor}
      />
    </MarkdownContext.Provider>
  );
}

interface ShellContentProps {
  config: AppConfig;
  client: A2UIClient;
  sendAndProcessRef: React.MutableRefObject<
    ((message: A2uiClientMessage | string) => Promise<void>) | null
  >;
  processor: MessageProcessor<ReactComponentImplementation>;
}

function ShellContent({config, client, sendAndProcessRef, processor}: ShellContentProps) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<A2uiMessage[]>([]);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.body.classList.add('dark');
    }
    return prefersDark;
  });

  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactComponentImplementation>[]>(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  useEffect(() => {
    const sub1 = processor.onSurfaceCreated(surface => {
      setSurfaces(prev => [...prev, surface]);
    });
    const sub2 = processor.onSurfaceDeleted(id => {
      setSurfaces(prev => prev.filter(s => s.id !== id));
    });
    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
    };
  }, [processor]);

  // Loading text rotation
  useEffect(() => {
    if (!requesting) return;
    if (!Array.isArray(config.loadingText) || config.loadingText.length <= 1) return;

    const interval = setInterval(() => {
      setLoadingTextIndex(prev => (prev + 1) % config.loadingText!.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [requesting, config.loadingText]);

  // Generate mock response based on message/action
  const getMockResponse = useCallback((message: A2uiClientMessage | string): A2uiMessage[] => {
    // Handle user actions
    if (typeof message === 'object' && 'action' in message) {
      const action = message.action;
      const context = action.context || {};

      if (action.name === 'book_restaurant') {
        // User clicked "Book Now" - show booking form
        return createBookingFormMessages(
          String(context.restaurantName || 'Restaurant'),
          String(context.imageUrl || ''),
          String(context.address || ''),
        );
      }

      if (action.name === 'submit_booking') {
        // User submitted booking - show confirmation
        return createConfirmationMessages(
          String(context.restaurantName || 'Restaurant'),
          String(context.partySize || '2'),
          String(context.reservationTime || ''),
          String(context.dietary || ''),
          String(context.imageUrl || ''),
        );
      }
    }

    // Default: show restaurant list
    return createRestaurantListMessages();
  }, []);

  // Send message to agent and process response
  const sendAndProcess = useCallback(
    async (message: A2uiClientMessage | string) => {
      try {
        setRequesting(true);
        setError(null);
        setLoadingTextIndex(0);

        Array.from(processor.model.surfacesMap.keys()).forEach(id => {
          processor.model.deleteSurface(id);
        });

        let response: A2uiMessage[];

        if (isMockMode) {
          // Simulate network delay in mock mode
          await new Promise(resolve => setTimeout(resolve, 800));
          response = getMockResponse(message);
          console.log('Mock response:', response);
          processor.processMessages(response);
          setMessages(response);
        } else {
          setMessages([]);

          response = await client.send(message, chunkMessages => {
            console.log('Chunk messages:', chunkMessages);
            processor.processMessages(chunkMessages);
            setMessages(prev => [...prev, ...chunkMessages]);

            // A2uiSurface subscribes to its surface via useSyncExternalStore;
            // the onSurfaceCreated/Deleted subscription in useEffect handles
            // add/remove. No manual re-render needed.
          });
          console.log('Agent response complete:', response);
          setMessages(response);
        }
      } catch (err) {
        console.error('Error sending message:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setRequesting(false);
      }
    },
    [client, processor, getMockResponse],
  );

  // Expose sendAndProcess to parent via ref for action handling
  useEffect(() => {
    sendAndProcessRef.current = sendAndProcess;
  }, [sendAndProcess, sendAndProcessRef]);

  // Handle form submission
  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const body = formData.get('body') as string;
      if (!body) return;

      sendAndProcess(body);
    },
    [sendAndProcess],
  );

  // Toggle dark mode
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => {
      const newValue = !prev;
      if (newValue) {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
      } else {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
      }
      return newValue;
    });
  }, []);

  // Get current loading text
  const loadingText = useMemo(() => {
    if (!config.loadingText) return 'Awaiting an answer...';
    if (Array.isArray(config.loadingText)) {
      return config.loadingText[loadingTextIndex];
    }
    return config.loadingText;
  }, [config.loadingText, loadingTextIndex]);

  // Get surfaces to render
  const hasSurfaces = surfaces.length > 0;
  const showForm = !requesting && messages.length === 0;

  return (
    <div className="shell">
      {/* Mock mode indicator */}
      {isMockMode && <div className="mock-badge">Mock Mode</div>}

      {/* Theme toggle button */}
      <button className="theme-toggle" onClick={toggleDarkMode}>
        <span className="g-icon filled-heavy material-symbols-outlined">
          {isDarkMode ? 'light_mode' : 'dark_mode'}
        </span>
      </button>

      {/* Search form - only shown when no messages */}
      {showForm && (
        <form className="search-form" onSubmit={handleSubmit}>
          {config.heroImage && (
            <div
              className="hero-img"
              style={
                {
                  '--background-image-light': `url(${config.heroImage})`,
                  '--background-image-dark': `url(${config.heroImageDark || config.heroImage})`,
                } as React.CSSProperties
              }
            />
          )}
          <h1 className="app-title">{config.title}</h1>
          <div className="input-row">
            <input
              required
              defaultValue={config.placeholder}
              autoComplete="off"
              id="body"
              name="body"
              type="text"
              disabled={requesting}
            />
            <button type="submit" disabled={requesting}>
              <span className="g-icon filled-heavy">send</span>
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {requesting && (
        <div className="pending">
          <div className="spinner" />
          <div className="loading-text">{loadingText}</div>
        </div>
      )}

      {/* Error display */}
      {error && <div className="error">{error}</div>}

      {/* Render all surfaces */}
      {hasSurfaces && (
        <section className="surfaces">
          {surfaces.map(surface => (
            <A2uiSurface key={surface.id} surface={surface} />
          ))}
        </section>
      )}
    </div>
  );
}
