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

package core_test

import (
	"errors"
	"runtime"
	"testing"
	"time"

	"github.com/a2ui-project/a2ui/go/core"
)

// TestPayloadValidatorReleasesCatalogs checks that validating against a catalog does not keep
// the catalog (and its compiled schemas) reachable after the caller drops it, which used to leak
// one compiled-schema cache per catalog, for example per inline catalog an agent receives.
func TestPayloadValidatorReleasesCatalogs(t *testing.T) {
	tests := []struct {
		name     string
		validate func(v *core.PayloadValidator) error
	}{
		{"component", func(v *core.PayloadValidator) error {
			return v.ValidateComponent(map[string]any{"id": "root", "component": "Text", "text": "hi"}, "s")
		}},
		{"function", func(v *core.PayloadValidator) error {
			_, err := v.ValidateFunctionArgs("required", map[string]any{"value": "x"})
			return err
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			collected := make(chan struct{})
			func() {
				cat := core.MustBasicCatalog(core.Version1_0)
				runtime.SetFinalizer(cat, func(*core.Catalog) { close(collected) })
				if err := tc.validate(core.NewPayloadValidator(cat, nil)); err != nil {
					t.Fatalf("validate: %v", err)
				}
			}()
			deadline := time.After(10 * time.Second)
			for {
				runtime.GC()
				select {
				case <-collected:
					return
				case <-deadline:
					t.Fatal("catalog was not garbage collected after validation; a global cache still references it")
				case <-time.After(10 * time.Millisecond):
				}
			}
		})
	}
}

func TestV10CreateSurfaceDropsThemeOnlyInRelaxedMode(t *testing.T) {
	cat := core.MustBasicCatalog(core.Version1_0)
	msg := core.AgentToRendererMessage{
		"version": "1.0",
		"createSurface": map[string]any{
			"surfaceId": "s1",
			"catalogId": cat.CatalogID(),
			"theme":     map[string]any{"primaryColor": "#123456"},
		},
	}

	strictCfg := core.StrictValidation()
	strictProc, err := core.NewMessageProcessor([]*core.Catalog{cat}, &core.MessageProcessorOptions{ValidationConfig: &strictCfg})
	if err != nil {
		t.Fatalf("NewMessageProcessor(strict): %v", err)
	}
	if err := strictProc.ProcessMessages([]core.AgentToRendererMessage{msg}, nil); err == nil {
		t.Fatal("expected strict v1.0 MessageProcessor to reject theme on createSurface")
	}

	relaxedCfg := core.RelaxedValidation()
	relaxedProc, err := core.NewMessageProcessor([]*core.Catalog{cat}, &core.MessageProcessorOptions{ValidationConfig: &relaxedCfg})
	if err != nil {
		t.Fatalf("NewMessageProcessor(relaxed): %v", err)
	}
	if err := relaxedProc.ProcessMessages([]core.AgentToRendererMessage{msg}, nil); err != nil {
		t.Fatalf("expected relaxed v1.0 MessageProcessor to drop theme on createSurface, got: %v", err)
	}
	surf := relaxedProc.Model.Surface("s1")
	if surf == nil || len(surf.Theme) != 0 {
		t.Fatalf("expected empty surface theme after dropping v1.0 createSurface theme, got %+v", surf)
	}
}

func TestRPCHandlerRendererFunctionErrorMessage(t *testing.T) {
	for _, tc := range []struct {
		name    string
		errMsg  string
		wantMsg string
	}{
		{"forwards custom error", "disk full", "disk full"},
		{"empty fallback", "", "An error occurred during function execution."},
		{"whitespace fallback", "  \t\n ", "An error occurred during function execution."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cat, err := core.MustBasicCatalog(core.Version1_0).Derive(core.DeriveOptions{
				CatalogID: "https://example.com/cat.json",
				Functions: []any{
					core.FunctionAPI{
						Name:           "boom",
						ReturnType:     core.ReturnTypeAny,
						Schema:         map[string]any{"type": "object"},
						AllowedCallers: core.AllowedCallersRendererOrAgent,
						Evaluate: func(map[string]any, *core.DataContext) (any, error) {
							return nil, errors.New(tc.errMsg)
						},
					},
				},
			})
			if err != nil {
				t.Fatalf("Derive: %v", err)
			}
			proc, err := core.NewMessageProcessor([]*core.Catalog{cat}, nil)
			if err != nil {
				t.Fatalf("NewMessageProcessor: %v", err)
			}
			resp, err := proc.RPC.HandleCallRendererFunction(core.CallRendererFunctionPayload{
				FunctionCallID: "c1",
				CallFunction: core.CallFunctionPayload{
					Call:      "boom",
					CatalogID: cat.CatalogID(),
				},
			}, false, nil, false)
			if err != nil {
				t.Fatalf("HandleCallRendererFunction: %v", err)
			}
			rfr, _ := resp["rendererFunctionResponse"].(map[string]any)
			errObj, _ := rfr["error"].(map[string]any)
			if got, _ := errObj["message"].(string); got != tc.wantMsg {
				t.Fatalf("got message %q, want %q", got, tc.wantMsg)
			}
		})
	}
}
