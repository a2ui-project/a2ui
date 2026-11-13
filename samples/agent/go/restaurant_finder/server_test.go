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
	"bytes"
	"context"
	"encoding/json"
	"io"
	"iter"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/session"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
)

type rpcEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id"`
	Result  map[string]any `json:"result"`
	Error   map[string]any `json:"error"`
}

func startStubTestServer(t *testing.T, format a2uiFormat) *httptest.Server {
	t.Helper()
	app, err := createServerApp(context.Background(), createServerOptions{
		Env: map[string]string{
			"STUB_LLM":    "true",
			"A2UI_FORMAT": string(format),
		},
	})
	if err != nil {
		t.Fatalf("CreateServerApp(%s) failed: %v", format, err)
	}
	return httptest.NewServer(app.Handler)
}

func postJSONRPC(t *testing.T, endpoint, method string, message map[string]any) *http.Response {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      "req-1",
		"method":  method,
		"params":  map[string]any{"message": message},
	})
	if err != nil {
		t.Fatalf("marshal rpc: %v", err)
	}
	resp, err := http.Post(endpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s failed: %v", endpoint, err)
	}
	return resp
}

func sendJSONRPCMessage(t *testing.T, endpoint string, message map[string]any) map[string]any {
	t.Helper()
	resp := postJSONRPC(t, endpoint, "message/send", message)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	var env rpcEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("unmarshal rpc response (%s): %v", string(raw), err)
	}
	if env.Error != nil {
		t.Fatalf("unexpected rpc error: %#v", env.Error)
	}
	return env.Result
}

func streamJSONRPCMessage(t *testing.T, endpoint string, message map[string]any) []map[string]any {
	t.Helper()
	resp := postJSONRPC(t, endpoint, "message/stream", message)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read sse response: %v", err)
	}
	var events []map[string]any
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var env rpcEnvelope
		if err := json.Unmarshal([]byte(payload), &env); err != nil {
			t.Fatalf("unmarshal sse line %q: %v", payload, err)
		}
		if env.Error != nil {
			t.Fatalf("unexpected sse rpc error: %#v", env.Error)
		}
		events = append(events, env.Result)
	}
	return events
}

func extractA2UIFromParts(t *testing.T, rawParts any) []map[string]any {
	t.Helper()
	list, _ := rawParts.([]any)
	var out []map[string]any
	for _, item := range list {
		pm, ok := item.(map[string]any)
		if !ok || pm["kind"] != "data" {
			continue
		}
		meta, _ := pm["metadata"].(map[string]any)
		if mime, _ := meta["mimeType"].(string); mime != a2aext.A2UIMIMEType {
			t.Fatalf("expected mimeType %q, got %#v", a2aext.A2UIMIMEType, meta)
		}
		if data, ok := pm["data"].(map[string]any); ok {
			out = append(out, data)
		}
	}
	return out
}

func createdSurfaceIDs(msgs []map[string]any) []string {
	var ids []string
	for _, m := range msgs {
		if cs, ok := m["createSurface"].(map[string]any); ok {
			if sid, ok := cs["surfaceId"].(string); ok {
				ids = append(ids, sid)
			}
		}
	}
	return ids
}

