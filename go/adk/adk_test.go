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

package adk_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/a2aproject/a2a-go/a2a"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/session"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/adk"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func TestStoresAndInstructionTemplateProtection(t *testing.T) {
	store := adk.NewProcessorStore()
	ctx1 := newFakeToolContext("s-1", map[string]any{
		"city":       "New York",
		"expression": "SHOULD_NOT_OVERRIDE",
	})
	enabled, err := store.IsEnabled(ctx1)
	if err != nil || enabled {
		t.Fatalf("expected disabled before Set, got (%v, %v)", enabled, err)
	}

	callsStore, err := adk.NewRendererCallsStore(nil)
	if err != nil {
		t.Fatalf("NewRendererCallsStore failed: %v", err)
	}
	c1, err := callsStore.Get(ctx1)
	if err != nil || c1 == nil {
		t.Fatalf("callsStore.Get failed: %v", err)
	}
	callsStore.Remove("s-1", "cleanup")
	if !c1.Disposed() || callsStore.Has("s-1") {
		t.Fatalf("expected disposed and removed session")
	}

	cat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog(1.0) failed: %v", err)
	}
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		t.Fatalf("NewRequestProcessor failed: %v", err)
	}
	store.Set("s-1", proc)

	provider := adk.InstructionProvider(adk.InstructionConfig{
		Instruction:       "Find restaurants in {city}.",
		EnabledProvider:   store.IsEnabled,
		ProcessorProvider: store.Get,
	})
	rendered, err := provider(ctx1)
	if err != nil {
		t.Fatalf("InstructionProvider failed: %v", err)
	}
	if !strings.HasPrefix(rendered, "Find restaurants in New York.") {
		t.Fatalf("rendered = %q, want prefix %q", rendered, "Find restaurants in New York.")
	}
	if strings.Contains(rendered, "SHOULD_NOT_OVERRIDE") {
		t.Fatalf("expected A2UI prompt braces to escape state substitution")
	}
}

func TestExcludeRPCFromPromptAndInterceptor(t *testing.T) {
	rpcCallPart, err := adk.EncodeA2APartToGenAI(a2aext.CreateA2UIPart(map[string]any{
		"version": "1.0",
		"callAgentFunction": map[string]any{
			"functionCallId": "fc-1",
			"surfaceId":      "s1",
			"callFunction":   map[string]any{"@call": "ping"},
		},
	}, "1.0"))
	if err != nil {
		t.Fatalf("EncodeA2APartToGenAI failed: %v", err)
	}
	rpcReplyPart, err := adk.EncodeA2APartToGenAI(a2aext.CreateA2UIPart(map[string]any{
		"version":               "1.0",
		"agentFunctionResponse": map[string]any{"functionCallId": "fc-1", "value": "pong"},
	}, "1.0"))
	if err != nil {
		t.Fatalf("EncodeA2APartToGenAI failed: %v", err)
	}
	actionPart, err := adk.EncodeA2APartToGenAI(a2aext.CreateA2UIPart(map[string]any{
		"version": "1.0",
		"action": map[string]any{
			"name": "submit", "surfaceId": "s1", "sourceComponentId": "b1",
			"timestamp": "2026-01-01T00:00:00Z", "context": map[string]any{},
		},
	}, "1.0"))
	if err != nil {
		t.Fatalf("EncodeA2APartToGenAI failed: %v", err)
	}

	req := &model.LLMRequest{
		Contents: []*genai.Content{
			{Role: genai.RoleUser, Parts: []*genai.Part{rpcCallPart}},
			{Role: genai.RoleModel, Parts: []*genai.Part{rpcReplyPart}},
			{Role: genai.RoleUser, Parts: []*genai.Part{genai.NewPartFromText("keep me"), actionPart}},
		},
	}
	if _, err := adk.ExcludeRPCFromPrompt(nil, req); err != nil {
		t.Fatalf("ExcludeRPCFromPrompt failed: %v", err)
	}
	if len(req.Contents) != 1 || len(req.Contents[0].Parts) != 2 {
		t.Fatalf("expected 1 content with 2 kept parts, got %#v", req.Contents)
	}

	interceptor := adk.NewRPCInterceptor()
	rpcMsg := a2a.NewMessage(a2a.MessageRoleUser, a2aext.CreateA2UIPart(map[string]any{
		"version":                  "1.0",
		"rendererFunctionResponse": map[string]any{"functionCallId": "rc-1", "value": "ok"},
	}, "1.0"))
	interceptor.BeforeAgent("task-rpc", rpcMsg)

	finalEvt := a2a.NewStatusUpdateEvent(a2a.TaskInfo{TaskID: "task-rpc", ContextID: "ctx-1"}, a2a.TaskStateWorking, nil)
	interceptor.AfterAgent(finalEvt)
	if finalEvt.Status.State != a2a.TaskStateCompleted {
		t.Fatalf("expected TaskStateCompleted, got %q", finalEvt.Status.State)
	}
}

