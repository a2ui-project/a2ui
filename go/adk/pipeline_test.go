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

// The tests in this file run this package inside a real ADK runner, with a
// scripted model in place of an LLM. They mirror the Python SDK's
// python/a2ui_adk/tests/integration/test_runner_pipeline.py. The runner tests
// run SendA2UIToClientToolset and InstructionProvider in an ADK agent. The
// executor tests run EventConverter in the custom a2asrv.AgentExecutor that
// this package's documentation describes, the counterpart of the Python SDK's
// A2uiEventConverter inside ADK's A2aAgentExecutor: both turn each ADK event
// into TaskStatusUpdateEvent messages.

import (
	"context"
	"encoding/json"
	"errors"
	"iter"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/a2aproject/a2a-go/a2a"
	"github.com/a2aproject/a2a-go/a2asrv"
	"github.com/a2aproject/a2a-go/a2asrv/eventqueue"
	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/adk"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	pipelineApp  = "integration_app"
	pipelineUser = "integration_user"
)

var pipelineVersions = []core.ProtocolVersion{core.Version0_9, core.Version1_0}

// recordedRequest is what scriptedLLM saw in one model call.
type recordedRequest struct {
	systemInstruction string
	contents          []*genai.Content
}

// scriptedLLM is a model.LLM that answers each call with the next scripted list
// of responses and records every request it gets.
type scriptedLLM struct {
	mu        sync.Mutex
	responses [][]*model.LLMResponse
	requests  []recordedRequest
}

func newScriptedLLM(responses ...[]*model.LLMResponse) *scriptedLLM {
	return &scriptedLLM{responses: responses}
}

func (m *scriptedLLM) Name() string { return "scripted" }

func (m *scriptedLLM) GenerateContent(_ context.Context, req *model.LLMRequest, _ bool) iter.Seq2[*model.LLMResponse, error] {
	m.mu.Lock()
	m.requests = append(m.requests, recordedRequest{
		systemInstruction: systemInstructionText(req),
		contents:          slices.Clone(req.Contents),
	})
	var turn []*model.LLMResponse
	if len(m.responses) > 0 {
		turn, m.responses = m.responses[0], m.responses[1:]
	}
	m.mu.Unlock()

	return func(yield func(*model.LLMResponse, error) bool) {
		if turn == nil {
			yield(nil, errors.New("scriptedLLM: no response is scripted for this call"))
			return
		}
		for _, resp := range turn {
			if !yield(resp, nil) {
				return
			}
		}
	}
}

func (m *scriptedLLM) recorded() []recordedRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.requests)
}

func systemInstructionText(req *model.LLMRequest) string {
	if req == nil || req.Config == nil || req.Config.SystemInstruction == nil {
		return ""
	}
	var b strings.Builder
	for _, part := range req.Config.SystemInstruction.Parts {
		if part != nil {
			b.WriteString(part.Text)
		}
	}
	return b.String()
}

func textResponse(text string, partial bool) *model.LLMResponse {
	return &model.LLMResponse{
		Content:      genai.NewContentFromText(text, genai.RoleModel),
		Partial:      partial,
		TurnComplete: !partial,
	}
}

func functionCallResponse(name string, args map[string]any) *model.LLMResponse {
	return &model.LLMResponse{
		Content:      genai.NewContentFromParts([]*genai.Part{genai.NewPartFromFunctionCall(name, args)}, genai.RoleModel),
		TurnComplete: true,
	}
}

// sampleMessages returns a createSurface message and an updateComponents
// message whose root is a Text component.
func sampleMessages(version core.ProtocolVersion, catalogID, surfaceID, text string) []map[string]any {
	wire := version.WireVersion()
	return []map[string]any{
		{
			"version":       wire,
			"createSurface": map[string]any{"surfaceId": surfaceID, "catalogId": catalogID},
		},
		{
			"version": wire,
			"updateComponents": map[string]any{
				"surfaceId":  surfaceID,
				"components": []any{map[string]any{"id": "root", "component": "Text", "text": text}},
			},
		},
	}
}