func TestConfigValidation(t *testing.T) {
	cfg, err := resolveSampleConfig(map[string]string{"STUB_LLM": "true"}, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Format != formatExpress || cfg.Mode != modeStub || cfg.Port != defaultPort {
		t.Fatalf("unexpected default config: %+v", cfg)
	}

	vertexCfg, err := resolveSampleConfig(map[string]string{
		"GOOGLE_GENAI_USE_VERTEXAI": "true",
		"GOOGLE_CLOUD_PROJECT":      "example-project",
	}, 0)
	if err != nil {
		t.Fatalf("unexpected vertex config error: %v", err)
	}
	if !vertexCfg.UseVertexAI || vertexCfg.VertexLoc != "global" || vertexCfg.ModelName != defaultModelName {
		t.Fatalf("unexpected vertex config: %+v", vertexCfg)
	}

	if _, err := resolveSampleConfig(map[string]string{"STUB_LLM": "true", "A2UI_FORMAT": "yaml"}, 0); err == nil {
		t.Fatalf("expected error on invalid A2UI_FORMAT")
	}
	if _, err := resolveSampleConfig(map[string]string{"STUB_LLM": "maybe"}, 0); err == nil {
		t.Fatalf("expected error on invalid STUB_LLM")
	}
	if _, err := resolveSampleConfig(map[string]string{}, 0); err == nil {
		t.Fatalf("expected error when neither STUB_LLM nor credentials are set")
	}
}

func TestAgentCardStaticImagesAndCORS(t *testing.T) {
	srv := startStubTestServer(t, formatExpress)
	defer srv.Close()

	cardResp, err := http.Get(srv.URL + "/.well-known/agent-card.json")
	if err != nil {
		t.Fatalf("GET agent-card failed: %v", err)
	}
	defer cardResp.Body.Close()
	if cardResp.StatusCode != http.StatusOK {
		t.Fatalf("agent-card status = %d", cardResp.StatusCode)
	}
	var card map[string]any
	if err := json.NewDecoder(cardResp.Body).Decode(&card); err != nil {
		t.Fatalf("decode agent-card: %v", err)
	}
	if card["name"] != "Restaurant Agent (stub)" {
		t.Fatalf("unexpected card name: %v", card["name"])
	}

	imgResp, err := http.Get(srv.URL + "/static/shrimpchowmein.jpeg")
	if err != nil {
		t.Fatalf("GET static image failed: %v", err)
	}
	defer imgResp.Body.Close()
	if imgResp.StatusCode != http.StatusOK {
		t.Fatalf("static image status = %d", imgResp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/a2a/json-rpc", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Headers", "content-type,x-a2a-extensions")
	corsResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS failed: %v", err)
	}
	defer corsResp.Body.Close()
	if corsResp.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want 204", corsResp.StatusCode)
	}
	if got := corsResp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}

	extReq, _ := http.NewRequest(http.MethodOptions, srv.URL+"/a2a/json-rpc", nil)
	extReq.Header.Set("Origin", "https://evil.example.com")
	extResp, err := http.DefaultClient.Do(extReq)
	if err != nil {
		t.Fatalf("external OPTIONS failed: %v", err)
	}
	defer extResp.Body.Close()
	if got := extResp.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected empty CORS allow header for non-localhost origin, got %q", got)
	}
}

