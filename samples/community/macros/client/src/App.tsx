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

import {useState} from 'react';
import {ChatView} from './components/ChatView';
import {MacroStudioView} from './components/MacroStudioView';

export default function App() {
  const [currentView, setCurrentView] = useState<'chat' | 'library'>('chat');

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
              A2UI Macros
            </h1>
            <p style={{fontSize: '11px', color: '#64748b', margin: 0}}>
              Programmatic Server-Side Expansion · Basic Catalog
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
              widgets
            </span>
            Macro Studio / Library
          </button>
        </div>
      </header>

      {/* Main Content View */}
      {currentView === 'chat' ? <ChatView /> : <MacroStudioView />}
    </div>
  );
}
