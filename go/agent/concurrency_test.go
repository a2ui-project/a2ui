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
	"fmt"
	"sync"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func TestAgentConcurrentSafety(t *testing.T) {
	basicCat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog failed: %v", err)
	}
	catWithFn, err := basicCat.CopyWith(core.CopyWithOptions{
		AgentFunctions: []*core.AgentFunction{
			{
				Name:       "echoRate",
				ReturnType: core.ReturnTypeNumber,
				ArgsSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"amount": map[string]any{"type": "number"},
					},
					"required": []any{"amount"},
				},
				Handler: func(_ context.Context, args map[string]any, _ core.AgentFunctionContext) (any, error) {
					switch v := args["amount"].(type) {
					case int64:
						return v * 2, nil
					case float64:
						return v * 2, nil
					default:
						return nil, fmt.Errorf("amount %v is not a number", v)
					}
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CopyWith failed: %v", err)
	}

	cfg, err := agent.NewCatalogConfig(
		catWithFn,
		&agent.ComponentPruningTransformer{AllowedComponents: []string{"Card", "Column", "Text"}},
	)
	if err != nil {
		t.Fatalf("NewCatalogConfig failed: %v", err)
	}

	gen := agent.NewGenerator([]*agent.CatalogConfig{cfg}, &agent.GeneratorOptions{
		InferenceFormatFactory: agent.NewDirectJSONFormatFactory(&agent.DirectJSONFormatOptions{
			ProgressiveKeys: []string{"text"},
		}),
	})

	calls, err := agent.NewRendererFunctionCalls(nil)
	if err != nil {
		t.Fatalf("NewRendererFunctionCalls failed: %v", err)
	}
	defer calls.Dispose("")

	rpcProc, err := agent.NewRendererToAgentMessageProcessor([]*core.Catalog{catWithFn}, &agent.RendererToAgentOptions{
		OnRendererFunctionResponse: func(_ context.Context, msg *core.RendererToAgentMessage) (bool, error) {
			return calls.Resolve(msg.RendererFunctionResponse), nil
		},
	})
	if err != nil {
		t.Fatalf("NewRendererToAgentMessageProcessor failed: %v", err)
	}

	caps := core.RendererCapabilities{
		"1.0": {
			SupportedCatalogIDs: []string{catWithFn.CatalogID()},
		},
	}

	const workers = 16
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		w := w
		go func() {
			defer wg.Done()
			proc, err := gen.CreateProcessor(caps, nil)
			if err != nil {
				t.Errorf("worker %d CreateProcessor: %v", w, err)
				return
			}
			if snippet, sErr := proc.PromptSnippet(); sErr != nil || snippet == "" {
				t.Errorf("worker %d PromptSnippet: len=%d err=%v", w, len(snippet), sErr)
				return
			}

			payload := fmt.Sprintf(
				`Hello <a2ui-json>[{"version":"1.0","createSurface":{"surfaceId":"s%d","catalogId":%q}},{"version":"1.0","updateComponents":{"surfaceId":"s%d","components":[{"id":"root","component":"Text","text":"Worker %d"}]}}]</a2ui-json>`,
				w, catWithFn.CatalogID(), w, w,
			)
			stream, err := proc.OpenStream(nil)
			if err != nil {
				t.Errorf("worker %d OpenStream: %v", w, err)
				return
			}
			for i := 0; i < len(payload); i += 19 {
				end := i + 19
				if end > len(payload) {
					end = len(payload)
				}
				if _, err := stream.Feed(payload[i:end]); err != nil {
					t.Errorf("worker %d Feed: %v", w, err)
					return
				}
			}
			if _, err := stream.Close(); err != nil {
				t.Errorf("worker %d Close: %v", w, err)
				return
			}

			parts, err := proc.ParseResponse(payload, nil)
			if err != nil || len(parts) != 2 {
				t.Errorf("worker %d ParseResponse: len=%d err=%v", w, len(parts), err)
				return
			}
			if _, err := proc.Parser().Decompile(parts[1].A2UI); err != nil {
				t.Errorf("worker %d Decompile: %v", w, err)
				return
			}

			// Inbound agent function RPC
			callID := fmt.Sprintf("agent-call-%d", w)
			res, err := rpcProc.ProcessMessageMap(context.Background(), map[string]any{
				"version": "1.0",
				"callAgentFunction": map[string]any{
					"functionCallId": callID,
					"surfaceId":      "main",
					"callFunction": map[string]any{
						"@call":     "echoRate",
						"catalogId": catWithFn.CatalogID(),
						"args":      map[string]any{"amount": float64(w + 1)},
					},
				},
			})
			if err != nil || !res.Handled || len(res.Replies) != 1 {
				t.Errorf("worker %d callAgentFunction: res=%+v err=%v", w, res, err)
				return
			}

			// Outbound renderer function RPC + settlement
			_, pending, err := calls.Call(agent.CallRendererRequest{
				CatalogID: catWithFn.CatalogID(),
				Name:      "getLocale",
			})
			if err != nil {
				t.Errorf("worker %d calls.Call: %v", w, err)
				return
			}
			_, err = rpcProc.ProcessMessageMap(context.Background(), map[string]any{
				"version": "1.0",
				"rendererFunctionResponse": map[string]any{
					"functionCallId": pending.FunctionCallID,
					"value":          "en-US",
				},
			})
			if err != nil {
				t.Errorf("worker %d rendererFunctionResponse: %v", w, err)
				return
			}
			gotVal, err := pending.Wait(context.Background())
			if err != nil || gotVal != "en-US" {
				t.Errorf("worker %d pending.Wait: got=%v err=%v", w, gotVal, err)
			}
		}()
	}
	wg.Wait()
}