func TestStubServerStreamingAndMultiTurnAcrossFormats(t *testing.T) {
	for _, format := range []a2uiFormat{formatExpress, formatDirectJSON} {
		t.Run(string(format), func(t *testing.T) {
			srv := startStubTestServer(t, format)
			defer srv.Close()

			// 1. message/send on "/" without capabilities defaults to v0.9.
			task := sendJSONRPCMessage(t, srv.URL+"/", map[string]any{
				"kind":      "message",
				"messageId": "m-send-v09",
				"role":      "user",
				"parts": []any{
					map[string]any{"kind": "text", "text": "Top 5 Chinese restaurants in New York"},
					map[string]any{"kind": "data", "data": map[string]any{"useStreaming": false}},
				},
			})
			status, _ := task["status"].(map[string]any)
			if status["state"] != "input-required" {
				t.Fatalf("expected input-required, got %#v", status)
			}
			msgMap, _ := status["message"].(map[string]any)
			v09Msgs := extractA2UIFromParts(t, msgMap["parts"])
			if len(v09Msgs) == 0 {
				t.Fatalf("expected v0.9 A2UI messages")
			}
			for _, m := range v09Msgs {
				if m["version"] != "v0.9" {
					t.Fatalf("expected v0.9 wire version, got %#v", m)
				}
			}
			sids := createdSurfaceIDs(v09Msgs)
			if !slices.Contains(sids, "stub-notice") || !slices.Contains(sids, "default") {
				t.Fatalf("expected stub-notice and default surfaces, got %v", sids)
			}

			// 2. message/stream on "/a2a/json-rpc" with v1.0 capabilities + 3-step booking flow.
			v10Meta := map[string]any{
				"a2uiRendererCapabilities": map[string]any{
					"1.0": map[string]any{
						"supportedCatalogIds": []string{v10Profile.BasicCatalogID},
					},
				},
			}
			events1 := streamJSONRPCMessage(t, srv.URL+"/a2a/json-rpc", map[string]any{
				"kind":      "message",
				"messageId": "m-1",
				"role":      "user",
				"parts":     []any{map[string]any{"kind": "text", "text": "Top 5 Chinese restaurants in New York"}},
				"metadata":  v10Meta,
			})
			if len(events1) < 3 {
				t.Fatalf("expected streamed SSE events, got %d", len(events1))
			}
			ctxID, _ := events1[0]["contextId"].(string)
			var streamedV10 []map[string]any
			for _, ev := range events1 {
				if ev["kind"] != "status-update" {
					continue
				}
				st, _ := ev["status"].(map[string]any)
				if st["state"] == "working" {
					if m, ok := st["message"].(map[string]any); ok {
						streamedV10 = append(streamedV10, extractA2UIFromParts(t, m["parts"])...)
					}
				}
			}
			if len(streamedV10) == 0 {
				t.Fatalf("expected working v1.0 A2UI parts in stream")
			}
			for _, m := range streamedV10 {
				if m["version"] != "1.0" {
					t.Fatalf("expected 1.0 wire version, got %#v", m)
				}
			}

			// Turn 2: book_restaurant -> booking-form (input-required).
			events2 := streamJSONRPCMessage(t, srv.URL+"/a2a/json-rpc", map[string]any{
				"kind":      "message",
				"messageId": "m-2",
				"role":      "user",
				"contextId": ctxID,
				"parts": []any{
					map[string]any{
						"kind": "data",
						"data": map[string]any{
							"version": "1.0",
							"action": map[string]any{
								"name":              "book_restaurant",
								"surfaceId":         "default",
								"sourceComponentId": "template_book_button",
								"timestamp":         "2026-01-01T19:00:00Z",
								"context": map[string]any{
									"restaurantName": "Xi'an Famous Foods",
									"address":        "81 St Marks Pl, New York, NY 10003",
								},
							},
						},
					},
				},
				"metadata": v10Meta,
			})
			last2 := events2[len(events2)-1]
			if st2, _ := last2["status"].(map[string]any); st2["state"] != "input-required" {
				t.Fatalf("expected input-required after book_restaurant, got %#v", last2)
			}

			// Turn 3: submit_booking -> confirmation (completed).
			events3 := streamJSONRPCMessage(t, srv.URL+"/a2a/json-rpc", map[string]any{
				"kind":      "message",
				"messageId": "m-3",
				"role":      "user",
				"contextId": ctxID,
				"parts": []any{
					map[string]any{
						"kind": "data",
						"data": map[string]any{
							"version": "1.0",
							"action": map[string]any{
								"name":              "submit_booking",
								"surfaceId":         "booking-form",
								"sourceComponentId": "submit_button",
								"timestamp":         "2026-01-01T19:05:00Z",
								"context": map[string]any{
									"restaurantName":  "Xi'an Famous Foods",
									"partySize":       "2",
									"reservationTime": "19:30",
									"dietary":         "None",
								},
							},
						},
					},
				},
				"metadata": v10Meta,
			})
			last3 := events3[len(events3)-1]
			if st3, _ := last3["status"].(map[string]any); st3["state"] != "completed" {
				t.Fatalf("expected completed after submit_booking, got %#v", last3)
			}

			// 4. Unknown catalog ID fails under the announced task ID.
			unknownMeta := map[string]any{
				"a2uiRendererCapabilities": map[string]any{
					"1.0": map[string]any{
						"supportedCatalogIds": []string{"https://example.com/unknown/catalog.json"},
					},
				},
			}
			failEvents := streamJSONRPCMessage(t, srv.URL+"/a2a/json-rpc", map[string]any{
				"kind":      "message",
				"messageId": "m-unknown",
				"role":      "user",
				"parts":     []any{map[string]any{"kind": "text", "text": "hello"}},
				"metadata":  unknownMeta,
			})
			firstID, _ := failEvents[0]["id"].(string)
			lastFail := failEvents[len(failEvents)-1]
			if lastFail["taskId"] != firstID {
				t.Fatalf("failed taskId = %v, want announced %q", lastFail["taskId"], firstID)
			}
			if stFail, _ := lastFail["status"].(map[string]any); stFail["state"] != "failed" {
				t.Fatalf("expected failed state, got %#v", lastFail)
			}
		})
	}
}

type flakyBackend struct {
	calls atomic.Int32
	stub  *stubBackend
	seen  []string
}

