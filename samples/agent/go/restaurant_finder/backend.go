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

package main

import (
	"container/list"
	"context"
	"fmt"
	"iter"
	"sync"

	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/model/gemini"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/adk"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// turnInput describes one model inference turn executed by a ModelBackend.
type turnInput struct {
	ContextID    string
	Query        string
	ActionName   string
	Profile      versionProfile
	Processor    *agent.RequestProcessor
	UseStreaming bool
}

// modelBackend streams model output chunks for a single turn.
type modelBackend interface {
	StreamTurn(ctx context.Context, input turnInput) iter.Seq2[string, error]
}

// stubBackend serves deterministic 4-chunk canned responses in the configured A2UI format.
type stubBackend struct {
	responses map[string]map[string]string
}

// newStubBackend precomputes stub-notice + example responses for every served version and action.
func newStubBackend(repoRoot string, format a2uiFormat, catalogs map[string]*core.Catalog) (*stubBackend, error) {
	responses := make(map[string]map[string]string, len(servedVersions))
	for _, profile := range servedVersions {
		cat := catalogs[profile.Version]
		notice, err := loadStubNotice(repoRoot, profile)
		if err != nil {
			return nil, err
		}
		_, examplesByName, err := loadExampleTurns(repoRoot, profile)
		if err != nil {
			return nil, err
		}
		byExample := make(map[string]string, 3)
		for _, name := range []string{"single_column_list", "booking_form", "confirmation"} {
			ex, ok := examplesByName[name]
			if !ok {
				return nil, fmt.Errorf("missing example %q for %s", name, profile.Version)
			}
			combined := make([]core.AgentToRendererMessage, 0, len(notice)+len(ex))
			combined = append(combined, notice...)
			combined = append(combined, ex...)
			rendered, err := toResponseText(cat, format, combined)
			if err != nil {
				return nil, fmt.Errorf("render stub %s (%s, %s): %w", name, profile.Version, format, err)
			}
			byExample[name] = rendered
		}
		responses[profile.Version] = byExample
	}
	return &stubBackend{responses: responses}, nil
}

// StreamTurn slices the canned response into 4 chunks so streaming validation is exercised end to end.
func (b *stubBackend) StreamTurn(_ context.Context, input turnInput) iter.Seq2[string, error] {
	return func(yield func(string, error) bool) {
		exampleName := "single_column_list"
		switch input.ActionName {
		case "book_restaurant":
			exampleName = "booking_form"
		case "submit_booking":
			exampleName = "confirmation"
		}
		text := b.responses[input.Profile.Version][exampleName]
		if len(text) == 0 {
			return
		}
		chunkSize := (len(text) + 3) / 4
		for start := 0; start < len(text); start += chunkSize {
			end := min(start+chunkSize, len(text))
			if !yield(text[start:end], nil) {
				return
			}
		}
	}
}

const (
	adkAppName         = "restaurant_finder"
	adkUserID          = "remote_agent"
	defaultMaxSessions = 1000
)

type sessionEntry struct {
	key  string
	mu   sync.Mutex
	refs int
}

// adkBackend executes turns through Google ADK-Go (llmagent + gemini + runner + go/adk).
type adkBackend struct {
	runner         *runner.Runner
	sessionService session.Service
	processors     *adk.ProcessorStore
	baseURL        string
	maxSessions    int

	mu       sync.Mutex
	lru      *list.List
	sessions map[string]*list.Element
}

// adkBackendOptions configures NewADKBackend.
type adkBackendOptions struct {
	Config          sampleConfig
	BaseURL         string
	PythonSampleDir string
}

// newADKBackend initializes an ADK-Go LLMAgent backed by Gemini (API key or Vertex AI)
// using go/adk's InstructionProvider, ProcessorStore, and ExcludeRPCFromPrompt.
func newADKBackend(ctx context.Context, opts adkBackendOptions) (*adkBackend, error) {
	var clientCfg genai.ClientConfig
	if opts.Config.UseVertexAI {
		clientCfg = genai.ClientConfig{
			Backend:  genai.BackendVertexAI,
			Project:  opts.Config.VertexProject,
			Location: opts.Config.VertexLoc,
		}
	} else {
		clientCfg = genai.ClientConfig{
			Backend: genai.BackendGeminiAPI,
			APIKey:  opts.Config.GeminiAPIKey,
		}
	}

	llm, err := gemini.NewModel(ctx, opts.Config.ModelName, &clientCfg)
	if err != nil {
		return nil, fmt.Errorf("initialize Gemini model %q: %w", opts.Config.ModelName, err)
	}

	return newADKBackendWithModel(llm, opts.BaseURL, opts.PythonSampleDir, opts.Config.Format, defaultMaxSessions)
}

func newADKBackendWithModel(
	llm model.LLM,
	baseURL, pythonSampleDir string,
	format a2uiFormat,
	maxSessions int,
) (*adkBackend, error) {
	if maxSessions <= 0 {
		maxSessions = defaultMaxSessions
	}
	restaurantsTool, err := newGetRestaurantsTool(baseURL, pythonSampleDir)
	if err != nil {
		return nil, fmt.Errorf("create get_restaurants tool: %w", err)
	}

	processors := adk.NewProcessorStore()
	baseInst := buildBaseInstruction(format)

	llmAgent, err := llmagent.New(llmagent.Config{
		Name:        "restaurant_agent",
		Description: "An agent that finds restaurants and helps book tables.",
		Model:       llm,
		InstructionProvider: adk.InstructionProvider(adk.InstructionConfig{
			Instruction:       baseInst,
			EnabledProvider:   processors.IsEnabled,
			ProcessorProvider: processors.Get,
		}),
		BeforeModelCallbacks: []llmagent.BeforeModelCallback{
			adk.ExcludeRPCFromPrompt,
		},
		Tools: []tool.Tool{restaurantsTool},
	})
	if err != nil {
		return nil, fmt.Errorf("create ADK LLMAgent: %w", err)
	}

	sessSvc := session.InMemoryService()
	r, err := runner.New(runner.Config{
		AppName:           adkAppName,
		Agent:             llmAgent,
		SessionService:    sessSvc,
		AutoCreateSession: true,
	})
	if err != nil {
		return nil, fmt.Errorf("create ADK runner: %w", err)
	}

	return &adkBackend{
		runner:         r,
		sessionService: sessSvc,
		processors:     processors,
		baseURL:        baseURL,
		maxSessions:    maxSessions,
		lru:            list.New(),
		sessions:       make(map[string]*list.Element),
	}, nil
}

func (b *adkBackend) acquireSession(ctx context.Context, sessionKey string, proc *agent.RequestProcessor) (func(), error) {
	b.mu.Lock()
	var entry *sessionEntry
	if elem, ok := b.sessions[sessionKey]; ok {
		entry = elem.Value.(*sessionEntry)
		entry.refs++
		b.lru.MoveToFront(elem)
	} else {
		entry = &sessionEntry{key: sessionKey, refs: 1}
		b.sessions[sessionKey] = b.lru.PushFront(entry)
	}
	evicted := b.collectEvictionsLocked()
	b.mu.Unlock()

	b.deleteSessions(ctx, evicted)

	entry.mu.Lock()
	if err := ctx.Err(); err != nil {
		entry.mu.Unlock()
		b.mu.Lock()
		entry.refs--
		moreEvicted := b.collectEvictionsLocked()
		b.mu.Unlock()
		b.deleteSessions(ctx, moreEvicted)
		return nil, err
	}
	b.processors.Set(sessionKey, proc)

	return func() {
		b.processors.Remove(sessionKey)
		entry.mu.Unlock()
		b.mu.Lock()
		entry.refs--
		moreEvicted := b.collectEvictionsLocked()
		b.mu.Unlock()
		b.deleteSessions(ctx, moreEvicted)
	}, nil
}

func (b *adkBackend) collectEvictionsLocked() []string {
	var evicted []string
	for elem := b.lru.Back(); elem != nil && b.lru.Len() > b.maxSessions; {
		prev := elem.Prev()
		entry := elem.Value.(*sessionEntry)
		if entry.refs == 0 {
			b.lru.Remove(elem)
			delete(b.sessions, entry.key)
			evicted = append(evicted, entry.key)
		}
		elem = prev
	}
	return evicted
}

func (b *adkBackend) deleteSessions(ctx context.Context, keys []string) {
	if len(keys) == 0 {
		return
	}
	bgCtx := context.WithoutCancel(ctx)
	for _, key := range keys {
		b.processors.Remove(key)
		_ = b.sessionService.Delete(bgCtx, &session.DeleteRequest{
			AppName:   adkAppName,
			UserID:    adkUserID,
			SessionID: key,
		})
	}
}

// StreamTurn runs one ADK session turn, streaming incremental SSE text chunks without duplicating
// ADK's final aggregated event text. If the caller stops consuming early (for example, mid-stream
// A2UI validation failure), the underlying ADK turn is still drained so session history stays balanced.
func (b *adkBackend) StreamTurn(ctx context.Context, input turnInput) iter.Seq2[string, error] {
	return func(yield func(string, error) bool) {
		sessionKey := fmt.Sprintf("%s:%s", input.ContextID, input.Profile.Version)
		release, err := b.acquireSession(ctx, sessionKey, input.Processor)
		if err != nil {
			yield("", err)
			return
		}
		defer release()

		mode := adkagent.StreamingModeSSE
		if !input.UseStreaming {
			mode = adkagent.StreamingModeNone
		}
		userMsg := genai.NewContentFromText(input.Query, genai.RoleUser)

		sawPartialInStep := false
		stopped := false
		for ev, err := range b.runner.Run(
			ctx,
			adkUserID,
			sessionKey,
			userMsg,
			adkagent.RunConfig{StreamingMode: mode},
			runner.WithStateDelta(map[string]any{"base_url": b.baseURL}),
		) {
			if err != nil {
				if !stopped {
					yield("", err)
				}
				return
			}
			if stopped {
				if ctx.Err() != nil {
					return
				}
				continue
			}
			if ev == nil || ev.Content == nil {
				continue
			}

			hasToolPart := false
			for _, p := range ev.Content.Parts {
				if p != nil && (p.FunctionCall != nil || p.FunctionResponse != nil) {
					hasToolPart = true
					break
				}
			}
			if hasToolPart {
				sawPartialInStep = false
			}

			if ev.Partial {
				for _, p := range ev.Content.Parts {
					if p != nil && p.Text != "" && !p.Thought {
						sawPartialInStep = true
						if !yield(p.Text, nil) {
							stopped = true
							break
						}
					}
				}
				continue
			}

			if !sawPartialInStep {
				for _, p := range ev.Content.Parts {
					if p != nil && p.Text != "" && !p.Thought {
						if !yield(p.Text, nil) {
							stopped = true
							break
						}
					}
				}
			}
			sawPartialInStep = false
		}
	}
}
