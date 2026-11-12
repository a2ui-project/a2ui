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

//lint:file-ignore SA1019 This file tests the recipe for server/adka2a, the A2A 0.3 executor of ADK for Go v2. A2UI's A2A extension uses A2A 0.3 parts.

package adk_test

import (
	"context"
	"strings"
	"testing"

	"github.com/a2aproject/a2a-go/a2a"
	"github.com/a2aproject/a2a-go/a2asrv"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/server/adka2a"
	"google.golang.org/adk/v2/session"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/adk"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// TestADKA2AExecutorRecipeExpandsA2UIParts runs the recipe that this package's
// documentation gives for ADK-Go's own A2A executor: store the request's
// processor in BeforeExecuteCallback, and expand each event's A2UI parts in
// AfterEventCallback, since GenAIPartConverter converts one part to one part.
func TestADKA2AExecutorRecipeExpandsA2UIParts(t *testing.T) {
	catalogID, proc := directJSONProcessor(t, core.Version1_0, false)
	messages := sampleMessages(core.Version1_0, catalogID, "s1", "From the ADK executor")
	reply := "Here is your card." + agent.JSONOpenTag + mustJSON(t, messages) + agent.JSONCloseTag
	llm := newScriptedLLM([]*model.LLMResponse{textResponse(reply, false)})
	processors := adk.NewProcessorStore()

	executor := adka2a.NewExecutor(adka2a.ExecutorConfig{
		RunnerConfig: runner.Config{
			AppName:        pipelineApp,
			Agent:          newStreamAgent(t, llm),
			SessionService: session.InMemoryService(),
		},
		BeforeExecuteCallback: func(ctx context.Context, reqCtx *a2asrv.RequestContext) (context.Context, error) {
			// ADK's executor uses the A2A context ID as the session ID.
			processors.Set(reqCtx.ContextID, proc)
			return ctx, nil
		},
		AfterEventCallback: func(ctx adka2a.ExecutorContext, event *session.Event, processed *a2a.TaskArtifactUpdateEvent) error {
			sessionProc, err := processors.ForSession(ctx, ctx.SessionID())
			if err != nil || sessionProc == nil || event.Content == nil {
				return err
			}
			converter := adk.NewPartConverter(sessionProc, nil)
			var parts []a2a.Part
			for _, part := range event.Content.Parts {
				converted, err := converter.Convert(part)
				if err != nil {
					return err
				}
				parts = append(parts, converted...)
			}
			processed.Artifact.Parts = parts
			return nil
		},
	})

	queue := &recordingQueue{}
	if err := executor.Execute(t.Context(), newRequestContext("show a card", "m1", "context-1"), queue); err != nil {
		t.Fatalf("Execute: %v", err)
	}

	var got []map[string]any
	var texts []string
	for _, event := range queue.events {
		update, ok := event.(*a2a.TaskArtifactUpdateEvent)
		if !ok {
			continue
		}
		for _, part := range update.Artifact.Parts {
			if dataPart, ok := a2aext.A2UIDataPart(part); ok {
				if mime := dataPart.Metadata[a2aext.MIMETypeKey]; mime != a2aext.A2UIMIMEType {
					t.Errorf("DataPart MIME type = %v, want %q", mime, a2aext.A2UIMIMEType)
				}
				got = append(got, dataPart.Data)
			} else if text, ok := part.(a2a.TextPart); ok {
				texts = append(texts, text.Text)
			}
		}
	}
	assertSameJSON(t, got, messages)
	if joined := strings.Join(texts, ""); !strings.Contains(joined, "Here is your card.") {
		t.Errorf("the artifact texts are %q, want the text before the block", texts)
	}
	assertFinalState(t, queue.statusUpdates(), a2a.TaskStateCompleted)
}
