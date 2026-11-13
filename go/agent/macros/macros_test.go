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
	"math"
	"reflect"
	"sync"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/builder"
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

func TestChildSlotParameterRestrictionsAndCustomSliceCoercion(t *testing.T) {
	var valErr *core.ValidationError

	// Concrete component pointer/struct parameter types are rejected at registration time.
	type concretePtrSlotArgs struct {
		Child *v1.Text `json:"child"`
	}
	if _, err := macros.NewPureMacro("BadSlotPtr", "", func(a concretePtrSlotArgs) *v1.Card {
		return v1.NewCard(a.Child)
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for *v1.Text macro parameter, got %v", err)
	}

	type concreteSliceSlotArgs struct {
		Children []*v1.Text `json:"children"`
	}
	if _, err := macros.NewPureMacro("BadSlotSlice", "", func(a concreteSliceSlotArgs) *v1.Card {
		return v1.NewCard(v1.NewDivider())
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for []*v1.Text macro parameter, got %v", err)
	}

	type valueRefSlotArgs struct {
		Child builder.ComponentRef `json:"child"`
	}
	if _, err := macros.NewPureMacro("BadValueRef", "", func(a valueRefSlotArgs) *v1.Card {
		return v1.NewCard(v1.NewDivider())
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for value builder.ComponentRef parameter, got %v", err)
	}

	// Custom defined slice of *builder.ComponentRef and defined map string key type coerce cleanly.
	type customRefList []*builder.ComponentRef
	type metaKey string
	type customSlotsArgs struct {
		Refs customRefList      `json:"refs"`
		Meta map[metaKey]string `json:"meta"`
	}
	m := macros.MustNewPureMacro("CustomRefContainer", "", func(a customSlotsArgs) *v1.Column {
		nodes := make([]builder.Node, 0, len(a.Refs)+1)
		nodes = append(nodes, v1.NewText(v1.Str(a.Meta["env"])))
		for _, r := range a.Refs {
			nodes = append(nodes, r)
		}
		return v1.NewColumn(v1.Children(nodes...))
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{m}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	lowered, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "CustomRefContainer",
			"refs":      []any{"ext_1", "ext_2"},
			"meta":      map[string]any{"env": "prod"},
		}}),
	})
	if err != nil {
		t.Fatalf("TransformToTransport failed: %v", err)
	}
	comps := lowered[0]["updateComponents"].(map[string]any)["components"].([]any)
	colComp := comps[len(comps)-1].(map[string]any)
	if !reflect.DeepEqual(colComp["children"], []any{"root__text_1", "ext_1", "ext_2"}) {
		t.Fatalf("unexpected children: %#v", colComp["children"])
	}

	// Passing an inline builder.Node subtree into a []*builder.ComponentRef slot is rejected.
	if _, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "CustomRefContainer",
			"refs":      []any{v1.NewText(v1.Str("inline"))},
			"meta":      map[string]any{"env": "prod"},
		}}),
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected inline subtree on []*ComponentRef slot to fail validation, got %v", err)
	}
}

