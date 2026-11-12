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

package macros_test

import (
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"

	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/agent/macros"
	"github.com/a2ui-project/a2ui/go/core"
)

func TestMixedProtocolVersionMacroRejected(t *testing.T) {
	type mixedArgs struct {
		Title  v1.DynamicString `json:"title"`
		Action v09.Action       `json:"action"`
	}
	_, err := macros.NewPureMacro("MixedCard", "", func(a mixedArgs) *v1.Card {
		return v1.NewCard(v1.NewText(a.Title))
	})
	var valErr *core.ValidationError
	if !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for mixed v0.9/v1.0 macro annotations, got %v", err)
	}
}

func TestTransformCatalogsV1SidecarAndPassthroughPruning(t *testing.T) {
	basicV1, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog(1.0) failed: %v", err)
	}

	type badgeArgs struct {
		Label string `json:"label" desc:"Badge text"`
	}
	badge := macros.MustNewPureMacro("QuickBadge", "Compact status pill.", func(a badgeArgs) *v1.Card {
		return v1.NewCard(v1.NewText(v1.Str(a.Label)))
	})

	exp, err := macros.NewMacroExpander([]*macros.Macro{badge}, &macros.ExpanderOptions{
		PassthroughFilter: macros.PassthroughOnly("Button"),
	})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	infCats, err := exp.TransformCatalogs([]*core.Catalog{basicV1})
	if err != nil {
		t.Fatalf("TransformCatalogs failed: %v", err)
	}
	if len(infCats) != 2 {
		t.Fatalf("expected [prunedBasic, macroSidecar] (2 catalogs), got %d", len(infCats))
	}

	prunedComps, _ := infCats[0].ToJSON()["components"].(map[string]any)
	if len(prunedComps) != 1 || prunedComps["Button"] == nil {
		t.Fatalf("expected pruned basic catalog to retain only Button, got %v", prunedComps)
	}

	sidecarDoc := infCats[1].ToJSON()
	if sidecarDoc["catalogId"] != macros.DefaultMacroCatalogID {
		t.Fatalf("unexpected sidecar catalogId: %v", sidecarDoc["catalogId"])
	}
	sidecarComps, _ := sidecarDoc["components"].(map[string]any)
	qbSchema, _ := sidecarComps["QuickBadge"].(map[string]any)
	props, _ := qbSchema["properties"].(map[string]any)
	lblProp, _ := props["label"].(map[string]any)
	if lblProp["description"] != "Badge text" {
		t.Fatalf("expected parameter description 'Badge text', got %v", lblProp["description"])
	}

	// Lowering on a defaultless v1.0 surface stamps basic @catalogId onto Card and Text!
	msgs := []core.AgentToRendererMessage{
		mustCreateSurface(t, "s1"),
		v1.UpdateComponents("s1", []map[string]any{
			{
				"id":         "root",
				"component":  "QuickBadge",
				"@catalogId": macros.DefaultMacroCatalogID,
				"label":      "OK",
			},
		}),
	}
	lowered, err := exp.TransformToTransport(msgs)
	if err != nil {
		t.Fatalf("TransformToTransport failed: %v", err)
	}
	uc := lowered[1]["updateComponents"].(map[string]any)
	comps := uc["components"].([]any)
	if len(comps) != 2 {
		t.Fatalf("expected 2 lowered components, got %d", len(comps))
	}
	for _, c := range comps {
		cm := c.(map[string]any)
		if cm["@catalogId"] != basicV1.CatalogID() {
			t.Fatalf("expected auto-stamped @catalogId %q, got %v", basicV1.CatalogID(), cm["@catalogId"])
		}
	}

	// Nested sub-model schema & coercion check (TabItem list parameter).
	type tabbedArgs struct {
		Tabs []v1.TabItem `json:"tabs"`
	}
	tabbed := macros.MustNewPureMacro("TabbedCard", "", func(a tabbedArgs) *v1.Card {
		return v1.NewCard(v1.NewTabs(a.Tabs...))
	})
	tabExp, err := macros.NewMacroExpander([]*macros.Macro{tabbed}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander(tabbed) failed: %v", err)
	}
	tabLowered, err := tabExp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s2", []map[string]any{
			{
				"id":        "root",
				"component": "TabbedCard",
				"tabs": []any{
					map[string]any{"title": map[string]any{"@path": "/tabTitle"}, "child": "ext_tab_body"},
				},
			},
		}),
	})
	if err != nil {
		t.Fatalf("tabExp.TransformToTransport failed: %v", err)
	}
	tabComps := tabLowered[0]["updateComponents"].(map[string]any)["components"].([]any)
	tabsComp := tabComps[0].(map[string]any)
	wantTabs := []any{
		map[string]any{
			"title": map[string]any{"@path": "/tabTitle"},
			"child": "ext_tab_body",
		},
	}
	if !reflect.DeepEqual(tabsComp["tabs"], wantTabs) {
		t.Fatalf("unexpected coerced tabs: %#v", tabsComp["tabs"])
	}
}