func (b *flakyBackend) StreamTurn(ctx context.Context, input turnInput) iter.Seq2[string, error] {
	n := b.calls.Add(1)
	b.seen = append(b.seen, input.Query)
	if n == 1 {
		return func(yield func(string, error) bool) {
			yield("<a2ui>\nsurface(\"broken\")\nroot = NonExistentWidget(\"bad\")\n</a2ui>", nil)
		}
	}
	return b.stub.StreamTurn(ctx, input)
}

func TestValidationSelfRepairRetry(t *testing.T) {
	repoRoot, err := resolveRepoRoot()
	if err != nil {
		t.Fatalf("ResolveRepoRoot: %v", err)
	}
	catalogs, err := loadBasicCatalogs(repoRoot)
	if err != nil {
		t.Fatalf("LoadBasicCatalogs: %v", err)
	}
	stub, err := newStubBackend(repoRoot, formatExpress, catalogs)
	if err != nil {
		t.Fatalf("NewStubBackend: %v", err)
	}
	flaky := &flakyBackend{stub: stub}

	app, err := createServerApp(context.Background(), createServerOptions{
		Env: map[string]string{
			"STUB_LLM":    "true",
			"A2UI_FORMAT": "express",
		},
		Backend: flaky,
	})
	if err != nil {
		t.Fatalf("CreateServerApp: %v", err)
	}
	srv := httptest.NewServer(app.Handler)
	defer srv.Close()

	task := sendJSONRPCMessage(t, srv.URL+"/a2a/json-rpc", map[string]any{
		"kind":      "message",
		"messageId": "m-retry",
		"role":      "user",
		"parts": []any{
			map[string]any{"kind": "text", "text": "Find Chinese food in NY"},
			map[string]any{"kind": "data", "data": map[string]any{"useStreaming": false}},
		},
	})
	if flaky.calls.Load() != 2 {
		t.Fatalf("expected 2 attempts (1 retry), got %d", flaky.calls.Load())
	}
	if !strings.Contains(flaky.seen[1], "Validation failed:") {
		t.Fatalf("expected retry query to include validation error, got %q", flaky.seen[1])
	}
	status, _ := task["status"].(map[string]any)
	msgMap, _ := status["message"].(map[string]any)
	if msgs := extractA2UIFromParts(t, msgMap["parts"]); len(msgs) == 0 {
		t.Fatalf("expected repaired A2UI messages on attempt 2")
	}
}

type streamingFlakyBackend struct {
	mu    sync.Mutex
	calls atomic.Int32
	stub  *stubBackend
	seen  []string
}

func (b *streamingFlakyBackend) StreamTurn(ctx context.Context, input turnInput) iter.Seq2[string, error] {
	n := b.calls.Add(1)
	b.mu.Lock()
	b.seen = append(b.seen, input.Query)
	b.mu.Unlock()
	if n == 1 {
		return func(yield func(string, error) bool) {
			if !yield("Intro from broken attempt\n<a2ui>\nsurface(\"broken\")\n", nil) {
				return
			}
			yield("root = NonExistentWidget(\"bad\")\n</a2ui>", nil)
		}
	}
	return b.stub.StreamTurn(ctx, input)
}

