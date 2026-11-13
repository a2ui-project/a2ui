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

	"github.com/a2aproject/a2a-go/a2a"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/adk"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func ExampleNewSendA2UIToClientToolset() {
	var llm model.LLM // e.g., gemini.NewModel(...)

	processors := adk.NewProcessorStore()
	cat := core.MustBasicCatalog(core.Version1_0)
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		panic(err)
	}
	processors.Set("session-1", proc)

	toolset := adk.NewSendA2UIToClientToolset(adk.ToolsetConfig{
		EnabledProvider:   processors.IsEnabled,
		ProcessorProvider: processors.Get,
	})

	uiAgent, err := llmagent.New(llmagent.Config{
		Name:        "assistant",
		Description: "Renders interactive UI surfaces with A2UI.",
		Model:       llm,
		InstructionProvider: adk.InstructionProvider(adk.InstructionConfig{
			Instruction:       "Help the user in {city?}.",
			EnabledProvider:   processors.IsEnabled,
			ProcessorProvider: processors.Get,
		}),
		BeforeModelCallbacks: []llmagent.BeforeModelCallback{
			adk.ExcludeRPCFromPrompt,
		},
		Toolsets: []tool.Toolset{toolset},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(uiAgent.Name())
}

func ExampleNewEventConverter() {
	processors := adk.NewProcessorStore()
	cat := core.MustBasicCatalog(core.Version1_0)
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		panic(err)
	}
	processors.Set("session-1", proc)

	converter := adk.NewEventConverter(adk.EventConverterConfig{
		ProcessorProvider: processors.ForSession,
	})

	// When iterating runner.Run(ctx, userID, sessionID, ...), pass each yielded *session.Event:
	partial := &session.Event{
		InvocationID: "inv-1",
		Author:       "assistant",
		LLMResponse: model.LLMResponse{
			Partial: true,
			Content: genai.NewContentFromText("<a2ui>\nsurface(\"main\")\nroot = Text(\"Hi\")\n</a2ui>", genai.RoleModel),
		},
	}
	final := &session.Event{
		InvocationID: "inv-1",
		Author:       "assistant",
		LLMResponse: model.LLMResponse{
			Partial: false,
			Content: genai.NewContentFromText("<a2ui>\nsurface(\"main\")\nroot = Text(\"Hi\")\n</a2ui>", genai.RoleModel),
		},
	}

	var count int
	for _, ev := range []*session.Event{partial, final} {
		a2aEvents, err := converter.ConvertEvent(context.Background(), "session-1", ev, "task-1", "ctx-1")
		if err != nil {
			panic(err)
		}
		for _, aev := range a2aEvents {
			if su, ok := aev.(*a2a.TaskStatusUpdateEvent); ok {
				count += len(a2aext.A2UIMessagesFromMessage(su.Status.Message))
			}
		}
	}
	fmt.Println(count)
	// Output: 1
}

// ExampleNewPartConverter shows how to expand an ADK event's GenAI parts 1-to-N into
// A2A DataParts (for example inside google.golang.org/adk/v2/server/adka2a's AfterEventCallback,
// where adka2a.GenAIPartConverter is 1-to-1).
func ExampleNewPartConverter() {
	cat := core.MustBasicCatalog(core.Version1_0)
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		panic(err)
	}
	pc := adk.NewPartConverter(proc, nil)

	ev := &session.Event{
		LLMResponse: model.LLMResponse{
			Content: genai.NewContentFromText("Welcome!\n<a2ui>\nsurface(\"main\")\nroot = Text(\"Hello\")\n</a2ui>", genai.RoleModel),
		},
	}
	var artifactParts []a2a.Part
	for _, gp := range ev.Content.Parts {
		parts, err := pc.Convert(gp)
		if err != nil {
			panic(err)
		}
		artifactParts = append(artifactParts, parts...)
	}
	fmt.Println(len(artifactParts), len(a2aext.A2UIMessages(artifactParts)))
	// Output: 2 1
}