func TestNumericBoundsInt64PrecisionAndDefaultValidation(t *testing.T) {
	var valErr *core.ValidationError

	// Invalid default tags are caught at NewMacro construction time.
	type overflowDefaultArgs struct {
		Small uint8 `json:"small" default:"300"`
	}
	if _, err := macros.NewPureMacro("BadDefaultOverflow", "", func(a overflowDefaultArgs) *v1.Text {
		return v1.NewText(v1.Str("x"))
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for uint8 default overflow, got %v", err)
	}

	type badEnumDefaultArgs struct {
		Mode string `json:"mode" enum:"fast,slow" default:"medium"`
	}
	if _, err := macros.NewPureMacro("BadDefaultEnum", "", func(a badEnumDefaultArgs) *v1.Text {
		return v1.NewText(v1.Str(a.Mode))
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for out-of-enum default, got %v", err)
	}

	// Exact 64-bit integer precision (> 2^53) and Uint/Int overflow checks.
	const exactLargeInt64 int64 = (1 << 53) + 1 // 9007199254740993
	type numArgs struct {
		BigID  int64            `json:"bigId"`
		Port   uint16           `json:"port"`
		Small  int8             `json:"small"`
		DynNum v1.DynamicNumber `json:"dynNum"`
		DynVal v1.DynamicValue  `json:"dynVal"`
	}
	numMacro := macros.MustNewPureMacro("PrecisionCard", "", func(a numArgs) *v1.Button {
		return v1.NewButton(
			v1.NewSlider(1e18, a.DynNum),
			v1.EventAction("verify", map[string]v1.DynamicValue{
				"bigId":  v1.Int64(a.BigID),
				"port":   v1.Int(int(a.Port)),
				"small":  v1.Int(int(a.Small)),
				"dynVal": a.DynVal,
			}),
		)
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{numMacro}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	lowered, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "PrecisionCard",
			"bigId":     exactLargeInt64,
			"port":      uint(8080),
			"small":     -42,
			"dynNum":    exactLargeInt64,
			"dynVal":    exactLargeInt64,
		}}),
	})
	if err != nil {
		t.Fatalf("PrecisionCard TransformToTransport failed: %v", err)
	}
	comps := lowered[0]["updateComponents"].(map[string]any)["components"].([]any)
	sliderComp := comps[0].(map[string]any)
	if sliderComp["value"] != exactLargeInt64 {
		t.Fatalf("expected exact int64 slider value %d, got %#v", exactLargeInt64, sliderComp["value"])
	}
	btnComp := comps[1].(map[string]any)
	evCtx := btnComp["action"].(map[string]any)["event"].(map[string]any)["context"].(map[string]any)
	if evCtx["bigId"] != exactLargeInt64 || evCtx["dynVal"] != exactLargeInt64 {
		t.Fatalf("expected exact 64-bit integers preserved in context, got %#v", evCtx)
	}

	// Overflowing int8, uint16, float64(2^63) into int64, and uint64(MaxUint64) into int64 all fail.
	badInputs := []map[string]any{
		{"id": "r", "component": "PrecisionCard", "bigId": int64(1), "port": 70000, "small": 1, "dynNum": 1, "dynVal": 1},
		{"id": "r", "component": "PrecisionCard", "bigId": int64(1), "port": -1, "small": 1, "dynNum": 1, "dynVal": 1},
		{"id": "r", "component": "PrecisionCard", "bigId": int64(1), "port": 80, "small": 200, "dynNum": 1, "dynVal": 1},
		{"id": "r", "component": "PrecisionCard", "bigId": math.Ldexp(1, 63), "port": 80, "small": 1, "dynNum": 1, "dynVal": 1},
		{"id": "r", "component": "PrecisionCard", "bigId": uint64(math.MaxUint64), "port": 80, "small": 1, "dynNum": 1, "dynVal": 1},
	}
	for i, bad := range badInputs {
		if _, err := exp.TransformToTransport([]core.AgentToRendererMessage{v1.UpdateComponents("s1", []map[string]any{bad})}); !errors.As(err, &valErr) {
			t.Fatalf("bad numeric case %d: expected *core.ValidationError, got %v", i, err)
		}
	}
}

