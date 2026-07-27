/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
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

'use client';

import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  Play,
  Pause,
  SkipBack,
  Settings,
  ChevronDown,
  Activity,
  Code2,
  Zap,
  LayoutTemplate,
  Monitor,
  Database,
} from 'lucide-react';
import {useStreamingPlayer} from '@/components/theater/useStreamingPlayer';
import {useA2UISurface} from '@/components/theater/useA2UISurface';
import {A2UIViewer} from '@/lib/a2ui';
import {Button} from '@/components/ui/button';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {scenarios, ScenarioId} from '@/data/theater';

const RENDERERS = ['Lit (Web Components)', 'React', 'Angular'] as const;
type RendererType = (typeof RENDERERS)[number];
type LeftTab = 'events' | 'data' | 'config';

function updateURL(scenario: string, step: number, renderer: string) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  params.set('scenario', scenario);
  if (step > 0) params.set('step', String(step));
  if (renderer !== RENDERERS[0]) params.set('renderer', renderer);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

function readURL(): {scenario?: string; step?: number; renderer?: string} {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    scenario: params.get('scenario') || undefined,
    step: params.get('step') ? parseInt(params.get('step')!, 10) : undefined,
    renderer: params.get('renderer') || undefined,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function TheaterPage() {
  const [mounted, setMounted] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('data');
  const [mobileView, setMobileView] = useState<'left' | 'renderer'>('renderer');
  const [renderer, setRenderer] = useState<RendererType>(RENDERERS[0]);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>(() => {
    const url = readURL();
    return url.scenario && url.scenario in scenarios
      ? (url.scenario as ScenarioId)
      : 'restaurant-booking';
  });

  const {
    playbackState,
    progress,
    totalChunks,
    speed,
    receivedChunks,
    activeMessages,
    visibleEvents,
    bytesReceived,
    totalBytes,
    play,
    pause,
    stop,
    seek,
    setSpeed,
  } = useStreamingPlayer((scenarios[selectedScenario] as any) || [], 1200);

  const surfaceState = useA2UISurface(activeMessages);

  useEffect(() => {
    const url = readURL();
    if (url.renderer && RENDERERS.includes(url.renderer as RendererType))
      setRenderer(url.renderer as RendererType);
    if (url.step !== undefined) seek(url.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updateURL(selectedScenario, progress, renderer);
  }, [selectedScenario, progress, renderer]);

  const handleScenarioChange = useCallback(
    (id: ScenarioId) => {
      setSelectedScenario(id);
      stop();
    },
    [stop],
  );

  const dataEndRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playbackState === 'playing') {
      dataEndRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
      eventsEndRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
    }
  }, [progress, playbackState]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          if (playbackState === 'playing') {
            pause();
          } else {
            play();
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(progress + (e.shiftKey ? 5 : 1), totalChunks));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(progress - (e.shiftKey ? 5 : 1), 0));
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playbackState, progress, totalChunks, play, pause, seek]);

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground font-sans">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground font-sans selection:bg-primary/30">
      {/* Header */}
      <header className="relative z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-4 md:px-6 backdrop-blur-md">
        <div className="hidden md:flex items-center gap-1 rounded-xl bg-muted/50 p-1 shadow-inner border border-border/50">
          {[
            {id: 'events' as LeftTab, icon: Activity, label: 'Events'},
            {id: 'data' as LeftTab, icon: Database, label: 'Data'},
            {id: 'config' as LeftTab, icon: Settings, label: 'Config'},
          ].map(tab => (
            <Button
              key={tab.id}
              variant="ghost"
              size="sm"
              className={`h-8 text-xs font-medium px-3 gap-1.5 rounded-lg transition-all ${leftTab === tab.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setLeftTab(tab.id)}
            >
              <tab.icon className="h-3.5 w-3.5" /> {tab.label}
            </Button>
          ))}
        </div>

        {/* Playback */}
        <div className="flex flex-1 max-w-2xl items-center gap-3 md:gap-5">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full border-border/50"
              onClick={stop}
            >
              <SkipBack className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
            {playbackState === 'playing' ? (
              <Button
                variant="default"
                size="icon"
                className="h-9 w-9 rounded-full shadow-md"
                onClick={pause}
              >
                <Pause className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="default"
                size="icon"
                className="h-9 w-9 rounded-full shadow-md bg-primary"
                onClick={play}
              >
                <Play className="h-4 w-4 ml-0.5" />
              </Button>
            )}
          </div>
          <div className="flex-1 flex items-center gap-3 group">
            <span className="text-[10px] font-mono text-muted-foreground w-6 text-right tabular-nums">
              {progress}
            </span>
            <div className="relative flex-1 flex items-center h-5">
              <input
                type="range"
                min="0"
                max={totalChunks}
                value={progress}
                onChange={e => seek(parseInt(e.target.value, 10))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200 ease-out"
                  style={{width: `${totalChunks > 0 ? (progress / totalChunks) * 100 : 0}%`}}
                />
              </div>
              <div
                className="absolute h-2.5 w-2.5 bg-primary rounded-full shadow-sm border border-background pointer-events-none"
                style={{
                  left: `calc(${totalChunks > 0 ? (progress / totalChunks) * 100 : 0}% - 5px)`,
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground w-6 tabular-nums">
              {totalChunks}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-12 text-[10px] font-mono font-medium rounded-full border-border/50"
            onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : speed === 4 ? 0.5 : 1)}
          >
            {speed}x
          </Button>
        </div>

        {/* Status */}
        <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
          {playbackState === 'playing' && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Streaming
            </span>
          )}
          <span className="font-mono tabular-nums">{formatBytes(bytesReceived)}</span>
        </div>
      </header>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Pane */}
        <ResizablePanel
          defaultSize={38}
          minSize={25}
          maxSize={55}
          className={`bg-muted/20 border-r border-border/50 ${mobileView === 'left' ? 'flex' : 'hidden md:flex'} flex-col`}
        >
          <div className="h-full flex flex-col relative">
            <div className="absolute inset-0 overflow-y-auto p-4 custom-scrollbar">
              {leftTab === 'events' ? (
                <div className="flex flex-col gap-2 pb-8">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Activity className="h-3 w-3 text-primary" /> Lifecycle Events
                  </h2>
                  {visibleEvents.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      Press play to see events...
                    </p>
                  )}
                  {visibleEvents.map((evt, i) => (
                    <div
                      key={i}
                      onClick={() => seek(evt.chunkIndex + 1)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all hover:scale-[1.01] ${
                        evt.type === 'surface'
                          ? 'border-blue-500/30 bg-blue-500/5'
                          : evt.type === 'components'
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : evt.type === 'data'
                              ? 'border-amber-500/30 bg-amber-500/5'
                              : evt.type === 'action'
                                ? 'border-purple-500/30 bg-purple-500/5'
                                : 'border-red-500/30 bg-red-500/5'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-[9px] font-bold uppercase ${
                            evt.type === 'surface'
                              ? 'text-blue-500'
                              : evt.type === 'components'
                                ? 'text-emerald-500'
                                : evt.type === 'data'
                                  ? 'text-amber-500'
                                  : evt.type === 'action'
                                    ? 'text-purple-500'
                                    : 'text-red-500'
                          }`}
                        >
                          {evt.type === 'action' ? '↑' : '↓'} {evt.type}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-foreground/90">{evt.summary}</p>
                    </div>
                  ))}
                  <div ref={eventsEndRef} className="h-2" />
                </div>
              ) : leftTab === 'data' ? (
                /* DATA TAB — real JSONL chunks as they arrive over the wire */
                <div className="flex flex-col gap-2 pb-8">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Database className="h-3 w-3 text-amber-500" /> JSONL Stream
                  </h2>
                  {receivedChunks.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      Press play to stream JSONL chunks...
                    </p>
                  )}
                  {receivedChunks.map((chunk, i) => (
                    <div
                      key={i}
                      onClick={() => seek(chunk.index + 1)}
                      className={`rounded-lg border overflow-hidden cursor-pointer transition-all ${
                        chunk.index === progress - 1
                          ? chunk.isClient
                            ? 'border-purple-500/50 ring-1 ring-purple-500/20 scale-[1.01]'
                            : 'border-primary/50 ring-1 ring-primary/20 scale-[1.01]'
                          : chunk.isClient
                            ? 'border-purple-500/20 hover:border-purple-500/40'
                            : 'border-border/50 hover:border-primary/30'
                      }`}
                    >
                      {/* Chunk header */}
                      <div
                        className={`flex items-center justify-between px-3 py-1.5 ${
                          chunk.isClient ? 'bg-purple-500/10' : 'bg-muted/30'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-bold tabular-nums bg-muted/50 rounded px-1.5 py-0.5">
                            #{chunk.index + 1}
                          </span>
                          <span
                            className={`text-[9px] font-bold ${chunk.isClient ? 'text-purple-500' : 'text-primary/70'}`}
                          >
                            {chunk.isClient ? '↑ CLIENT' : '↓ SERVER'}
                          </span>
                        </div>
                        <span className="text-[9px] text-muted-foreground font-mono">
                          {formatBytes(chunk.bytes)}
                        </span>
                      </div>
                      {/* Wire content — single JSONL line */}
                      <div className="px-3 py-2 font-mono text-[10px] leading-relaxed overflow-x-auto custom-scrollbar-sm bg-card/50">
                        <code className="text-foreground/80 break-all">{chunk.wire}</code>
                      </div>
                    </div>
                  ))}
                  {/* Streaming cursor */}
                  {playbackState === 'playing' && progress < totalChunks && (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <span className="w-1.5 h-3 bg-primary animate-pulse rounded-sm" />
                      <span>Waiting for next chunk...</span>
                    </div>
                  )}
                  <div ref={dataEndRef} className="h-2" />
                </div>
              ) : (
                /* CONFIG TAB */
                <div className="space-y-5">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Settings className="h-3 w-3" /> Configuration
                  </h2>
                  <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" /> Scenario
                    </h3>
                    <div className="relative">
                      <select
                        value={selectedScenario}
                        onChange={e => handleScenarioChange(e.target.value as ScenarioId)}
                        className="w-full text-sm p-2 pl-3 pr-8 border border-border/50 rounded-lg bg-background appearance-none shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                      >
                        {Object.keys(scenarios).map(id => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {totalChunks} chunks • {formatBytes(totalBytes)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-primary" /> Renderer
                    </h3>
                    <div className="relative">
                      <select
                        value={renderer}
                        onChange={e => setRenderer(e.target.value as RendererType)}
                        className="w-full text-sm p-2 pl-3 pr-8 border border-border/50 rounded-lg bg-background appearance-none shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                      >
                        {RENDERERS.map(r => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" /> Transport
                    </h3>
                    <div className="relative">
                      <select className="w-full text-sm p-2 pl-3 pr-8 border border-border/50 rounded-lg bg-background appearance-none shadow-sm cursor-pointer">
                        <option>A2A (Server Sent Events)</option>
                        <option>AG UI (Stream)</option>
                        <option>WebSocket</option>
                        <option>REST Polling</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Simulated in-memory playback.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          className="hidden md:flex bg-border/50 hover:bg-primary/50 transition-colors"
        />

        {/* Right Pane: Renderer */}
        <ResizablePanel
          defaultSize={62}
          className={`${mobileView === 'renderer' ? 'flex' : 'hidden md:flex'} flex-col`}
        >
          <div className="h-full bg-muted/10 relative overflow-hidden flex flex-col">
            <div className="absolute inset-0 p-6 overflow-y-auto custom-scrollbar">
              <div className="max-w-4xl mx-auto">
                <div className="flex flex-col rounded-2xl border border-border/60 bg-background shadow-xl overflow-hidden min-h-[500px]">
                  <div className="h-10 bg-muted/30 border-b flex items-center px-4 justify-between">
                    <div className="hidden sm:flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-400/80" />
                      <div className="w-2 h-2 rounded-full bg-amber-400/80" />
                      <div className="w-2 h-2 rounded-full bg-green-400/80" />
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground tracking-wide flex items-center gap-1.5">
                      <Code2 className="h-3 w-3" /> {renderer}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {selectedScenario}
                    </span>
                  </div>
                  <div className="p-4 bg-dot-pattern">
                    {surfaceState.components.length > 0 ? (
                      <div className="w-full flex items-start justify-center">
                        <A2UIViewer
                          root={surfaceState.root}
                          components={surfaceState.components}
                          data={surfaceState.data}
                          onAction={action => console.log('Theater Action:', action)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Code2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-mono text-sm text-foreground mb-0.5">
                            {'<A2UIRenderer />'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Press play to start streaming
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Mobile Nav */}
      <div className="flex md:hidden w-full items-center gap-1 bg-background/95 backdrop-blur-md p-2 border-t border-border/50 z-50">
        {[
          {view: 'left' as const, tab: 'events' as LeftTab, icon: Activity, label: 'Events'},
          {view: 'renderer' as const, tab: null, icon: LayoutTemplate, label: 'Render'},
          {view: 'left' as const, tab: 'data' as LeftTab, icon: Database, label: 'Data'},
          {view: 'left' as const, tab: 'config' as LeftTab, icon: Settings, label: 'Config'},
        ].map(item => (
          <Button
            key={item.label}
            variant="ghost"
            size="sm"
            className={`flex-1 h-11 flex-col gap-0.5 text-[9px] font-medium ${
              (item.tab ? mobileView === 'left' && leftTab === item.tab : mobileView === 'renderer')
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground'
            }`}
            onClick={() => {
              setMobileView(item.view);
              if (item.tab) setLeftTab(item.tab);
            }}
          >
            <item.icon className="h-3.5 w-3.5" /> {item.label}
          </Button>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 10px; }
        .custom-scrollbar-sm::-webkit-scrollbar { height: 4px; }
        .custom-scrollbar-sm::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar-sm::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 10px; }
        .bg-dot-pattern { background-image: radial-gradient(rgba(156,163,175,0.15) 1px, transparent 1px); background-size: 16px 16px; }
      `,
        }}
      />
    </div>
  );
}