func TestSubagentMapClientRoutingAndDelete(t *testing.T) {
	svc := &fakeSessionService{}
	sess := &fakeSession{id: "sess-1", state: newFakeState(nil)}

	createPart := a2aext.CreateA2UIPart(map[string]any{
		"version":       "1.0",
		"createSurface": map[string]any{"surfaceId": "surf-a"},
	}, "1.0")
	if err := adk.UpdateSurfaceOwnership(context.Background(), svc, sess, createPart, "booking_agent"); err != nil {
		t.Fatalf("UpdateFromServerEvent(create) failed: %v", err)
	}

	actionPart := a2aext.CreateA2UIPart(map[string]any{
		"version": "1.0",
		"action":  map[string]any{"name": "click", "surfaceId": "surf-a"},
	}, "1.0")
	if owner := adk.SurfaceOwnerForClientEvent(sess.State(), actionPart); owner != "booking_agent" {
		t.Fatalf("owner = %q, want booking_agent", owner)
	}

	deletePart := a2aext.CreateA2UIPart(map[string]any{
		"version":       "1.0",
		"deleteSurface": map[string]any{"surfaceId": "surf-a"},
	}, "1.0")
	if err := adk.UpdateSurfaceOwnership(context.Background(), svc, sess, deletePart, "booking_agent"); err != nil {
		t.Fatalf("UpdateFromServerEvent(delete) failed: %v", err)
	}
	if owner := adk.SurfaceOwner(sess.State(), "surf-a"); owner != "" {
		t.Fatalf("expected cleared owner after deleteSurface, got %q", owner)
	}
}

func TestToolsetDeclarationAvoidsFormatCoupling(t *testing.T) {
	ts := adk.NewSendA2UIToClientToolset(adk.ToolsetConfig{})
	decl := ts.Tool().Declaration()
	if decl == nil || decl.Name != adk.A2UIToolName {
		t.Fatalf("unexpected declaration: %#v", decl)
	}
	prop := decl.Parameters.Properties[adk.A2UIPayloadArgName]
	if prop == nil || strings.Contains(prop.Description, "JSON") {
		t.Fatalf("argument description should remain format-agnostic, got %#v", prop)
	}
}