func TestStreamingValidationSelfRepairRetryDoesNotLeakBrokenAttempt(t *testing.T) {
	repoRoot, err := resolveRepoRoot()
	if err != nil {
		t.Fatalf("resolveRepoRoot: %v", err)
	}
	catalogs, err := loadBasicCatalogs(repoRoot)
	if err != nil {
		t.Fatalf("loadBasicCatalogs: %v", err)
	}
	stub, err := newStubBackend(repoRoot, formatExpress, catalogs)
	if err != nil {
		t.Fatalf("newStubBackend: %v", err)
	}
	flaky := &streamingFlakyBackend{stub: stub}

	app, err := createServerApp(context.Background(), createServerOptions{
		Env: map[string]string{
			"STUB_LLM":    "true",
			"A2UI_FORMAT": "express",
		},
		Backend: flaky,
	})
	if err != nil {
		t.Fatalf("createServerApp: %v", err)
	}
	srv := httptest.NewServer(app.Handler)
	defer srv.Close()

	events := streamJSONRPCMessage(t, srv.URL+"/a2a/json-rpc", map[string]any{
		"kind":      "message",
		"messageId": "m-stream-retry",
		"role":      "user",
		"parts": []any{
			map[string]any{"kind": "text", "text": "Find Chinese food in NY"},
		},
	})
	if flaky.calls.Load() != 2 {
		t.Fatalf("expected 2 attempts under useStreaming=true, got %d", flaky.calls.Load())
	}

	var allMsgs []map[string]any
	var allTexts []string
	for _, ev := range events {
		if ev["kind"] != "status-update" {
			continue
		}
		st, _ := ev["status"].(map[string]any)
		msg, ok := st["message"].(map[string]any)
		if !ok {
			continue
		}
		allMsgs = append(allMsgs, extractA2UIFromParts(t, msg["parts"])...)
		if parts, ok := msg["parts"].([]any); ok {
			for _, p := range parts {
				if pm, ok := p.(map[string]any); ok && pm["kind"] == "text" {
					if txt, ok := pm["text"].(string); ok {
						allTexts = append(allTexts, txt)
					}
				}
			}
		}
	}
	if slices.Contains(createdSurfaceIDs(allMsgs), "broken") {
		t.Fatalf("broken attempt surface leaked onto SSE stream: %#v", allMsgs)
	}
	for _, txt := range allTexts {
		if strings.Contains(txt, "Intro from broken attempt") {
			t.Fatalf("broken attempt text leaked onto SSE stream: %q", txt)
		}
	}
	if len(allMsgs) == 0 {
		t.Fatalf("expected repaired A2UI messages on SSE stream")
	}
}

func TestCapabilityNegotiationHeaderParityAndUnsupportedVersions(t *testing.T) {
	srv := startStubTestServer(t, formatExpress)
	defer srv.Close()

	postWithHeaders := func(message map[string]any, extHeader string) (*http.Response, map[string]any) {
		body, err := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"id":      "req-ext",
			"method":  "message/send",
			"params":  map[string]any{"message": message},
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/a2a/json-rpc", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("NewRequest: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		if extHeader != "" {
			req.Header.Set("X-A2A-Extensions", extHeader)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("Do: %v", err)
		}
		raw, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			t.Fatalf("ReadAll: %v", err)
		}
		var env rpcEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("Unmarshal(%s): %v", string(raw), err)
		}
		return resp, env.Result
	}

	bothExts := "https://a2ui.org/a2a-extension/a2ui/v0.9, https://a2ui.org/a2a-extension/a2ui/v1.0"

	// 1. Capabilities match v0.9 -> activates ONLY v0.9 extension URI even when v1.0 was also requested.
	respV09, _ := postWithHeaders(map[string]any{
		"kind":      "message",
		"messageId": "m-cap-v09",
		"role":      "user",
		"parts":     []any{map[string]any{"kind": "text", "text": "hello"}},
		"metadata": map[string]any{
			"a2uiClientCapabilities": map[string]any{
				"v0.9": map[string]any{
					"supportedCatalogIds": []string{v09Profile.BasicCatalogID},
				},
			},
		},
	}, bothExts)
	if gotExt := respV09.Header.Get("X-A2A-Extensions"); gotExt != "https://a2ui.org/a2a-extension/a2ui/v0.9" {
		t.Fatalf("X-A2A-Extensions = %q, want only v0.9 URI", gotExt)
	}

	// 2. Unsupported capability versions across message.Metadata, DataPart.Metadata, and DataPart.Data["metadata"]
	// classify bare supportedCatalogIds as v0.8, sort deterministically, and do NOT activate any extension.
	respUnsupported, resUnsupported := postWithHeaders(map[string]any{
		"kind":      "message",
		"messageId": "m-cap-unsupported",
		"role":      "user",
		"metadata": map[string]any{
			"a2uiRendererCapabilities": map[string]any{
				"2.0": map[string]any{"supportedCatalogIds": []string{"cat-2"}},
			},
		},
		"parts": []any{
			map[string]any{
				"kind": "data",
				"metadata": map[string]any{
					"a2uiClientCapabilities": map[string]any{
						"supportedCatalogIds": []string{"cat-08"},
					},
				},
				"data": map[string]any{
					"metadata": map[string]any{
						"a2uiRendererCapabilities": map[string]any{
							"0.9.1": map[string]any{"supportedCatalogIds": []string{"cat-091"}},
						},
					},
				},
			},
		},
	}, bothExts)
	if gotExt := respUnsupported.Header.Get("X-A2A-Extensions"); gotExt != "" {
		t.Fatalf("expected no activated extension on unsupported capabilities, got %q", gotExt)
	}
	stUnsupported, _ := resUnsupported["status"].(map[string]any)
	if stUnsupported["state"] != "failed" {
		t.Fatalf("expected failed task state, got %#v", resUnsupported)
	}
	msgUnsupported, _ := stUnsupported["message"].(map[string]any)
	partsUnsupported, _ := msgUnsupported["parts"].([]any)
	errPart, _ := partsUnsupported[0].(map[string]any)
	errText, _ := errPart["text"].(string)
	wantSubstr := "the renderer supports A2UI 0.9.1, 2.0, v0.8, but this agent serves only v0.9, 1.0"
	if !strings.Contains(errText, wantSubstr) {
		t.Fatalf("error text = %q, want substring %q", errText, wantSubstr)
	}

	// 3. No capabilities metadata falls back to extension negotiation (activates v1.0).
	respFallbackExt, resFallbackExt := postWithHeaders(map[string]any{
		"kind":      "message",
		"messageId": "m-ext-only",
		"role":      "user",
		"parts": []any{
			map[string]any{"kind": "text", "text": "Top 5 Chinese restaurants in New York"},
			map[string]any{"kind": "data", "data": map[string]any{"useStreaming": false}},
		},
	}, bothExts)
	if gotExt := respFallbackExt.Header.Get("X-A2A-Extensions"); gotExt != "https://a2ui.org/a2a-extension/a2ui/v1.0" {
		t.Fatalf("X-A2A-Extensions = %q, want v1.0 URI", gotExt)
	}
	stExt, _ := resFallbackExt["status"].(map[string]any)
	msgExt, _ := stExt["message"].(map[string]any)
	msgsExt := extractA2UIFromParts(t, msgExt["parts"])
	if len(msgsExt) == 0 || msgsExt[0]["version"] != "1.0" {
		t.Fatalf("expected v1.0 messages from extension fallback, got %#v", msgsExt)
	}
}