func TestNullPreservationInMapsAnyParamsAndFunctionCallArgs(t *testing.T) {
	type nullAwareArgs struct {
		Value any             `json:"value"`
		Data  map[string]any  `json:"data"`
		Call  v1.FunctionCall `json:"call"`
	}
	var capturedMap map[string]any
	var sawNullKey bool
	m := macros.MustNewPureMacro("NullAware", "", func(a nullAwareArgs) *v1.TextField {
		capturedMap = a.Data
		_, sawNullKey = a.Data["keepNull"]
		lbl := "non-nil"
		if a.Value == nil {
			lbl = "is-nil"
		}
		return v1.NewTextField(v1.Str(lbl), v1.Str("v")).WithChecks(v1.NewCheckRule(a.Call, "req"))
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{m}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	// Explicit {"value": nil}, {"keepNull": nil} in map[string]any, and {"value": nil} in FunctionCall.args succeed.
	lowered, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "NullAware",
			"value":     nil,
			"data":      map[string]any{"keepNull": nil, "present": "ok"},
			"call":      map[string]any{"@call": "required", "args": map[string]any{"value": nil}},
		}}),
	})
	if err != nil {
		t.Fatalf("NullAware TransformToTransport failed: %v", err)
	}
	if !sawNullKey || capturedMap["keepNull"] != nil {
		t.Fatalf("expected nil entry preserved in map[string]any, got %#v", capturedMap)
	}
	tf := firstComponent(t, lowered)
	if tf["label"] != "is-nil" {
		t.Fatalf("expected explicit null on 'any' parameter to set nil, got label=%v", tf["label"])
	}
	wantChecks := []any{map[string]any{
		"condition": map[string]any{"@call": "required", "args": map[string]any{"value": nil}},
		"message":   "req",
	}}
	if !reflect.DeepEqual(tf["@checks"], wantChecks) {
		t.Fatalf("unexpected @checks with null FunctionCall arg: %#v", tf["@checks"])
	}

	// Omitting required 'any' parameter still fails validation.
	var valErr *core.ValidationError
	if _, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "NullAware",
			"data":      map[string]any{},
			"call":      map[string]any{"@call": "required", "args": map[string]any{"value": nil}},
		}}),
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected missing required 'any' parameter to fail, got %v", err)
	}
}

type unexportedEmbeddedArgs struct {
	Tenant string `json:"tenant"`
}

type ExportedPtrEmbeddedArgs struct {
	Region string `json:"region" default:"us"`
}

type unexportedMixedVersionHolder struct {
	BadV09 *v09.Text
}

type sneakyMixedReturnNode struct {
	v1.ComponentNode
	unexportedMixedVersionHolder
}

func (sneakyMixedReturnNode) ComponentType() string { return "SneakyMixed" }