func TestEventConverterConcurrentStreamingAndStores(t *testing.T) {
	cat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog(1.0) failed: %v", err)
	}
	procStore := adk.NewProcessorStore()
	callsStore, err := adk.NewRendererCallsStore(nil)
	if err != nil {
		t.Fatalf("NewRendererCallsStore failed: %v", err)
	}
	converter := adk.NewEventConverter(adk.EventConverterConfig{
		ProcessorProvider: procStore.ForSession,
	})

	const workers = 8
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for i := range workers {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sessID := fmt.Sprintf("sess-%d", idx)
			proc, pErr := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
			if pErr != nil {
				errs <- pErr
				return
			}
			procStore.Set(sessID, proc)
			if _, cErr := callsStore.ForSession(sessID); cErr != nil {
				errs <- cErr
				return
			}

			chunks := []string{
				"Hello!\n<a2ui>\n",
				"surface(\"main\")\nroot = Column([hdr])\n",
				"hdr = Text(\"Welcome\")\n</a2ui>",
			}
			var gotA2UI int
			for _, chunk := range chunks {
				ev := &session.Event{
					InvocationID: fmt.Sprintf("inv-%d", idx),
					Branch:       fmt.Sprintf("branch-%d", idx),
					LLMResponse: model.LLMResponse{
						Partial: true,
						Content: genai.NewContentFromText(chunk, genai.RoleModel),
					},
				}
				a2aEvts, convErr := converter.ConvertEvent(context.Background(), sessID, ev, a2a.TaskID(fmt.Sprintf("task-%d", idx)), sessID)
				if convErr != nil {
					errs <- convErr
					return
				}
				for _, aev := range a2aEvts {
					if su, ok := aev.(*a2a.TaskStatusUpdateEvent); ok && su.Status.Message != nil {
						gotA2UI += len(a2aext.A2UIMessagesFromMessage(su.Status.Message))
					}
				}
			}

			finalEv := &session.Event{
				InvocationID: fmt.Sprintf("inv-%d", idx),
				Branch:       fmt.Sprintf("branch-%d", idx),
				LLMResponse: model.LLMResponse{
					Partial: false,
					Content: genai.NewContentFromText(strings.Join(chunks, ""), genai.RoleModel),
				},
			}
			a2aEvts, convErr := converter.ConvertEvent(context.Background(), sessID, finalEv, a2a.TaskID(fmt.Sprintf("task-%d", idx)), sessID)
			if convErr != nil {
				errs <- convErr
				return
			}
			for _, aev := range a2aEvts {
				if su, ok := aev.(*a2a.TaskStatusUpdateEvent); ok && su.Status.Message != nil {
					gotA2UI += len(a2aext.A2UIMessagesFromMessage(su.Status.Message))
				}
			}
			if gotA2UI < 1 {
				errs <- fmt.Errorf("worker %d expected >=1 A2UI message, got %d", idx, gotA2UI)
				return
			}
			callsStore.Remove(sessID, "done")
			procStore.Remove(sessID)
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	if n := converter.ActiveStreamCount(); n != 0 {
		t.Fatalf("expected 0 active streams after closing all branches, got %d", n)
	}
}

type manualClock struct {
	mu      sync.Mutex
	pending []*manualTimer
}

type manualTimer struct {
	stopped bool
	fn      func()
}

func (t *manualTimer) Stop() bool {
	if t.stopped {
		return false
	}
	t.stopped = true
	return true
}

func (c *manualClock) AfterFunc(_ time.Duration, fn func()) agent.TimerHandle {
	c.mu.Lock()
	defer c.mu.Unlock()
	tm := &manualTimer{fn: fn}
	c.pending = append(c.pending, tm)
	return tm
}

func (c *manualClock) fireAll() {
	c.mu.Lock()
	items := c.pending
	c.pending = nil
	c.mu.Unlock()
	for _, tm := range items {
		if !tm.stopped {
			tm.stopped = true
			tm.fn()
		}
	}
}

func TestEventConverterIdleTimeoutViaClock(t *testing.T) {
	cat := core.MustBasicCatalog(core.Version1_0)
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		t.Fatalf("NewRequestProcessor: %v", err)
	}
	clk := &manualClock{}
	converter := adk.NewEventConverter(adk.EventConverterConfig{
		ProcessorProvider: func(context.Context, string) (*agent.RequestProcessor, error) {
			return proc, nil
		},
		StreamIdleTimeout: 5 * time.Second,
		Clock:             clk,
	})

	partial := &session.Event{
		InvocationID: "inv-idle",
		Author:       "assistant",
		LLMResponse: model.LLMResponse{
			Partial: true,
			Content: genai.NewContentFromText("<a2ui>\nsurface(\"main\")\n", genai.RoleModel),
		},
	}
	if _, err := converter.ConvertEvent(context.Background(), "s-idle", partial, "task-idle", "s-idle"); err != nil {
		t.Fatalf("ConvertEvent: %v", err)
	}
	if got := converter.ActiveStreamCount(); got != 1 {
		t.Fatalf("ActiveStreamCount = %d, want 1", got)
	}

	clk.fireAll()
	if got := converter.ActiveStreamCount(); got != 0 {
		t.Fatalf("ActiveStreamCount after Clock fire = %d, want 0", got)
	}
}

