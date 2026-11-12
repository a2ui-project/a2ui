// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package adk

import (
	"context"
	"fmt"
	"sync"

	adkagent "google.golang.org/adk/v2/agent"

	"github.com/a2ui-project/a2ui/go/agent"
)

// EnabledProvider reports whether A2UI generation is enabled for an ADK invocation context.
type EnabledProvider func(ctx adkagent.ReadonlyContext) (bool, error)

// ProcessorProvider resolves the A2UI RequestProcessor for an ADK invocation context,
// or returns nil when the context has none.
type ProcessorProvider func(ctx adkagent.ReadonlyContext) (*agent.RequestProcessor, error)

// SessionProcessorProvider resolves the A2UI RequestProcessor for an ADK session ID,
// or returns nil when the session has none. Code that iterates runner.Run results has
// a session ID but no ADK context, which is why EventConverter uses this provider.
type SessionProcessorProvider func(ctx context.Context, sessionID string) (*agent.RequestProcessor, error)

// enabled reports whether A2UI is enabled for ctx. disabled turns A2UI off
// regardless of provider; otherwise provider decides, defaulting to enabled.
func enabled(disabled bool, provider EnabledProvider, ctx adkagent.ReadonlyContext) (bool, error) {
	if disabled {
		return false, nil
	}
	if provider != nil {
		return provider(ctx)
	}
	return true, nil
}

func resolveProcessor(provider ProcessorProvider, ctx adkagent.ReadonlyContext, caller string) (*agent.RequestProcessor, error) {
	if provider == nil {
		return nil, fmt.Errorf("%s has no ProcessorProvider, but A2UI is enabled", caller)
	}
	resolved, err := provider(ctx)
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, fmt.Errorf("%s got no A2UI RequestProcessor for a context with A2UI enabled", caller)
	}
	return resolved, nil
}

// ProcessorStore holds each session's RequestProcessor in memory outside JSON-serialized ADK session state.
type ProcessorStore struct {
	mu         sync.RWMutex
	processors map[string]*agent.RequestProcessor
}

// NewProcessorStore creates an empty concurrency-safe ProcessorStore.
func NewProcessorStore() *ProcessorStore {
	return &ProcessorStore{
		processors: make(map[string]*agent.RequestProcessor),
	}
}

// Set stores processor for sessionID, or removes sessionID when processor is nil.
func (s *ProcessorStore) Set(sessionID string, processor *agent.RequestProcessor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if processor == nil {
		delete(s.processors, sessionID)
		return
	}
	s.processors[sessionID] = processor
}

// Remove deletes any RequestProcessor stored for sessionID.
func (s *ProcessorStore) Remove(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.processors, sessionID)
}

func (s *ProcessorStore) lookup(sessionID string) *agent.RequestProcessor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.processors[sessionID]
}

// Get returns the RequestProcessor stored for ctx.SessionID(), or nil if there is none.
// It has the ProcessorProvider signature.
func (s *ProcessorStore) Get(ctx adkagent.ReadonlyContext) (*agent.RequestProcessor, error) {
	if ctx == nil {
		return nil, nil
	}
	return s.lookup(ctx.SessionID()), nil
}

// ForSession returns the RequestProcessor stored for sessionID, or nil if there is none.
// It has the SessionProcessorProvider signature.
func (s *ProcessorStore) ForSession(_ context.Context, sessionID string) (*agent.RequestProcessor, error) {
	return s.lookup(sessionID), nil
}

// IsEnabled reports whether a RequestProcessor is stored for ctx.SessionID().
// It has the EnabledProvider signature.
func (s *ProcessorStore) IsEnabled(ctx adkagent.ReadonlyContext) (bool, error) {
	if ctx == nil {
		return false, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.processors[ctx.SessionID()]
	return ok, nil
}

// Len returns the number of active sessions tracked in the store.
func (s *ProcessorStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.processors)
}

// RendererCallsStore holds each session's RendererFunctionCalls manager in memory.
type RendererCallsStore struct {
	mu    sync.Mutex
	opts  agent.RendererFunctionCallsOptions
	calls map[string]*agent.RendererFunctionCalls
}

// NewRendererCallsStore creates a concurrency-safe RendererCallsStore, validating opts eagerly.
func NewRendererCallsStore(opts *agent.RendererFunctionCallsOptions) (*RendererCallsStore, error) {
	var resolved agent.RendererFunctionCallsOptions
	if opts != nil {
		resolved = *opts
	}
	if _, err := agent.NewRendererFunctionCalls(&resolved); err != nil {
		return nil, err
	}
	return &RendererCallsStore{
		opts:  resolved,
		calls: make(map[string]*agent.RendererFunctionCalls),
	}, nil
}

// Get returns or creates the RendererFunctionCalls manager for ctx.SessionID().
func (s *RendererCallsStore) Get(ctx adkagent.ReadonlyContext) (*agent.RendererFunctionCalls, error) {
	if ctx == nil {
		return nil, fmt.Errorf("readonly context must not be nil")
	}
	return s.ForSession(ctx.SessionID())
}

// ForSession returns the RendererFunctionCalls manager for sessionID, creating it, or
// replacing a disposed one, as needed.
func (s *RendererCallsStore) ForSession(sessionID string) (*agent.RendererFunctionCalls, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing := s.calls[sessionID]
	if existing == nil || existing.Disposed() {
		created, err := agent.NewRendererFunctionCalls(&s.opts)
		if err != nil {
			return nil, err
		}
		s.calls[sessionID] = created
		return created, nil
	}
	return existing, nil
}

// Remove removes and disposes the RendererFunctionCalls manager for sessionID, if present.
func (s *RendererCallsStore) Remove(sessionID, reason string) {
	if reason == "" {
		reason = "The session was removed."
	}
	s.mu.Lock()
	instance, ok := s.calls[sessionID]
	if ok {
		delete(s.calls, sessionID)
	}
	s.mu.Unlock()
	if ok && instance != nil {
		instance.Dispose(reason)
	}
}

// Dispose removes and disposes every session's RendererFunctionCalls manager.
func (s *RendererCallsStore) Dispose(reason string) {
	if reason == "" {
		reason = "The store was disposed."
	}
	s.mu.Lock()
	all := s.calls
	s.calls = make(map[string]*agent.RendererFunctionCalls)
	s.mu.Unlock()
	for _, inst := range all {
		inst.Dispose(reason)
	}
}

// Has reports whether sessionID currently holds an entry in the store.
func (s *RendererCallsStore) Has(sessionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.calls[sessionID]
	return ok
}

// Len returns the number of sessions tracked in the store.
func (s *RendererCallsStore) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}