// directJSONProcessor returns the Basic Catalog ID of version and a stateless
// Direct JSON processor for it, optionally with sampleMessages as an example.
func directJSONProcessor(t *testing.T, version core.ProtocolVersion, withExamples bool) (string, *agent.RequestProcessor) {
	t.Helper()
	cat, err := core.BasicCatalog(version)
	if err != nil {
		t.Fatalf("BasicCatalog(%s): %v", version, err)
	}
	opts := &agent.RequestProcessorOptions{FormatFactory: agent.NewDirectJSONFormatFactory(nil)}
	if withExamples {
		var turn []core.AgentToRendererMessage
		for _, msg := range sampleMessages(version, cat.CatalogID(), "s1", "Hello") {
			turn = append(turn, core.AgentToRendererMessage(msg))
		}
		opts.Examples = [][]core.AgentToRendererMessage{turn}
	}
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, opts)
	if err != nil {
		t.Fatalf("NewRequestProcessor: %v", err)
	}
	return cat.CatalogID(), proc
}

func fixedProcessor(proc *agent.RequestProcessor) adk.ProcessorProvider {
	return func(adkagent.ReadonlyContext) (*agent.RequestProcessor, error) {
		return proc, nil
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return string(raw)
}

// assertSameJSON reports an error unless got and want encode the same JSON value.
func assertSameJSON(t *testing.T, got, want any) {
	t.Helper()
	var gotValue, wantValue any
	if err := json.Unmarshal([]byte(mustJSON(t, got)), &gotValue); err != nil {
		t.Fatalf("json.Unmarshal(got): %v", err)
	}
	if err := json.Unmarshal([]byte(mustJSON(t, want)), &wantValue); err != nil {
		t.Fatalf("json.Unmarshal(want): %v", err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Errorf("got %s, want %s", mustJSON(t, got), mustJSON(t, want))
	}
}

func newRunner(t *testing.T, root adkagent.Agent) *runner.Runner {
	t.Helper()
	r, err := runner.New(runner.Config{
		AppName:           pipelineApp,
		Agent:             root,
		SessionService:    session.InMemoryService(),
		AutoCreateSession: true,
	})
	if err != nil {
		t.Fatalf("runner.New: %v", err)
	}
	return r
}

// newUIAgent returns an agent that offers the A2UI tool and A2UI instructions
// for proc, and the toolset it uses.
func newUIAgent(t *testing.T, llm model.LLM, instruction string, proc *agent.RequestProcessor) (adkagent.Agent, *adk.SendA2UIToClientToolset) {
	t.Helper()
	toolset := adk.NewSendA2UIToClientToolset(adk.ToolsetConfig{ProcessorProvider: fixedProcessor(proc)})
	uiAgent, err := llmagent.New(llmagent.Config{
		Name:  "ui_agent",
		Model: llm,
		InstructionProvider: adk.InstructionProvider(adk.InstructionConfig{
			Instruction:       instruction,
			ProcessorProvider: fixedProcessor(proc),
		}),
		Toolsets: []tool.Toolset{toolset},
	})
	if err != nil {
		t.Fatalf("llmagent.New: %v", err)
	}
	return uiAgent, toolset
}

func newStreamAgent(t *testing.T, llm model.LLM) adkagent.Agent {
	t.Helper()
	streamAgent, err := llmagent.New(llmagent.Config{Name: "stream_agent", Model: llm})
	if err != nil {
		t.Fatalf("llmagent.New: %v", err)
	}
	return streamAgent
}

// runAgentTurn runs one user turn through root and returns its events.
func runAgentTurn(t *testing.T, root adkagent.Agent) []*session.Event {
	t.Helper()
	var events []*session.Event
	content := genai.NewContentFromText("Render UI", genai.RoleUser)
	for ev, err := range newRunner(t, root).Run(t.Context(), pipelineUser, "session-1", content, adkagent.RunConfig{}) {
		if err != nil {
			t.Fatalf("runner.Run: %v", err)
		}
		events = append(events, ev)
	}
	return events
}

func functionResponses(contents []*genai.Content) []*genai.FunctionResponse {
	var out []*genai.FunctionResponse
	for _, content := range contents {
		if content == nil {
			continue
		}
		for _, part := range content.Parts {
			if part != nil && part.FunctionResponse != nil {
				out = append(out, part.FunctionResponse)
			}
		}
	}
	return out
}

func eventContents(events []*session.Event) []*genai.Content {
	out := make([]*genai.Content, 0, len(events))
	for _, ev := range events {
		out = append(out, ev.Content)
	}
	return out
}

func TestPipelineRunnerIncludesPromptSnippetOnce(t *testing.T) {
	for _, version := range pipelineVersions {
		t.Run(string(version), func(t *testing.T) {
			_, proc := directJSONProcessor(t, version, true)
			llm := newScriptedLLM([]*model.LLMResponse{textResponse("Ready.", false)})
			uiAgent, toolset := newUIAgent(t, llm, "You are a UI assistant.", proc)

			runAgentTurn(t, uiAgent)

			requests := llm.recorded()
			if len(requests) != 1 {
				t.Fatalf("the model got %d requests, want 1", len(requests))
			}
			system := requests[0].systemInstruction
			snippet, err := proc.PromptSnippet()
			if err != nil {
				t.Fatalf("PromptSnippet: %v", err)
			}
			if n := strings.Count(system, snippet); n != 1 {
				t.Errorf("the system instruction has the prompt snippet %d times, want 1", n)
			}
			toolInstruction := adk.ToolInstruction(toolset)
			if n := strings.Count(system, toolInstruction); n != 1 {
				t.Errorf("the system instruction has the tool instruction %d times, want 1", n)
			}
			prefix := "You are a UI assistant.\n\n" + snippet
			if !strings.HasPrefix(system, prefix) {
				t.Fatalf("the system instruction does not start with the agent instruction and prompt snippet:\n%s", system)
			}
			if !strings.HasSuffix(system, toolInstruction) {
				t.Fatalf("the system instruction does not end with the tool instruction:\n%s", system)
			}
			if between := system[len(prefix) : len(system)-len(toolInstruction)]; strings.Contains(between, "A2UI") {
				t.Errorf("the system instruction repeats A2UI instructions between the snippet and the tool instruction: %q", between)
			}
		})
	}
}

func TestPipelineRunnerValidToolCallReturnsValidatedMessages(t *testing.T) {
	for _, version := range pipelineVersions {
		t.Run(string(version), func(t *testing.T) {
			catalogID, proc := directJSONProcessor(t, version, false)
			want := sampleMessages(version, catalogID, "card_1", "Confirmed")
			llm := newScriptedLLM([]*model.LLMResponse{
				functionCallResponse(adk.A2UIToolName, map[string]any{adk.A2UIPayloadArgName: mustJSON(t, want)}),
			})
			uiAgent, _ := newUIAgent(t, llm, "Role.", proc)

			events := runAgentTurn(t, uiAgent)

			// A valid UI tool call skips summarization, so the model is not called again.
			if n := len(llm.recorded()); n != 1 {
				t.Errorf("the model got %d requests, want 1", n)
			}
			responses := functionResponses(eventContents(events))
			if len(responses) != 1 {
				t.Fatalf("the turn has %d function responses, want 1", len(responses))
			}
			if responses[0].Name != adk.A2UIToolName {
				t.Errorf("function response name = %q, want %q", responses[0].Name, adk.A2UIToolName)
			}
			assertSameJSON(t, responses[0].Response, map[string]any{adk.ValidatedA2UIJSONKey: want})
		})
	}
}

func TestPipelineRunnerInvalidToolCallFeedsErrorToSecondRequest(t *testing.T) {
	for _, version := range pipelineVersions {
		t.Run(string(version), func(t *testing.T) {
			catalogID, proc := directJSONProcessor(t, version, false)
			wire := version.WireVersion()
			invalid := []map[string]any{
				{
					"version":       wire,
					"createSurface": map[string]any{"surfaceId": "bad_surface", "catalogId": catalogID},
				},
				{
					"version": wire,
					"updateComponents": map[string]any{
						"surfaceId": "bad_surface",
						// The Text component lacks its required "text" property.
						"components": []any{map[string]any{"id": "root", "component": "Text"}},
					},
				},
			}
			valid := sampleMessages(version, catalogID, "good_surface", "Fixed")
			llm := newScriptedLLM(
				[]*model.LLMResponse{functionCallResponse(adk.A2UIToolName, map[string]any{adk.A2UIPayloadArgName: mustJSON(t, invalid)})},
				[]*model.LLMResponse{functionCallResponse(adk.A2UIToolName, map[string]any{adk.A2UIPayloadArgName: mustJSON(t, valid)})},
			)
			uiAgent, _ := newUIAgent(t, llm, "Role.", proc)

			events := runAgentTurn(t, uiAgent)

			requests := llm.recorded()
			if len(requests) != 2 {
				t.Fatalf("the model got %d requests, want 2", len(requests))
			}
			fedBack := functionResponses(requests[1].contents)
			if len(fedBack) != 1 {
				t.Fatalf("the second request has %d function responses, want 1", len(fedBack))
			}
			errText, _ := fedBack[0].Response[adk.A2UIToolErrorKey].(string)
			if !strings.Contains(errText, "Failed to call A2UI tool "+adk.A2UIToolName) {
				t.Errorf("the tool error %q does not name the tool", errText)
			}
			if !strings.Contains(errText, "'text'") {
				t.Errorf("the tool error %q does not name the missing 'text' property", errText)
			}
			responses := functionResponses(eventContents(events))
			if len(responses) != 2 {
				t.Fatalf("the turn has %d function responses, want 2", len(responses))
			}
			assertSameJSON(t, responses[1].Response, map[string]any{adk.ValidatedA2UIJSONKey: valid})
		})
	}
}

// recordingQueue is an eventqueue.Queue that keeps every event written to it.
type recordingQueue struct {
	mu     sync.Mutex
	events []a2a.Event
}

var _ eventqueue.Queue = (*recordingQueue)(nil)

func (q *recordingQueue) Write(_ context.Context, event a2a.Event) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.events = append(q.events, event)
	return nil
}

func (q *recordingQueue) WriteVersioned(ctx context.Context, event a2a.Event, _ a2a.TaskVersion) error {
	return q.Write(ctx, event)
}

func (q *recordingQueue) Read(context.Context) (a2a.Event, a2a.TaskVersion, error) {
	return nil, 0, errors.New("recordingQueue: Read is not supported")
}

func (q *recordingQueue) Close() error { return nil }

func (q *recordingQueue) statusUpdates() []*a2a.TaskStatusUpdateEvent {
	q.mu.Lock()
	defer q.mu.Unlock()
	var out []*a2a.TaskStatusUpdateEvent
	for _, event := range q.events {
		if update, ok := event.(*a2a.TaskStatusUpdateEvent); ok {
			out = append(out, update)
		}
	}
	return out
}

// negotiateFunc returns a request's RequestProcessor, or nil for a request without A2UI.
type negotiateFunc func(reqCtx *a2asrv.RequestContext) (*agent.RequestProcessor, error)

func fixedNegotiation(proc *agent.RequestProcessor) negotiateFunc {
	return func(*a2asrv.RequestContext) (*agent.RequestProcessor, error) {
		return proc, nil
	}
}

// a2uiExecutor is the custom a2asrv.AgentExecutor that this package's
// documentation describes. For each request it negotiates the request's
// RequestProcessor, stores it for the session, runs the agent, and converts
// each ADK event with EventConverter.ConvertEvent.
type a2uiExecutor struct {
	runner     *runner.Runner
	processors *adk.ProcessorStore
	converter  *adk.EventConverter
	negotiate  negotiateFunc
}

var _ a2asrv.AgentExecutor = (*a2uiExecutor)(nil)

func newA2UIExecutor(t *testing.T, root adkagent.Agent, processors *adk.ProcessorStore, converter *adk.EventConverter, negotiate negotiateFunc) *a2uiExecutor {
	t.Helper()
	return &a2uiExecutor{
		runner:     newRunner(t, root),
		processors: processors,
		converter:  converter,
		negotiate:  negotiate,
	}
}

func (e *a2uiExecutor) Execute(ctx context.Context, reqCtx *a2asrv.RequestContext, queue eventqueue.Queue) error {
	if reqCtx.StoredTask == nil {
		if err := queue.Write(ctx, a2a.NewSubmittedTask(reqCtx, reqCtx.Message)); err != nil {
			return err
		}
	}
	// The A2A context is the ADK session.
	sessionID := reqCtx.ContextID
	proc, err := e.negotiate(reqCtx)
	if err != nil {
		return err
	}
	// Set or clear the processor on every request, so a request without A2UI
	// doesn't use the processor of an earlier one.
	e.processors.Set(sessionID, proc)

	if err := queue.Write(ctx, a2a.NewStatusUpdateEvent(reqCtx, a2a.TaskStateWorking, nil)); err != nil {
		return err
	}
	content := genai.NewContentFromText(messageText(reqCtx.Message), genai.RoleUser)
	runConfig := adkagent.RunConfig{StreamingMode: adkagent.StreamingModeSSE}
	for event, runErr := range e.runner.Run(ctx, pipelineUser, sessionID, content, runConfig) {
		if runErr != nil {
			return writeFinalStatus(ctx, queue, reqCtx, a2a.TaskStateFailed, runErr.Error())
		}
		converted, err := e.converter.ConvertEvent(ctx, sessionID, event, reqCtx.TaskID, reqCtx.ContextID)
		if err != nil {
			return err
		}
		for _, out := range converted {
			if err := queue.Write(ctx, out); err != nil {
				return err
			}
			if update, ok := out.(*a2a.TaskStatusUpdateEvent); ok && update.Final {
				return nil
			}
		}
	}
	return writeFinalStatus(ctx, queue, reqCtx, a2a.TaskStateCompleted, "")
}

func (e *a2uiExecutor) Cancel(ctx context.Context, reqCtx *a2asrv.RequestContext, queue eventqueue.Queue) error {
	return writeFinalStatus(ctx, queue, reqCtx, a2a.TaskStateCanceled, "")
}

func writeFinalStatus(ctx context.Context, queue eventqueue.Queue, reqCtx *a2asrv.RequestContext, state a2a.TaskState, text string) error {
	var msg *a2a.Message
	if text != "" {
		msg = a2a.NewMessageForTask(a2a.MessageRoleAgent, reqCtx, a2a.TextPart{Text: text})
	}
	update := a2a.NewStatusUpdateEvent(reqCtx, state, msg)
	update.Final = true
	return queue.Write(ctx, update)
}

func messageText(msg *a2a.Message) string {
	if msg == nil {
		return ""
	}
	var b strings.Builder
	for _, part := range msg.Parts {
		if text, ok := part.(a2a.TextPart); ok {
			b.WriteString(text.Text)
		}
	}
	return b.String()
}

func newRequestContext(text, messageID, contextID string) *a2asrv.RequestContext {
	msg := a2a.NewMessage(a2a.MessageRoleUser, a2a.TextPart{Text: text})
	msg.ID = messageID
	return &a2asrv.RequestContext{Message: msg, TaskID: a2a.NewTaskID(), ContextID: contextID}
}

// execute runs one request through exec and returns its status updates.
func execute(t *testing.T, exec *a2uiExecutor, reqCtx *a2asrv.RequestContext) []*a2a.TaskStatusUpdateEvent {
	t.Helper()
	queue := &recordingQueue{}
	if err := exec.Execute(t.Context(), reqCtx, queue); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	updates := queue.statusUpdates()
	if len(updates) == 0 {
		t.Fatal("Execute wrote no status updates")
	}
	return updates
}

func a2uiDataParts(updates []*a2a.TaskStatusUpdateEvent) []*a2a.DataPart {
	var out []*a2a.DataPart
	for _, update := range updates {
		if update.Status.Message == nil {
			continue
		}
		for _, part := range update.Status.Message.Parts {
			if dataPart, ok := a2aext.A2UIDataPart(part); ok {
				out = append(out, dataPart)
			}
		}
	}
	return out
}

func statusTexts(updates []*a2a.TaskStatusUpdateEvent) []string {
	var out []string
	for _, update := range updates {
		if update.Status.Message == nil {
			continue
		}
		for _, part := range update.Status.Message.Parts {
			if text, ok := part.(a2a.TextPart); ok {
				out = append(out, text.Text)
			}
		}
	}
	return out
}

func assertFinalState(t *testing.T, updates []*a2a.TaskStatusUpdateEvent, want a2a.TaskState) {
	t.Helper()
	last := updates[len(updates)-1]
	if !last.Final || last.Status.State != want {
		t.Errorf("the last status update is %s (final=%t), want final %s", last.Status.State, last.Final, want)
	}
}

func TestPipelineExecutorStreamsPartialChunksInEmissionOrder(t *testing.T) {
	cases := []struct {
		version  core.ProtocolVersion
		wantMIME string
	}{
		{core.Version0_9, a2aext.DeprecatedA2UIMIMEType},
		{core.Version0_9_1, a2aext.A2UIMIMEType},
		{core.Version1_0, a2aext.A2UIMIMEType},
	}
	for _, tc := range cases {
		t.Run(string(tc.version), func(t *testing.T) {
			catalogID, proc := directJSONProcessor(t, tc.version, false)
			messages := sampleMessages(tc.version, catalogID, "stream_s1", "Streamed")
			chunk1 := agent.JSONOpenTag + "[" + mustJSON(t, messages[0])
			chunk2 := ", " + mustJSON(t, messages[1]) + "]" + agent.JSONCloseTag
			streamedTurn := []*model.LLMResponse{
				textResponse(chunk1, true),
				textResponse(chunk2, true),
				textResponse(chunk1+chunk2, false),
			}
			llm := newScriptedLLM(streamedTurn, streamedTurn)
			processors := adk.NewProcessorStore()
			converter := adk.NewEventConverter(adk.EventConverterConfig{ProcessorProvider: processors.ForSession})
			exec := newA2UIExecutor(t, newStreamAgent(t, llm), processors, converter, fixedNegotiation(proc))

			updates := execute(t, exec, newRequestContext("first turn", "m1", "context-1"))

			if n := converter.ActiveStreamCount(); n != 0 {
				t.Errorf("%d streams are open after the first turn, want 0", n)
			}
			var got []map[string]any
			var carriers []int
			for i := range updates {
				for _, dataPart := range a2uiDataParts(updates[i : i+1]) {
					if mime := dataPart.Metadata[a2aext.MIMETypeKey]; mime != tc.wantMIME {
						t.Errorf("DataPart MIME type = %v, want %q", mime, tc.wantMIME)
					}
					got = append(got, dataPart.Data)
					carriers = append(carriers, i)
				}
			}
			assertSameJSON(t, got, messages)
			// Each message is sent as soon as its chunk completes it, so the two
			// messages arrive in separate status updates rather than together at
			// the end of the response.
			if len(carriers) == 2 && carriers[0] >= carriers[1] {
				t.Errorf("the messages arrived in status updates %v, want the first message in an earlier update", carriers)
			}
			assertFinalState(t, updates, a2a.TaskStateCompleted)

			// A second turn opens and closes a stream of its own.
			updates = execute(t, exec, newRequestContext("second turn", "m2", "context-1"))
			if n := converter.ActiveStreamCount(); n != 0 {
				t.Errorf("%d streams are open after the second turn, want 0", n)
			}
			if n := len(a2uiDataParts(updates)); n != len(messages) {
				t.Errorf("the second turn sent %d A2UI parts, want %d", n, len(messages))
			}
			assertFinalState(t, updates, a2a.TaskStateCompleted)
		})
	}
}

func TestPipelineExecutorRejectedBlockSendsFallbackAndCompletes(t *testing.T) {
	for _, version := range pipelineVersions {
		t.Run(string(version), func(t *testing.T) {
			catalogID, proc := directJSONProcessor(t, version, false)
			wire := version.WireVersion()
			rejected := []map[string]any{
				{
					"version":       wire,
					"createSurface": map[string]any{"surfaceId": "s1", "catalogId": catalogID},
				},
				{
					"version": wire,
					"updateComponents": map[string]any{
						"surfaceId": "s1",
						// The root references a child component that doesn't exist.
						"components": []any{map[string]any{"id": "root", "component": "Column", "children": []any{"dangling_child"}}},
					},
				},
			}
			block := agent.JSONOpenTag + mustJSON(t, rejected) + agent.JSONCloseTag
			llm := newScriptedLLM([]*model.LLMResponse{textResponse(block, true), textResponse(block, false)})
			processors := adk.NewProcessorStore()
			converter := adk.NewEventConverter(adk.EventConverterConfig{
				ProcessorProvider: processors.ForSession,
				FallbackText:      "Fallback UI text",
			})
			exec := newA2UIExecutor(t, newStreamAgent(t, llm), processors, converter, fixedNegotiation(proc))

			updates := execute(t, exec, newRequestContext("rejected block turn", "m1", "context-1"))

			if parts := a2uiDataParts(updates); len(parts) != 0 {
				t.Errorf("the turn sent %d A2UI parts, want 0", len(parts))
			}
			if texts := statusTexts(updates); !slices.Contains(texts, "Fallback UI text") {
				t.Errorf("the turn sent texts %q, want the fallback text", texts)
			}
			if n := converter.ActiveStreamCount(); n != 0 {
				t.Errorf("%d streams are open after the turn, want 0", n)
			}
			assertFinalState(t, updates, a2a.TaskStateCompleted)
		})
	}
}

func TestPipelineExecutorMidStreamModelErrorClosesStream(t *testing.T) {
	for _, version := range pipelineVersions {
		t.Run(string(version), func(t *testing.T) {
			_, proc := directJSONProcessor(t, version, false)
			llm := newScriptedLLM([]*model.LLMResponse{
				textResponse(agent.JSONOpenTag+"[", true),
				{ErrorCode: "MODEL_STREAM_ERROR", ErrorMessage: "Stream interrupted"},
			})
			processors := adk.NewProcessorStore()
			converter := adk.NewEventConverter(adk.EventConverterConfig{ProcessorProvider: processors.ForSession})
			exec := newA2UIExecutor(t, newStreamAgent(t, llm), processors, converter, fixedNegotiation(proc))

			updates := execute(t, exec, newRequestContext("fail turn", "m1", "context-1"))

			if parts := a2uiDataParts(updates); len(parts) != 0 {
				t.Errorf("the turn sent %d A2UI parts, want 0", len(parts))
			}
			if n := converter.ActiveStreamCount(); n != 0 {
				t.Errorf("%d streams are open after the turn, want 0", n)
			}
			assertFinalState(t, updates, a2a.TaskStateFailed)
		})
	}
}

func TestPipelineExecutorNegotiatesProcessorPerRequest(t *testing.T) {
	basic := core.MustBasicCatalog(core.Version1_0)
	catalogConfig, err := agent.NewCatalogConfig(basic)
	if err != nil {
		t.Fatalf("NewCatalogConfig: %v", err)
	}
	generator := agent.NewGenerator([]*agent.CatalogConfig{catalogConfig}, &agent.GeneratorOptions{
		InferenceFormatFactory: agent.NewDirectJSONFormatFactory(nil),
	})
	card := &a2a.AgentCard{
		Capabilities: a2a.AgentCapabilities{
			Extensions: []a2a.AgentExtension{a2aext.AgentExtension(core.Version1_0, nil)},
		},
	}
	// negotiate activates the A2UI extension that the request asks for and
	// creates a processor for the catalogs that the renderer supports.
	negotiate := func(reqCtx *a2asrv.RequestContext) (*agent.RequestProcessor, error) {
		version, ok := a2aext.ActivateExtension(nil, reqCtx.Message, card)
		if !ok {
			return nil, nil
		}
		capabilities, err := a2aext.RendererCapabilitiesFromMessage(reqCtx.Message, version)
		if err != nil {
			return nil, err
		}
		return generator.CreateProcessor(capabilities, nil)
	}

	messages := sampleMessages(core.Version1_0, basic.CatalogID(), "s1", "Negotiated")
	block := agent.JSONOpenTag + mustJSON(t, messages) + agent.JSONCloseTag
	llm := newScriptedLLM(
		[]*model.LLMResponse{textResponse(block, false)},
		[]*model.LLMResponse{textResponse(block, false)},
	)
	processors := adk.NewProcessorStore()
	converter := adk.NewEventConverter(adk.EventConverterConfig{ProcessorProvider: processors.ForSession})
	exec := newA2UIExecutor(t, newStreamAgent(t, llm), processors, converter, negotiate)

	withUI := newRequestContext("show a card", "m1", "context-1")
	withUI.Message.Extensions = []string{a2aext.ExtensionURI(core.Version1_0)}
	withUI.Message.Metadata = map[string]any{
		agent.RendererCapabilitiesKey: map[string]any{
			"1.0": map[string]any{"supportedCatalogIds": []any{basic.CatalogID()}},
		},
	}
	updates := execute(t, exec, withUI)

	var got []map[string]any
	for _, dataPart := range a2uiDataParts(updates) {
		got = append(got, dataPart.Data)
	}
	assertSameJSON(t, got, messages)
	if n := processors.Len(); n != 1 {
		t.Errorf("the store holds %d processors after a request with A2UI, want 1", n)
	}
	assertFinalState(t, updates, a2a.TaskStateCompleted)

	// A later request in the same session that doesn't activate the extension
	// clears the processor, so the reply is converted as plain text.
	updates = execute(t, exec, newRequestContext("no UI please", "m2", "context-1"))

	if parts := a2uiDataParts(updates); len(parts) != 0 {
		t.Errorf("a request without A2UI sent %d A2UI parts, want 0", len(parts))
	}
	if texts := statusTexts(updates); !slices.Contains(texts, block) {
		t.Errorf("a request without A2UI sent texts %q, want the model's text unchanged", texts)
	}
	if n := processors.Len(); n != 0 {
		t.Errorf("the store holds %d processors after a request without A2UI, want 0", n)
	}
	assertFinalState(t, updates, a2a.TaskStateCompleted)
}