func TestRPCCallback(t *testing.T) {
	baseCat := core.MustBasicCatalog(core.Version1_0)
	catWithFn, err := baseCat.CopyWith(core.CopyWithOptions{
		AgentFunctions: []*core.AgentFunction{
			{
				Name:        "greetUser",
				Description: "Greets a user by name.",
				ReturnType:  core.ReturnTypeString,
				ArgsSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name": map[string]any{"type": "string"},
					},
					"required": []any{"name"},
				},
				Handler: func(_ context.Context, args map[string]any, _ core.AgentFunctionContext) (any, error) {
					return "Hello, " + fmt.Sprint(args["name"]), nil
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CopyWith: %v", err)
	}

	callsStore, err := adk.NewRendererCallsStore(nil)
	if err != nil {
		t.Fatalf("NewRendererCallsStore: %v", err)
	}

	cb, err := adk.RPCCallback(adk.RPCCallbackConfig{
		Catalogs:              []*core.Catalog{catWithFn},
		RendererCallsProvider: callsStore.Get,
	})
	if err != nil {
		t.Fatalf("RPCCallback: %v", err)
	}

	// 1. callAgentFunction short-circuits before the LLM and returns agentFunctionResponse.
	callPart, err := adk.EncodeA2APartToGenAI(a2aext.CreateA2UIPart(core.AgentToRendererMessage{
		"version": "1.0",
		"callAgentFunction": map[string]any{
			"functionCallId": "fc-greet-1",
			"surfaceId":      "main",
			"callFunction": map[string]any{
				"@call": "greetUser",
				"args":  map[string]any{"name": "Ada"},
			},
		},
	}, core.Version1_0))
	if err != nil {
		t.Fatalf("EncodeA2APartToGenAI: %v", err)
	}

	cbCtx := newFakeToolContext("rpc-session", nil)
	cbCtx.userContent = &genai.Content{
		Role:  genai.RoleUser,
		Parts: []*genai.Part{callPart},
	}
	replyContent, err := cb(cbCtx)
	if err != nil {
		t.Fatalf("cb(callAgentFunction): %v", err)
	}
	if replyContent == nil || len(replyContent.Parts) != 1 {
		t.Fatalf("expected 1 reply part, got %#v", replyContent)
	}
	decoded := adk.DecodeGenAIPartA2UIMessages(replyContent.Parts[0])
	if len(decoded) != 1 {
		t.Fatalf("expected 1 decoded A2UI reply, got %#v", decoded)
	}
	respBody, ok := decoded[0]["agentFunctionResponse"].(map[string]any)
	if !ok || respBody["functionCallId"] != "fc-greet-1" || respBody["value"] != "Hello, Ada" {
		t.Fatalf("unexpected agentFunctionResponse: %#v", decoded[0])
	}

	// 2. rendererFunctionResponse resolves a pending outbound call and returns empty short-circuit content.
	mgr, err := callsStore.ForSession("rpc-session")
	if err != nil {
		t.Fatalf("callsStore.ForSession: %v", err)
	}
	callID := "rc-view-1"
	_, pending, err := mgr.Call(agent.CallRendererRequest{
		CatalogID:      catWithFn.CatalogID(),
		Name:           "getViewport",
		SurfaceID:      "main",
		FunctionCallID: &callID,
	})
	if err != nil {
		t.Fatalf("mgr.Call: %v", err)
	}

	rendererReplyPart, err := adk.EncodeA2APartToGenAI(a2aext.CreateA2UIPart(core.AgentToRendererMessage{
		"version": "1.0",
		"rendererFunctionResponse": map[string]any{
			"functionCallId": "rc-view-1",
			"value":          map[string]any{"width": float64(1280)},
		},
	}, core.Version1_0))
	if err != nil {
		t.Fatalf("EncodeA2APartToGenAI: %v", err)
	}
	cbCtx.userContent = &genai.Content{
		Role:  genai.RoleUser,
		Parts: []*genai.Part{rendererReplyPart},
	}
	shortCircuit, err := cb(cbCtx)
	if err != nil {
		t.Fatalf("cb(rendererFunctionResponse): %v", err)
	}
	if shortCircuit == nil || len(shortCircuit.Parts) != 0 {
		t.Fatalf("expected empty short-circuit content, got %#v", shortCircuit)
	}
	gotVal, err := pending.Wait(context.Background())
	if err != nil {
		t.Fatalf("pending.Wait: %v", err)
	}
	gotMap, _ := gotVal.(map[string]any)
	if gotMap["width"] != float64(1280) {
		t.Fatalf("resolved renderer call result = %#v, want width=1280", gotVal)
	}

	// 3. Plain user action falls through (nil content) so the LLM handles it.
	actionPart, err := adk.EncodeA2APartToGenAI(a2aext.CreateA2UIPart(core.AgentToRendererMessage{
		"version": "1.0",
		"action": map[string]any{
			"name":              "submit",
			"surfaceId":         "main",
			"sourceComponentId": "btn",
			"timestamp":         "2026-01-01T00:00:00Z",
			"context":           map[string]any{},
		},
	}, core.Version1_0))
	if err != nil {
		t.Fatalf("EncodeA2APartToGenAI: %v", err)
	}
	cbCtx.userContent = &genai.Content{
		Role:  genai.RoleUser,
		Parts: []*genai.Part{actionPart},
	}
	fallthroughContent, err := cb(cbCtx)
	if err != nil {
		t.Fatalf("cb(action): %v", err)
	}
	if fallthroughContent != nil {
		t.Fatalf("expected nil content for user action, got %#v", fallthroughContent)
	}
}

func TestDecodeGenAIPartA2UIMessagesArrayPayloads(t *testing.T) {
	taggedArrayPart := &genai.Part{
		InlineData: &genai.Blob{
			MIMEType: "text/plain",
			Data: []byte(`<a2a_datapart_json>[` +
				`{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}},` +
				`{"version":"1.0","deleteSurface":{"surfaceId":"s1"}}` +
				`]</a2a_datapart_json>`),
		},
	}

	msgs := adk.DecodeGenAIPartA2UIMessages(taggedArrayPart)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 decoded A2UI messages from array payload, got %#v", msgs)
	}
	if _, ok := msgs[0]["createSurface"]; !ok {
		t.Fatalf("expected first message to be createSurface, got %#v", msgs[0])
	}
	if _, ok := msgs[1]["deleteSurface"]; !ok {
		t.Fatalf("expected second message to be deleteSurface, got %#v", msgs[1])
	}

	conv := adk.NewPartConverter(nil, nil)
	parts, err := conv.Convert(taggedArrayPart)
	if err != nil {
		t.Fatalf("PartConverter.Convert(array): %v", err)
	}
	if len(parts) != 2 || !a2aext.IsA2UIPart(parts[0]) || !a2aext.IsA2UIPart(parts[1]) {
		t.Fatalf("expected 2 A2UI DataParts from array payload, got %#v", parts)
	}

	nonA2UIArrayPart := &genai.Part{
		InlineData: &genai.Blob{
			MIMEType: "text/plain",
			Data:     []byte(`<a2a_datapart_json>[{"foo":"bar"}]</a2a_datapart_json>`),
		},
	}
	if got := adk.DecodeGenAIPartA2UIMessages(nonA2UIArrayPart); got != nil {
		t.Fatalf("expected nil for non-A2UI JSON array, got %#v", got)
	}
}
