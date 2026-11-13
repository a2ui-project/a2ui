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

package agent_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// newExampleProcessor negotiates a request processor for a renderer that supports the
// basic catalog, using the default Express format.
func newExampleProcessor() (*agent.RequestProcessor, *core.Catalog) {
	basicCat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		log.Fatal(err)
	}
	cfg, err := agent.NewCatalogConfig(
		basicCat,
		&agent.ComponentPruningTransformer{AllowedComponents: []string{"Card", "Column", "Text"}},
	)
	if err != nil {
		log.Fatal(err)
	}
	gen := agent.NewGenerator([]*agent.CatalogConfig{cfg}, nil)
	capabilities := core.RendererCapabilities{
		"1.0": {SupportedCatalogIDs: []string{basicCat.CatalogID()}},
	}
	proc, err := gen.CreateProcessor(capabilities, nil)
	if err != nil {
		log.Fatal(err)
	}
	return proc, basicCat
}

func describeMessages(messages []core.AgentToRendererMessage) string {
	var kinds []string
	for _, msg := range messages {
		for key := range msg {
			if key != "version" {
				kinds = append(kinds, key)
			}
		}
	}
	return strings.Join(kinds, ", ")
}

// This example negotiates catalogs with a renderer, adds the prompt snippet to the
// model's instructions, and parses a complete model response.
func ExampleGenerator() {
	proc, _ := newExampleProcessor()

	instructions, err := proc.PromptSnippet()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("prompt teaches <a2ui> tags:", strings.Contains(instructions, "<a2ui>"))

	response := "Here is your card:\n<a2ui>\n" +
		"surface(\"summary\")\n" +
		"root = Card(title)\n" +
		"title = Text(\"Hello from Go\")\n" +
		"</a2ui>"
	parts, err := proc.ParseResponse(response, nil)
	if err != nil {
		log.Fatal(err)
	}
	for _, part := range parts {
		if part.IsText() {
			fmt.Printf("text: %q\n", part.Text)
			continue
		}
		fmt.Println("a2ui:", describeMessages(part.A2UI))
	}
	// Output:
	// prompt teaches <a2ui> tags: true
	// text: "Here is your card:"
	// a2ui: createSurface
}

// This example feeds a model response to a stream chunk by chunk, as it arrives.
func ExampleRequestProcessor_Stream() {
	proc, _ := newExampleProcessor()

	chunks := func(yield func(string, error) bool) {
		for _, chunk := range []string{
			"Loading<a2ui>\nsurface(\"s1\")\n",
			"root = Column([greeting])\n",
			"greeting = Text(\"Hi\")\n</a2ui>",
		} {
			if !yield(chunk, nil) {
				return
			}
		}
	}
	for part, err := range proc.Stream(context.Background(), chunks, nil) {
		if err != nil {
			log.Fatal(err)
		}
		if part.IsText() {
			fmt.Printf("text: %q\n", part.Text)
		} else if part.IsA2UI() {
			fmt.Println("a2ui:", describeMessages(part.A2UI))
		}
	}
	// Output:
	// text: "Loading"
	// a2ui: createSurface
	// a2ui: updateComponents
}

// This example registers an agent function on a catalog and answers a renderer's
// callAgentFunction message.
func ExampleRendererToAgentMessageProcessor() {
	basicCat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		log.Fatal(err)
	}
	catalog, err := basicCat.CopyWith(core.CopyWithOptions{
		AgentFunctions: []*core.AgentFunction{{
			Name:       "lookupPrice",
			ReturnType: core.ReturnTypeNumber,
			ArgsSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"sku": map[string]any{"type": "string"}},
				"required":   []any{"sku"},
			},
			Handler: func(_ context.Context, args map[string]any, _ core.AgentFunctionContext) (any, error) {
				return 9.5, nil
			},
		}},
	})
	if err != nil {
		log.Fatal(err)
	}
	proc, err := agent.NewRendererToAgentMessageProcessor([]*core.Catalog{catalog}, nil)
	if err != nil {
		log.Fatal(err)
	}
	result, err := proc.ProcessMessageMap(context.Background(), map[string]any{
		"version": "1.0",
		"callAgentFunction": map[string]any{
			"functionCallId": "call-1",
			"surfaceId":      "main",
			"callFunction": map[string]any{
				"@call":     "lookupPrice",
				"catalogId": catalog.CatalogID(),
				"args":      map[string]any{"sku": "A-100"},
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	for _, reply := range result.Replies {
		out, err := json.Marshal(reply)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(out))
	}
	// Output:
	// {"agentFunctionResponse":{"functionCallId":"call-1","value":9.5},"version":"1.0"}
}

// This example sends a callRendererFunction message and settles the call with the
// renderer's rendererFunctionResponse.
func ExampleRendererFunctionCalls() {
	calls, err := agent.NewRendererFunctionCalls(nil)
	if err != nil {
		log.Fatal(err)
	}
	defer calls.Dispose("")

	message, pending, err := calls.Call(agent.CallRendererRequest{
		CatalogID: "https://example.com/catalogs/device.json",
		Name:      "getLocale",
		SurfaceID: "main",
	})
	if err != nil {
		log.Fatal(err)
	}
	body := message["callRendererFunction"].(map[string]any)
	fmt.Println("sent:", slices.Sorted(func(yield func(string) bool) {
		for key := range body {
			if !yield(key) {
				return
			}
		}
	}))

	// The renderer answers with a rendererFunctionResponse that copies the functionCallId.
	calls.ResolveMessage(map[string]any{
		"version": "1.0",
		"rendererFunctionResponse": map[string]any{
			"functionCallId": pending.FunctionCallID,
			"value":          "fr-FR",
		},
	})
	value, err := pending.Wait(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("locale:", value)
	// Output:
	// sent: [callFunction functionCallId surfaceId]
	// locale: fr-FR
}