func TestSchemaActionEventEmbeddedStructsNestedTagsAndSliceEnums(t *testing.T) {
	type subFilter struct {
		Env  string `json:"env" default:"staging" enum:"dev,staging,prod"`
		Name string `json:"name"`
	}
	type richSchemaArgs struct {
		unexportedEmbeddedArgs
		*ExportedPtrEmbeddedArgs
		Event  v1.ActionEvent `json:"event"`
		Scopes []string       `json:"scopes" enum:"read,write"`
		Filter subFilter      `json:"filter"`
	}
	m := macros.MustNewPureMacro("RichSchemaCard", "", func(a richSchemaArgs) *v1.Button {
		region := ""
		if a.ExportedPtrEmbeddedArgs != nil {
			region = a.Region
		}
		lbl := fmt.Sprintf("%s:%s:%s:%s:%v", a.Tenant, region, a.Filter.Env, a.Filter.Name, a.Scopes)
		return v1.NewButton(v1.NewText(v1.Str(lbl)), v1.Action{Event: &a.Event})
	})

	schema := m.ToJSONSchema(macros.SchemaOptions{IncludeComponentConst: true, Version: builder.VersionFamily1_0})
	props := schema["properties"].(map[string]any)

	// ActionEvent requires only ["name"].
	evSchema := props["event"].(map[string]any)
	if !reflect.DeepEqual(evSchema["required"], []any{"name"}) {
		t.Fatalf("ActionEvent schema required = %#v, want [\"name\"]", evSchema["required"])
	}

	// []string with enum tag puts enum on items, not on top-level array schema.
	scopesSchema := props["scopes"].(map[string]any)
	if scopesSchema["type"] != "array" {
		t.Fatalf("expected scopes type 'array', got %#v", scopesSchema)
	}
	if !reflect.DeepEqual(scopesSchema["items"], map[string]any{"type": "string", "enum": []any{"read", "write"}}) {
		t.Fatalf("unexpected scopes.items schema: %#v", scopesSchema["items"])
	}

	// Nested struct honors default (omitted from required) and enum tags.
	filterSchema := props["filter"].(map[string]any)
	if !reflect.DeepEqual(filterSchema["required"], []any{"name"}) {
		t.Fatalf("filter schema required = %#v, want [\"name\"]", filterSchema["required"])
	}
	filterProps := filterSchema["properties"].(map[string]any)
	if !reflect.DeepEqual(filterProps["env"], map[string]any{"type": "string", "enum": []any{"dev", "staging", "prod"}}) {
		t.Fatalf("unexpected filter.env schema: %#v", filterProps["env"])
	}

	// Anonymous embedded struct fields are promoted to top-level properties.
	if props["tenant"] == nil || props["region"] == nil {
		t.Fatalf("expected embedded struct fields promoted in schema, got %#v", props)
	}

	exp, err := macros.NewMacroExpander([]*macros.Macro{m}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	lowered, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "RichSchemaCard",
			"tenant":    "acme",
			"event":     map[string]any{"name": "go"},
			"scopes":    []any{"read", "write"},
			"filter":    map[string]any{"name": "k8s"},
		}}),
	})
	if err != nil {
		t.Fatalf("RichSchemaCard TransformToTransport failed: %v", err)
	}
	comps := lowered[0]["updateComponents"].(map[string]any)["components"].([]any)
	txtComp := comps[0].(map[string]any)
	if txtComp["text"] != "acme:us:staging:k8s:[read write]" {
		t.Fatalf("unexpected coerced embedded/default values: %v", txtComp["text"])
	}

	// Out-of-enum element in []string fails validation.
	var valErr *core.ValidationError
	if _, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "RichSchemaCard",
			"tenant":    "acme",
			"event":     map[string]any{"name": "go"},
			"scopes":    []any{"read", "delete"},
			"filter":    map[string]any{"name": "k8s"},
		}}),
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected invalid slice enum item to fail validation, got %v", err)
	}

	// collectReturnedNodeVersions inspects unexported anonymous embedded structs without panicking.
	type emptyArgs struct{}
	sneaky := macros.MustNewPureMacro("SneakyMacro", "", func(emptyArgs) builder.Node {
		return &sneakyMixedReturnNode{
			unexportedMixedVersionHolder: unexportedMixedVersionHolder{BadV09: v09.NewText(v09.Str("mixed"))},
		}
	})
	sneakyExp, err := macros.NewMacroExpander([]*macros.Macro{sneaky}, &macros.ExpanderOptions{ProtocolVersion: core.Version1_0})
	if err != nil {
		t.Fatalf("NewMacroExpander(sneaky) failed: %v", err)
	}
	if _, err := sneakyExp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{"id": "r", "component": "SneakyMacro"}}),
	}); !errors.As(err, &valErr) {
		t.Fatalf("expected mixed version inside unexported anonymous struct to be rejected, got %v", err)
	}
}