// A RequestProcessor holds no per-response state, so goroutines may share one.
func TestSharedRequestProcessorConcurrentUse(t *testing.T) {
	basicCat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog failed: %v", err)
	}
	responses := map[string]string{
		"express": "Hi <a2ui>\nsurface(\"s1\")\nroot = Text(\"Hello\")\n</a2ui>",
		"direct_json": fmt.Sprintf(
			`Hi <a2ui-json>[{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":%q,"components":[{"id":"root","component":"Text","text":"Hello"}]}}]</a2ui-json>`,
			basicCat.CatalogID(),
		),
	}
	factories := map[string]agent.InferenceFormatFactory{
		"express":     nil, // NewRequestProcessor defaults to Express.
		"direct_json": agent.NewDirectJSONFormatFactory(nil),
	}
	for name, factory := range factories {
		t.Run(name, func(t *testing.T) {
			proc, err := agent.NewRequestProcessor([]*core.Catalog{basicCat}, &agent.RequestProcessorOptions{
				FormatFactory: factory,
			})
			if err != nil {
				t.Fatalf("NewRequestProcessor failed: %v", err)
			}
			response := responses[name]

			const workers = 8
			var wg sync.WaitGroup
			wg.Add(workers)
			for w := 0; w < workers; w++ {
				go func() {
					defer wg.Done()
					if snippet, sErr := proc.PromptSnippet(); sErr != nil || snippet == "" {
						t.Errorf("PromptSnippet: len=%d err=%v", len(snippet), sErr)
						return
					}
					parts, err := proc.ParseResponse(response, nil)
					if err != nil || len(parts) != 2 {
						t.Errorf("ParseResponse: len=%d err=%v", len(parts), err)
						return
					}
					if _, err := proc.Parser().Decompile(parts[1].A2UI); err != nil {
						t.Errorf("Decompile: %v", err)
						return
					}
					stream, err := proc.OpenStream(nil)
					if err != nil {
						t.Errorf("OpenStream: %v", err)
						return
					}
					for i := 0; i < len(response); i += 7 {
						if _, err := stream.Feed(response[i:min(i+7, len(response))]); err != nil {
							t.Errorf("Feed: %v", err)
							return
						}
					}
					if _, err := stream.Close(); err != nil {
						t.Errorf("Close: %v", err)
					}
				}()
			}
			wg.Wait()
		})
	}
}