func TestMacroExpanderConcurrentAccess(t *testing.T) {
	basicV1, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog(1.0) failed: %v", err)
	}

	type badgeArgs struct {
		Label string `json:"label"`
	}
	badge := macros.MustNewPureMacro("ConcurrentBadge", "Concurrent test badge.", func(a badgeArgs) *v1.Card {
		return v1.NewCard(v1.NewText(v1.Str(a.Label)))
	})

	exp, err := macros.NewMacroExpander([]*macros.Macro{badge}, &macros.ExpanderOptions{
		OnError: macros.OnErrorRaise,
	})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	// One session shared by every goroutine exercises the tracker's locking and its LRU
	// eviction once more than 256 surfaces are live.
	shared := exp.NewSession()

	const workers = 32
	const iterations = 12
	var wg sync.WaitGroup
	errCh := make(chan error, workers*iterations*4)

	for g := range workers {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for i := range iterations {
				if err := exp.RegisterCatalog(basicV1); err != nil {
					errCh <- err
					return
				}
				if _, err := exp.TransformCatalogs([]*core.Catalog{basicV1}); err != nil {
					errCh <- err
					return
				}
				if _, err := exp.TransformToInferenceCatalog(basicV1); err != nil {
					errCh <- err
					return
				}
				if _, err := exp.ToCatalog(); err != nil {
					errCh <- err
					return
				}

				// Exercise stateful surface tracking (opts == nil), eviction (>256 surfaces), and deleteSurface concurrently.
				sid := fmt.Sprintf("surf_%d_%d", workerID, i)
				create, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: sid})
				if err != nil {
					errCh <- err
					return
				}
				msgs := []core.AgentToRendererMessage{
					create,
					v1.UpdateComponents(sid, []map[string]any{
						{
							"id":         "root",
							"component":  "ConcurrentBadge",
							"@catalogId": macros.DefaultMacroCatalogID,
							"label":      fmt.Sprintf("item-%d-%d", workerID, i),
						},
					}),
				}
				if i%4 == 3 {
					msgs = append(msgs, v1.DeleteSurface(sid))
				}
				transform := exp.TransformToTransport
				if i%2 == 0 {
					transform = shared.TransformToTransport
				}
				lowered, err := transform(msgs)
				if err != nil {
					errCh <- err
					return
				}
				if len(lowered) != len(msgs) {
					errCh <- fmt.Errorf("expected %d lowered messages, got %d", len(msgs), len(lowered))
					return
				}
			}
		}(g)
	}

	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent MacroExpander operation failed: %v", err)
	}
}

func mustCreateSurface(t *testing.T, surfaceID string) core.AgentToRendererMessage {
	t.Helper()
	msg, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: surfaceID})
	if err != nil {
		t.Fatalf("CreateSurface(%q) failed: %v", surfaceID, err)
	}
	return msg
}

func TestTransportSessionsIsolateSurfaceState(t *testing.T) {
	basicV1 := core.MustBasicCatalog(core.Version1_0)
	type badgeArgs struct {
		Label string `json:"label"`
	}
	badge := macros.MustNewPureMacro("SessionBadge", "Session test badge.", func(a badgeArgs) *v1.Text {
		return v1.NewText(v1.Str(a.Label))
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{badge}, &macros.ExpanderOptions{
		BaseCatalogs: []*core.Catalog{basicV1},
		OnError:      macros.OnErrorRaise,
	})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	update := v1.UpdateComponents("main", []map[string]any{
		{"id": "root", "component": "SessionBadge", "@catalogId": macros.DefaultMacroCatalogID, "label": "Hi"},
	})

	// Conversation A creates "main" with the basic catalog as its default, in an earlier call.
	sessionA := exp.NewSession()
	createA, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: "main", CatalogID: basicV1.CatalogID()})
	if err != nil {
		t.Fatalf("CreateSurface failed: %v", err)
	}
	if _, err := sessionA.TransformToTransport([]core.AgentToRendererMessage{createA}); err != nil {
		t.Fatalf("sessionA createSurface failed: %v", err)
	}

	// Conversation B resumes a defaultless "main"; its state must not leak into A or vice versa.
	sessionB := exp.NewSession()
	sessionB.TrackSurface("main", "")

	loweredA, err := sessionA.TransformToTransport([]core.AgentToRendererMessage{update})
	if err != nil {
		t.Fatalf("sessionA updateComponents failed: %v", err)
	}
	loweredB, err := sessionB.TransformToTransport([]core.AgentToRendererMessage{update})
	if err != nil {
		t.Fatalf("sessionB updateComponents failed: %v", err)
	}

	rootA := firstComponent(t, loweredA)
	if _, stamped := rootA["@catalogId"]; stamped {
		t.Fatalf("session A inherits the surface default catalog, so the lowered Text must not be stamped: %#v", rootA)
	}
	rootB := firstComponent(t, loweredB)
	if rootB["@catalogId"] != basicV1.CatalogID() {
		t.Fatalf("session B's defaultless surface must stamp the owning catalogId, got %#v", rootB)
	}
}

func firstComponent(t *testing.T, msgs []core.AgentToRendererMessage) map[string]any {
	t.Helper()
	body, _ := msgs[0]["updateComponents"].(map[string]any)
	comps, _ := body["components"].([]any)
	if len(comps) == 0 {
		t.Fatalf("expected lowered components, got %#v", msgs[0])
	}
	comp, _ := comps[0].(map[string]any)
	return comp
}