func TestProgrammaticGoTypesAndRootEnvelopeNormalization(t *testing.T) {
	type customLabel string
	type customCount int
	type progArgs struct {
		Label      customLabel           `json:"label"`
		Count      customCount           `json:"count"`
		Extensions v1.Extensions         `json:"ext"`
		Event      v1.ActionEvent        `json:"event"`
		Tabs       []v1.TabItem          `json:"tabs"`
		Items      v1.ChildList          `json:"items"`
		Footer     *builder.ComponentRef `json:"footer"`
		Headers    map[string]string     `json:"headers"`
	}

	progMacro := macros.MustNewPureMacro("ProgMacro", "", func(a progArgs) *v1.Button {
		col := v1.NewColumn(v1.Children(
			v1.NewTabs(a.Tabs...),
			v1.NewList(a.Items),
			a.Footer,
		))
		return v1.NewButton(col, v1.Action{Event: &a.Event}).
			WithExtensions(a.Extensions).
			WithChecks(v1.NewCheckRule(v1.Bind("/internalOk"), "Internal check"))
	})

	exp, err := macros.NewMacroExpander([]*macros.Macro{progMacro}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	lowered, err := exp.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("s1", []map[string]any{{
			"id":        "root",
			"component": "ProgMacro",
			"label":     customLabel("go"),
			"count":     customCount(3),
			"ext":       v1.Extensions{"macroKey": "m1"},
			"event":     v1.ActionEvent{Name: "submit"},
			"tabs":      []v1.TabItem{v1.NewTabItem(v1.Str("Tab A"), builder.NewComponentRef("tab_a_child"))},
			"items":     v1.NewDynamicChildList("/rows", builder.NewComponentRef("row_tmpl")),
			"footer":    builder.NewComponentRef("footer_id"),
			"headers":   map[string]string{"x-env": "dev"},
			"@checks": []map[string]any{
				{"condition": map[string]any{"@path": "/externalOk"}, "message": "External check"},
			},
			"@metadata": map[string]any{
				"extensions": v1.Extensions{"instKey": "i1"},
			},
		}}),
	})
	if err != nil {
		t.Fatalf("ProgMacro TransformToTransport failed: %v", err)
	}

	comps := lowered[0]["updateComponents"].(map[string]any)["components"].([]any)
	root := comps[len(comps)-1].(map[string]any)
	wantChecks := []any{
		map[string]any{"condition": map[string]any{"@path": "/internalOk"}, "message": "Internal check"},
		map[string]any{"condition": map[string]any{"@path": "/externalOk"}, "message": "External check"},
	}
	if !reflect.DeepEqual(root["@checks"], wantChecks) {
		t.Fatalf("expected []map[string]any @checks concatenated onto root, got %#v", root["@checks"])
	}
	wantMeta := map[string]any{
		"extensions": map[string]any{
			"macroKey": "m1",
			"instKey":  "i1",
		},
	}
	if !reflect.DeepEqual(root["@metadata"], wantMeta) {
		t.Fatalf("expected v1.Extensions inside @metadata merged cleanly, got %#v", root["@metadata"])
	}
}