func TestAgentCardTrailingSlashAndCORSVaryHeaders(t *testing.T) {
	card := buildAgentCard(10002, "https://agent.example.com/", true)
	if card.URL != "https://agent.example.com/a2a/json-rpc" {
		t.Fatalf("card.URL = %q, want https://agent.example.com/a2a/json-rpc", card.URL)
	}

	srv := startStubTestServer(t, formatExpress)
	defer srv.Close()

	optReq, _ := http.NewRequest(http.MethodOptions, srv.URL+"/a2a/json-rpc", nil)
	optReq.Header.Set("Origin", "http://localhost:5173")
	optResp, err := http.DefaultClient.Do(optReq)
	if err != nil {
		t.Fatalf("OPTIONS: %v", err)
	}
	optResp.Body.Close()
	varyOpt := optResp.Header.Values("Vary")
	if !slices.Contains(varyOpt, "Origin") || !slices.Contains(varyOpt, "Access-Control-Request-Headers") {
		t.Fatalf("OPTIONS Vary = %v, want Origin and Access-Control-Request-Headers", varyOpt)
	}

	getResp, err := http.Get(srv.URL + "/.well-known/agent-card.json")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	getResp.Body.Close()
	if !slices.Contains(getResp.Header.Values("Vary"), "Origin") {
		t.Fatalf("GET Vary = %v, want Origin", getResp.Header.Values("Vary"))
	}
}

type scriptedADKModel struct {
	mu    sync.Mutex
	turns [][]*model.LLMResponse
}

func (m *scriptedADKModel) Name() string { return "scripted-adk" }

func (m *scriptedADKModel) GenerateContent(_ context.Context, _ *model.LLMRequest, _ bool) iter.Seq2[*model.LLMResponse, error] {
	m.mu.Lock()
	var turn []*model.LLMResponse
	if len(m.turns) > 0 {
		turn, m.turns = m.turns[0], m.turns[1:]
	}
	m.mu.Unlock()
	return func(yield func(*model.LLMResponse, error) bool) {
		for _, resp := range turn {
			if !yield(resp, nil) {
				return
			}
		}
	}
}