func TestExpanderDuplicateMacrosCatalogValidationSessionStagingAndVersionFallback(t *testing.T) {
	type labelArgs struct {
		Label string `json:"label"`
	}
	m1 := macros.MustNewPureMacro("DupBadge", "", func(a labelArgs) *v1.Text { return v1.NewText(v1.Str(a.Label)) })
	m2 := macros.MustNewPureMacro("DupBadge", "", func(a labelArgs) *v1.Text { return v1.NewText(v1.Str(a.Label)) })

	// 1. Duplicate macro names are rejected in NewMacroExpander.
	var valErr *core.ValidationError
	if _, err := macros.NewMacroExpander([]*macros.Macro{m1, m2}, nil); !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for duplicate macro names, got %v", err)
	}

	// 2. TransformCatalogs validates all catalogs (rejecting nil and conflicts) before mutating expander state.
	basicV1 := core.MustBasicCatalog(core.Version1_0)
	basicV09 := core.MustBasicCatalog(core.Version0_9)

	type neutralArgs struct {
		Child *builder.ComponentRef `json:"child"`
	}
	neutral := macros.MustNewPureMacro("NeutralWrap", "", func(a neutralArgs) builder.Node { return a.Child })
	neutralExp, err := macros.NewMacroExpander([]*macros.Macro{neutral}, nil)
	if err != nil {
		t.Fatalf("NewMacroExpander(neutral) failed: %v", err)
	}

	var catErr *core.CatalogError
	if _, err := neutralExp.TransformCatalogs([]*core.Catalog{basicV1, nil}); !errors.As(err, &catErr) {
		t.Fatalf("expected *core.CatalogError when TransformCatalogs contains nil, got %v", err)
	}
	// Because the batch failed before mutating neutralExp, neutralExp can still accept basicV09 cleanly!
	if _, err := neutralExp.TransformCatalogs([]*core.Catalog{basicV09}); err != nil {
		t.Fatalf("expected failed TransformCatalogs not to mutate expander version family, got %v", err)
	}

	// 3. TransportSession stages surface updates and rolls back if any message in the batch fails.
	exp, err := macros.NewMacroExpander([]*macros.Macro{m1}, &macros.ExpanderOptions{
		BaseCatalogs: []*core.Catalog{basicV1},
		OnError:      macros.OnErrorRaise,
	})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	session := exp.NewSession()
	session.TrackSurface("existing", basicV1.CatalogID())

	createNew, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: "uncommitted"})
	if err != nil {
		t.Fatalf("CreateSurface failed: %v", err)
	}
	// Batch deletes "existing", creates "uncommitted" (defaultless), then fails on missing required "label".
	failingBatch := []core.AgentToRendererMessage{
		v1.DeleteSurface("existing"),
		createNew,
		v1.UpdateComponents("uncommitted", []map[string]any{{
			"id":         "root",
			"component":  "DupBadge",
			"@catalogId": macros.DefaultMacroCatalogID,
		}}),
	}
	if _, err := session.TransformToTransport(failingBatch); !errors.As(err, &valErr) {
		t.Fatalf("expected failing batch to return *core.ValidationError, got %v", err)
	}

	// Verify "existing" was NOT deleted (so primitives inherit basicV1 without stamping @catalogId).
	afterFailExisting, err := session.TransformToTransport([]core.AgentToRendererMessage{
		v1.UpdateComponents("existing", []map[string]any{{
			"id":         "root",
			"component":  "DupBadge",
			"@catalogId": macros.DefaultMacroCatalogID,
			"label":      "StillTracked",
		}}),
	})
	if err != nil {
		t.Fatalf("post-failure TransformToTransport on 'existing' failed: %v", err)
	}
	if _, stamped := firstComponent(t, afterFailExisting)["@catalogId"]; stamped {
		t.Fatalf("expected 'existing' surface state to survive failed batch, got %#v", firstComponent(t, afterFailExisting))
	}

	// 4. Versionless message envelope falls back to snap.targetFamily == VersionFamily1_0.
	sessionDefaultless := exp.NewSession()
	sessionDefaultless.TrackSurface("vless", "")
	versionlessMsg := core.AgentToRendererMessage{
		"updateComponents": map[string]any{
			"surfaceId": "vless",
			"components": []any{map[string]any{
				"id":             "root",
				"component":      "DupBadge",
				"@catalogId":     macros.DefaultMacroCatalogID,
				"@accessibility": map[string]any{"label": "A11y"},
				"@metadata":      map[string]any{"extensions": map[string]any{"k": "v"}},
				"label":          "VersionlessOK",
			}},
		},
	}
	loweredVless, err := sessionDefaultless.TransformToTransport([]core.AgentToRendererMessage{versionlessMsg})
	if err != nil {
		t.Fatalf("versionless v1.0 TransformToTransport failed: %v", err)
	}
	gotVless := firstComponent(t, loweredVless)
	if gotVless["@catalogId"] != basicV1.CatalogID() {
		t.Fatalf("expected versionless v1.0 surface to stamp @catalogId, got %#v", gotVless)
	}
	if !reflect.DeepEqual(gotVless["@accessibility"], map[string]any{"label": "A11y"}) {
		t.Fatalf("expected @accessibility preserved on versionless v1.0 envelope, got %#v", gotVless)
	}
	if !reflect.DeepEqual(gotVless["@metadata"], map[string]any{"extensions": map[string]any{"k": "v"}}) {
		t.Fatalf("expected @metadata preserved on versionless v1.0 envelope, got %#v", gotVless)
	}
}