func TestADKBackendDrainsInterruptedTurnCleansProcessorsAndEvictsLRU(t *testing.T) {
	repoRoot, err := resolveRepoRoot()
	if err != nil {
		t.Fatalf("resolveRepoRoot: %v", err)
	}
	catalogs, err := loadBasicCatalogs(repoRoot)
	if err != nil {
		t.Fatalf("loadBasicCatalogs: %v", err)
	}
	exec, err := newRestaurantExecutor(repoRoot, formatExpress, nil, catalogs, nil)
	if err != nil {
		t.Fatalf("newRestaurantExecutor: %v", err)
	}
	proc, err := exec.createProcessor(v10Profile, []string{v10Profile.BasicCatalogID})
	if err != nil {
		t.Fatalf("createProcessor: %v", err)
	}

	chunk1 := "<a2ui>\nsurface(\"broken\")\n"
	chunk2 := "root = NonExistent(\"bad\")\n</a2ui>"
	full1 := chunk1 + chunk2
	validReply := "<a2ui>\nsurface(\"default\")\nroot = Text(\"Repaired\")\n</a2ui>"

	llm := &scriptedADKModel{
		turns: [][]*model.LLMResponse{
			{
				{Content: genai.NewContentFromText(chunk1, genai.RoleModel), Partial: true},
				{Content: genai.NewContentFromText(chunk2, genai.RoleModel), Partial: true},
				{Content: genai.NewContentFromText(full1, genai.RoleModel), Partial: false, TurnComplete: true},
			},
			{{Content: genai.NewContentFromText(validReply, genai.RoleModel), Partial: false, TurnComplete: true}},
			{{Content: genai.NewContentFromText(validReply, genai.RoleModel), Partial: false, TurnComplete: true}},
			{{Content: genai.NewContentFromText(validReply, genai.RoleModel), Partial: false, TurnComplete: true}},
		},
	}

	backend, err := newADKBackendWithModel(llm, "http://localhost:10002", resolvePythonSampleDir(repoRoot), formatExpress, 2)
	if err != nil {
		t.Fatalf("newADKBackendWithModel: %v", err)
	}

	// Stop consuming after the first partial chunk; backend must still drain the ADK turn and remove the processor.
	count := 0
	for _, turnErr := range backend.StreamTurn(context.Background(), turnInput{
		ContextID:    "ctx-1",
		Query:        "first",
		Profile:      v10Profile,
		Processor:    proc,
		UseStreaming: true,
	}) {
		if turnErr != nil {
			t.Fatalf("StreamTurn: %v", turnErr)
		}
		count++
		break
	}
	if count != 1 {
		t.Fatalf("expected 1 consumed chunk, got %d", count)
	}
	if n := backend.processors.Len(); n != 0 {
		t.Fatalf("expected ProcessorStore cleaned up after turn, got %d", n)
	}

	sessResp, err := backend.sessionService.Get(context.Background(), &session.GetRequest{
		AppName:   adkAppName,
		UserID:    adkUserID,
		SessionID: "ctx-1:1.0",
	})
	if err != nil {
		t.Fatalf("sessionService.Get(ctx-1:1.0): %v", err)
	}
	if gotEvents := sessResp.Session.Events().Len(); gotEvents < 2 {
		t.Fatalf("expected balanced user+model events recorded after drained turn, got %d", gotEvents)
	}

	// Run 3 more distinct sessions (maxSessions=2) and verify ctx-1:1.0 is evicted from sessionService.
	for _, cid := range []string{"ctx-2", "ctx-3", "ctx-4"} {
		for _, turnErr := range backend.StreamTurn(context.Background(), turnInput{
			ContextID:    cid,
			Query:        "hi",
			Profile:      v10Profile,
			Processor:    proc,
			UseStreaming: false,
		}) {
			if turnErr != nil {
				t.Fatalf("StreamTurn(%s): %v", cid, turnErr)
			}
		}
	}
	if _, err := backend.sessionService.Get(context.Background(), &session.GetRequest{
		AppName:   adkAppName,
		UserID:    adkUserID,
		SessionID: "ctx-1:1.0",
	}); err == nil {
		t.Fatalf("expected oldest session ctx-1:1.0 to be evicted from sessionService")
	}
	if _, err := backend.sessionService.Get(context.Background(), &session.GetRequest{
		AppName:   adkAppName,
		UserID:    adkUserID,
		SessionID: "ctx-4:1.0",
	}); err != nil {
		t.Fatalf("expected recent session ctx-4:1.0 to remain in sessionService: %v", err)
	}
}
