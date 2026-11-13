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
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/a2ui-project/a2ui/go/core"
)

func TestSurfaceComponentsModelInvalidatesTopologyBoundOnComponentUpdateAndNestedFailure(t *testing.T) {
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	cfg := core.StrictValidation()
	cfg.AllowOrphanComponents = true
	proc, err := core.NewMessageProcessor([]*core.Catalog{basic}, &core.MessageProcessorOptions{
		ValidationConfig: &cfg,
	})
	if err != nil {
		t.Fatalf("NewMessageProcessor: %v", err)
	}

	// Build a valid chain of depth 49: c0 -> c1 -> ... -> c48 (Text).
	comps := make([]any, 49)
	for i := 0; i < 48; i++ {
		id := fmt.Sprintf("c%d", i)
		if i == 0 {
			id = "root"
		}
		comps[i] = map[string]any{
			"id":        id,
			"component": "Column",
			"children":  []any{fmt.Sprintf("c%d", i+1)},
		}
	}
	comps[48] = map[string]any{"id": "c48", "component": "Text", "text": "leaf"}

	if err := proc.ProcessMessages([]core.AgentToRendererMessage{
		{"version": "1.0", "createSurface": map[string]any{"surfaceId": "s1", "catalogId": basic.CatalogID()}},
		{"version": "1.0", "updateComponents": map[string]any{"surfaceId": "s1", "components": comps}},
	}, nil); err != nil {
		t.Fatalf("initial chain setup failed: %v", err)
	}

	// Next update fails nested function validation after ValidateComponentsUpdate ran:
	// the speculative bound must not stick when Upsert never executed.
	err = proc.ProcessMessages([]core.AgentToRendererMessage{
		{
			"version": "1.0",
			"updateComponents": map[string]any{
				"surfaceId": "s1",
				"components": []any{
					map[string]any{
						"id":        "c48",
						"component": "Text",
						"text":      map[string]any{"@call": "nonExistentFn", "args": map[string]any{}},
					},
				},
			},
		},
	}, nil)
	if err == nil {
		t.Fatal("expected nested function validation error, got nil")
	}

	// Mutate c47 directly via ComponentModel.ApplyUpdate to point to a deeper detached chain,
	// ensuring ApplyUpdate invalidates SurfaceComponentsModel's cached graph bound.
	surf := proc.Model.Surface("s1")
	for i := 49; i <= 52; i++ {
		var comp *core.ComponentModel
		if i < 52 {
			comp, _ = core.NewComponentModel(fmt.Sprintf("c%d", i), "Column", basic, map[string]any{
				"children": []any{fmt.Sprintf("c%d", i+1)},
			}, nil)
		} else {
			comp, _ = core.NewComponentModel(fmt.Sprintf("c%d", i), "Text", basic, map[string]any{"text": "deep"}, nil)
		}
		surf.ComponentsModel.Upsert(comp)
	}
	// Trigger bound caching at valid depth 49 first by updating leaf c48 cleanly.
	if err := proc.ProcessMessages([]core.AgentToRendererMessage{
		{
			"version": "1.0",
			"updateComponents": map[string]any{
				"surfaceId":  "s1",
				"components": []any{map[string]any{"id": "c48", "component": "Text", "text": "ok"}},
			},
		},
	}, nil); err != nil {
		t.Fatalf("valid leaf update failed: %v", err)
	}

	// Now connect c48 -> c49 via ComponentModel.ApplyUpdate directly (bypassing Upsert).
	// Total depth becomes 53 > MaxComponentGraphDepth (50).
	c48 := surf.ComponentsModel.Get("c48")
	c48.Type = "Column"
	if err := c48.ApplyUpdate(map[string]any{"children": []any{"c49"}}, nil); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	// Subsequent update touching c52 must recompute topology and reject depth > 50.
	err = proc.ProcessMessages([]core.AgentToRendererMessage{
		{
			"version": "1.0",
			"updateComponents": map[string]any{
				"surfaceId":  "s1",
				"components": []any{map[string]any{"id": "c52", "component": "Text", "text": "too deep"}},
			},
		},
	}, nil)
	if err == nil {
		t.Fatal("expected max depth error after ApplyUpdate invalidated cached bound, got nil")
	}
}

func TestCloneJSONValueAndNativeContainerNormalization(t *testing.T) {
	var nilAnySlice []any
	if got := core.CloneJSONValue(nilAnySlice); got != nil {
		t.Fatalf("CloneJSONValue(([]any)(nil)) = %#v, want nil", got)
	}
	emptyAnySlice := core.CloneJSONValue([]any{})
	if s, ok := emptyAnySlice.([]any); !ok || s == nil || len(s) != 0 {
		t.Fatalf("CloneJSONValue([]any{}) = %#v, want non-nil empty []any", emptyAnySlice)
	}

	var nilStrSlice []string
	if got := core.CloneJSONValue(nilStrSlice); got != nil {
		t.Fatalf("CloneJSONValue(([]string)(nil)) = %#v, want nil", got)
	}
	emptyStrSlice := core.CloneJSONValue([]string{})
	if s, ok := emptyStrSlice.([]any); !ok || s == nil || len(s) != 0 {
		t.Fatalf("CloneJSONValue([]string{}) = %#v, want non-nil empty []any", emptyStrSlice)
	}

	var nilMap map[string]int
	if got := core.CloneJSONValue(nilMap); got != nil {
		t.Fatalf("CloneJSONValue((map[string]int)(nil)) = %#v, want nil", got)
	}
	var nilPtr *int
	if got := core.CloneJSONValue(nilPtr); got != nil {
		t.Fatalf("CloneJSONValue((*int)(nil)) = %#v, want nil", got)
	}

	typedMap := map[string][]int{"nums": {1, 2, 3}}
	cloned := core.CloneJSONValue(typedMap)
	want := map[string]any{"nums": []any{1, 2, 3}}
	if !reflect.DeepEqual(cloned, want) {
		t.Fatalf("CloneJSONValue(typedMap) = %#v, want %#v", cloned, want)
	}

	// DataModel normalizes typed slices/maps and treats typed-nil values as key deletion.
	dm := core.NewDataModel(map[string]any{
		"tags":   []string{"go", "a2ui"},
		"counts": map[string]int{"open": 4},
	})
	if v, ok, err := dm.Get("/tags/1"); err != nil || !ok || v != "a2ui" {
		t.Fatalf("DataModel.Get(/tags/1) = (%v, %v, %v), want (\"a2ui\", true, nil)", v, ok, err)
	}
	if v, ok, err := dm.Get("/counts/open"); err != nil || !ok || v != 4 {
		t.Fatalf("DataModel.Get(/counts/open) = (%v, %v, %v), want (4, true, nil)", v, ok, err)
	}
	if err := dm.Set("/counts", (map[string]any)(nil)); err != nil {
		t.Fatalf("DataModel.Set typed-nil map: %v", err)
	}
	if _, ok, _ := dm.Get("/counts"); ok {
		t.Fatal("expected /counts to be deleted when set to typed-nil map")
	}
	if err := dm.Set("/tags", ([]string)(nil)); err != nil {
		t.Fatalf("DataModel.Set typed-nil slice: %v", err)
	}
	if _, ok, _ := dm.Get("/tags"); ok {
		t.Fatal("expected /tags to be deleted when set to typed-nil slice")
	}

	// MessageProcessor, NodeResolver, and GenericBinder accept native Go slices/maps.
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	cfg := core.StrictValidation()
	cfg.AllowOrphanComponents = true
	proc, err := core.NewMessageProcessor([]*core.Catalog{basic}, &core.MessageProcessorOptions{
		ValidationConfig: &cfg,
	})
	if err != nil {
		t.Fatalf("NewMessageProcessor: %v", err)
	}
	typedPayload := []core.AgentToRendererMessage{
		{
			"version": "1.0",
			"createSurface": map[string]any{
				"surfaceId": "s1",
				"catalogId": basic.CatalogID(),
			},
		},
		{
			"version": "1.0",
			"updateComponents": map[string]any{
				"surfaceId": "s1",
				"components": []map[string]any{
					{"id": "root", "component": "Column", "children": []string{"t1"}},
					{"id": "t1", "component": "Text", "text": map[string]any{"@path": "/items/0/label"}},
				},
			},
		},
	}
	if err := proc.ProcessPayload(typedPayload, nil); err != nil {
		t.Fatalf("ProcessPayload([]AgentToRendererMessage + []map[string]any + []string): %v", err)
	}
	singleMsg := core.AgentToRendererMessage{
		"version": "1.0",
		"updateDataModel": map[string]any{
			"surfaceId": "s1",
			"path":      "/items",
			"value":     []map[string]string{{"label": "Hello Native"}},
		},
	}
	if err := proc.ProcessPayload(singleMsg, nil); err != nil {
		t.Fatalf("ProcessPayload(single AgentToRendererMessage): %v", err)
	}

	surf := proc.Model.Surface("s1")
	resolver := core.NewNodeResolver(surf, nil)
	defer resolver.Dispose()
	rootNode := resolver.Root()
	if rootNode == nil {
		t.Fatal("expected non-nil resolved root node")
	}
	children, ok := rootNode.Props["children"].([]any)
	if !ok || len(children) != 1 {
		t.Fatalf("resolved children = %#v, want 1 child node", rootNode.Props["children"])
	}
	childNode, ok := children[0].(*core.ComponentNode)
	if !ok {
		t.Fatalf("children[0] = %T, want *core.ComponentNode", children[0])
	}
	textBinding, ok := childNode.Props["text"].(*core.ResolvedBinding)
	if !ok || textBinding.Value != "Hello Native" {
		t.Fatalf("child node text = %#v, want ResolvedBinding{Value: \"Hello Native\"}", childNode.Props["text"])
	}
}

func TestRPCHandlerConcurrentCatalogAccessAndListenerPanicCleanup(t *testing.T) {
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	rpc := core.NewRPCHandler([]*core.Catalog{basic}, nil)
	defer rpc.Dispose()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			derived, err := basic.Derive(core.DeriveOptions{
				CatalogID:  fmt.Sprintf("https://example.com/cat/%d", idx),
				Components: []any{"Text"},
				Functions:  []any{"formatString"},
			})
			if err == nil {
				rpc.AddCatalog(derived)
			}
		}(i)
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				_ = rpc.ResolveCatalog(basic.CatalogID())
				_, _ = rpc.HandleCallRendererFunction(core.CallRendererFunctionPayload{
					FunctionCallID: "c1",
					CallFunction: core.CallFunctionPayload{
						Call:      "formatString",
						CatalogID: basic.CatalogID(),
						Args:      map[string]any{"value": "hi"},
					},
				}, false, nil, false)
			}
		}()
	}
	wg.Wait()

	// Listener panic during CallAgentFunction must clean up pending map and timer before re-panicking.
	var outboundCalls atomic.Int32
	shouldPanic := true
	panicRPC := core.NewRPCHandler([]*core.Catalog{basic}, &core.RPCHandlerOptions{
		OutboundListener: func(map[string]any) {
			outboundCalls.Add(1)
			if shouldPanic {
				panic("simulated transport panic")
			}
		},
	})
	defer panicRPC.Dispose()

	didPanic := false
	timeout := 20 * time.Millisecond
	func() {
		defer func() {
			if r := recover(); r != nil {
				didPanic = true
			}
		}()
		_, _ = panicRPC.CallAgentFunction("s1", core.CallFunctionPayload{
			Call: "remoteFn",
			Args: map[string]any{"x": 1},
		}, &core.AgentCallOptions{
			FunctionCallID: "panic-call-1",
			Timeout:        &timeout,
		})
	}()
	if !didPanic {
		t.Fatal("expected CallAgentFunction to re-panic when outbound listener panics")
	}
	if got := panicRPC.PendingCount(); got != 0 {
		t.Fatalf("PendingCount() after listener panic = %d, want 0", got)
	}
	shouldPanic = false
	time.Sleep(40 * time.Millisecond)
	if got := panicRPC.PendingCount(); got != 0 {
		t.Fatalf("PendingCount() after timeout window = %d, want 0", got)
	}
}

func TestActionAndCallFunctionPayloadPreserveInt64Precision(t *testing.T) {
	const bigID int64 = 9007199254740993 // 2^53 + 1

	actionJSON := []byte(`{
		"version": "1.0",
		"action": {
			"name": "submitOrder",
			"surfaceId": "s1",
			"sourceComponentId": "btn",
			"timestamp": "2026-01-01T00:00:00Z",
			"context": {"orderId": 9007199254740993},
			"metadata": {"extensions": {"traceId": 9007199254740993}}
		}
	}`)
	var actionMsg core.RendererToAgentMessage
	if err := json.Unmarshal(actionJSON, &actionMsg); err != nil {
		t.Fatalf("Unmarshal action: %v", err)
	}
	if got, ok := actionMsg.Action.Context["orderId"].(int64); !ok || got != bigID {
		t.Fatalf("Action.Context[orderId] = (%T) %v, want int64(%d)", actionMsg.Action.Context["orderId"], actionMsg.Action.Context["orderId"], bigID)
	}
	ext, _ := actionMsg.Action.Metadata["extensions"].(map[string]any)
	if got, ok := ext["traceId"].(int64); !ok || got != bigID {
		t.Fatalf("Action.Metadata.extensions[traceId] = (%T) %v, want int64(%d)", ext["traceId"], ext["traceId"], bigID)
	}

	callJSON := []byte(`{
		"version": "1.0",
		"callAgentFunction": {
			"functionCallId": "call-1",
			"surfaceId": "s1",
			"callFunction": {
				"@call": "fetchOrder",
				"catalogId": "https://example.com/cat",
				"args": {"orderId": 9007199254740993}
			}
		}
	}`)
	var callMsg core.RendererToAgentMessage
	if err := json.Unmarshal(callJSON, &callMsg); err != nil {
		t.Fatalf("Unmarshal callAgentFunction: %v", err)
	}
	cf := callMsg.CallAgentFunction.CallFunction
	if got, ok := cf.Args["orderId"].(int64); !ok || got != bigID {
		t.Fatalf("CallFunction.Args[orderId] = (%T) %v, want int64(%d)", cf.Args["orderId"], cf.Args["orderId"], bigID)
	}
}

func TestCatalogDeepCloneIsolationSetEvaluatorConcurrencyAndDeriveAgentFunctions(t *testing.T) {
	cat1, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}

	// Mutating maps/slices returned by Catalog accessors must not mutate the catalog.
	comps := cat1.Components()
	comps["Text"].Schema["mutated"] = true
	if _, leaked := cat1.Components()["Text"].Schema["mutated"]; leaked {
		t.Fatal("mutating Components() schema leaked into Catalog")
	}

	fns := cat1.Functions()
	fns["formatString"].Schema["mutated"] = true
	if _, leaked := cat1.Functions()["formatString"].Schema["mutated"]; leaked {
		t.Fatal("mutating Functions() schema leaked into Catalog")
	}

	rfns := cat1.RendererFunctions()
	rfns["formatString"].Schema["mutated"] = true
	if _, leaked := cat1.RendererFunctions()["formatString"].Schema["mutated"]; leaked {
		t.Fatal("mutating RendererFunctions() schema leaked into Catalog")
	}

	refs := cat1.ComponentRefMap()
	colRef := refs["Column"]
	if len(colRef.ListRefs) > 0 {
		colRef.ListRefs[0] = "MUTATED"
	}
	if cat1.ComponentRefMap()["Column"].ListRefs[0] == "MUTATED" {
		t.Fatal("mutating ComponentRefMap() slice leaked into Catalog")
	}

	// Concurrent SetFunctionEvaluator + validation + resolution must be race-free.
	surf := core.NewSurfaceModel("s1", cat1.CatalogID(), cat1)
	dctx := core.NewDataContext(surf, "/")
	validator := core.NewPayloadValidator(cat1, nil)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				cat1.SetFunctionEvaluator("email", func(args map[string]any, _ *core.DataContext) (any, error) {
					return map[string]any{"valid": true}, nil
				})
			}
		}()
	}
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				_, _ = validator.ValidateFunctionArgs("email", map[string]any{"value": "user@example.com"})
				_, _ = dctx.ResolveDynamicValue(map[string]any{
					"@call": "email",
					"args":  map[string]any{"value": "user@example.com"},
				})
			}
		}()
	}
	wg.Wait()

	// Derive validates AgentFunctions and hoists local ArgsSchema.$defs.
	v09Cat, err := core.BasicCatalog(core.Version0_9)
	if err != nil {
		t.Fatalf("BasicCatalog(v0.9): %v", err)
	}
	if _, err := v09Cat.Derive(core.DeriveOptions{
		CatalogID: "https://example.com/v09-derived",
		Functions: []any{&core.AgentFunction{Name: "lookup"}},
	}); err == nil {
		t.Fatal("expected Derive with AgentFunction on v0.9 catalog to fail")
	}

	if _, err := cat1.Derive(core.DeriveOptions{
		CatalogID: "https://example.com/bad-fn-name",
		Functions: []any{core.AgentFunction{Name: "9invalid"}},
	}); err == nil {
		t.Fatal("expected Derive with invalid UAX #31 AgentFunction name to fail")
	}

	if _, err := cat1.Derive(core.DeriveOptions{
		CatalogID: "https://example.com/bad-param-in-def",
		Functions: []any{
			core.AgentFunction{
				Name: "lookupUser",
				ArgsSchema: map[string]any{
					"$defs": map[string]any{
						"FilterSpec": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"bad-key": map[string]any{"type": "string"},
							},
						},
					},
					"$ref": "#/$defs/FilterSpec",
				},
			},
		},
	}); err == nil {
		t.Fatal("expected Derive to reject invalid UAX #31 parameter name inside hoisted $defs")
	}

	derived, err := cat1.Derive(core.DeriveOptions{
		CatalogID:  "https://example.com/derived-v1",
		Components: []any{"Text"},
		Functions: []any{
			"formatString",
			core.AgentFunction{
				Name:       "lookupUser",
				ReturnType: core.ReturnTypeObject,
				ArgsSchema: map[string]any{
					"$defs": map[string]any{
						"FilterSpec": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"userId": map[string]any{"type": "string"},
							},
							"required": []any{"userId"},
						},
					},
					"$ref": "#/$defs/FilterSpec",
				},
				Handler: func(_ context.Context, args map[string]any, _ core.AgentFunctionContext) (any, error) {
					return args, nil
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Derive valid AgentFunction with $defs: %v", err)
	}
	doc := derived.ToJSON()
	defs, _ := doc["$defs"].(map[string]any)
	if _, ok := defs["FilterSpec"]; !ok {
		t.Fatalf("expected FilterSpec to be hoisted to derived catalog $defs, got %#v", defs)
	}
	afMap := derived.AgentFunctions()
	if _, hoisted := afMap["lookupUser"].ArgsSchema["$defs"]; hoisted {
		t.Fatal("expected $defs to be stripped from hoisted AgentFunction.ArgsSchema")
	}
	// Mutating AgentFunctions() return value must not mutate derived catalog.
	afMap["lookupUser"].ArgsSchema["mutated"] = true
	if _, leaked := derived.AgentFunctions()["lookupUser"].ArgsSchema["mutated"]; leaked {
		t.Fatal("mutating AgentFunctions() leaked into derived Catalog")
	}
}

func TestBasicCatalogLengthUnicodeAndNarrowIntAndJSONNumberSupport(t *testing.T) {
	cat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	surf := core.NewSurfaceModel("s1", cat.CatalogID(), cat)
	dctx := core.NewDataContext(surf, "/")

	// "🎉" is 1 Unicode code point (4 UTF-8 bytes); max=1 must pass and min=2 must fail.
	res1, err := dctx.ResolveDynamicValue(map[string]any{
		"@call": "length",
		"args":  map[string]any{"value": "🎉", "min": int8(1), "max": uint8(1)},
	})
	if err != nil {
		t.Fatalf("length(🎉, 1..1): %v", err)
	}
	if m, _ := res1.(map[string]any); m["valid"] != true {
		t.Fatalf("length(🎉, 1..1) = %#v, want valid=true", res1)
	}

	res2, err := dctx.ResolveDynamicValue(map[string]any{
		"@call": "length",
		"args":  map[string]any{"value": "🎉", "min": uint16(2)},
	})
	if err != nil {
		t.Fatalf("length(🎉, min=2): %v", err)
	}
	if m, _ := res2.(map[string]any); m["valid"] != false {
		t.Fatalf("length(🎉, min=2) = %#v, want valid=false", res2)
	}

	// Narrow integers and json.Number in formatString and numeric.
	_ = surf.DataModel.Set("/i8", int8(-7))
	_ = surf.DataModel.Set("/u16", uint16(512))
	_ = surf.DataModel.Set("/u32", uint32(100000))
	_ = surf.DataModel.Set("/jnum", json.Number("9007199254740993"))
	formatted, err := dctx.ResolveDynamicValue(map[string]any{
		"@call": "formatString",
		"args":  map[string]any{"value": "${/i8}|${/u16}|${/u32}|${/jnum}"},
	})
	if err != nil {
		t.Fatalf("formatString narrow ints & json.Number: %v", err)
	}
	if formatted != "-7|512|100000|9007199254740993" {
		t.Fatalf("formatString got %q, want %q", formatted, "-7|512|100000|9007199254740993")
	}

	numValid, err := dctx.ResolveDynamicValue(map[string]any{
		"@call": "numeric",
		"args":  map[string]any{"value": json.Number("42.5"), "min": int16(10), "max": uint32(50)},
	})
	if err != nil {
		t.Fatalf("numeric(json.Number): %v", err)
	}
	if m, _ := numValid.(map[string]any); m["valid"] != true {
		t.Fatalf("numeric(42.5) = %#v, want valid=true", numValid)
	}

	numFn := cat.Functions()["numeric"]
	numNaN, err := numFn.Evaluate(map[string]any{"value": json.Number("NaN")}, dctx)
	if err != nil {
		t.Fatalf("numeric.Evaluate(NaN): %v", err)
	}
	if m, _ := numNaN.(map[string]any); m["valid"] != false {
		t.Fatalf("numeric(json.Number(NaN)) = %#v, want valid=false", numNaN)
	}

	// Schema validator accepts narrow Go integers and finite json.Number, and rejects non-finite json.Number.
	pv := core.NewPayloadValidator(cat, nil)
	if _, err := pv.ValidateFunctionArgs("numeric", map[string]any{
		"value": int8(5),
		"min":   uint16(1),
		"max":   json.Number("10"),
	}); err != nil {
		t.Fatalf("ValidateFunctionArgs narrow ints + finite json.Number failed: %v", err)
	}
	if _, err := pv.ValidateFunctionArgs("numeric", map[string]any{
		"value": json.Number("NaN"),
	}); err == nil {
		t.Fatal("expected ValidateFunctionArgs to reject json.Number(\"NaN\")")
	}
}

func TestWatcherUnsubscribeAndDisposeDuringNotificationCascade(t *testing.T) {
	// 1. DataModel.Watch: listener 1 unsubscribes listener 2 mid-cascade.
	dm := core.NewDataModel(map[string]any{"x": 1})
	var unsub2 func()
	called2 := false
	_, _ = dm.Watch("/x", func(any) {
		if unsub2 != nil {
			unsub2()
		}
	})
	unsub2, _ = dm.Watch("/x", func(any) {
		called2 = true
	})
	if err := dm.Set("/x", 2); err != nil {
		t.Fatalf("dm.Set: %v", err)
	}
	if called2 {
		t.Fatal("DataModel watcher 2 was invoked after being unsubscribed during cascade")
	}

	// 2. ComponentModel & SurfaceComponentsModel: listener 1 unsubscribes listener 2 mid-cascade.
	cat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	surf := core.NewSurfaceModel("s1", cat.CatalogID(), cat)
	var unsubCreated2 func()
	createdCalled2 := false
	_ = surf.ComponentsModel.SubscribeCreated(func(*core.ComponentModel) {
		if unsubCreated2 != nil {
			unsubCreated2()
		}
	})
	unsubCreated2 = surf.ComponentsModel.SubscribeCreated(func(*core.ComponentModel) {
		createdCalled2 = true
	})
	comp, _ := core.NewComponentModel("root", "Text", cat, map[string]any{"text": "v1"}, nil)
	surf.ComponentsModel.Upsert(comp)
	if createdCalled2 {
		t.Fatal("SurfaceComponentsModel subscriber 2 invoked after unsubscribe during cascade")
	}

	var unsubComp2 func()
	compCalled2 := false
	_ = comp.SubscribeUpdated(func(*core.ComponentModel) {
		if unsubComp2 != nil {
			unsubComp2()
		}
	})
	unsubComp2 = comp.SubscribeUpdated(func(*core.ComponentModel) {
		compCalled2 = true
	})
	_ = comp.ApplyUpdate(map[string]any{"text": "v2"}, nil)
	if compCalled2 {
		t.Fatal("ComponentModel subscriber 2 invoked after unsubscribe during cascade")
	}

	// 3. GenericBinder & ComponentNode: listener 1 unsubscribes listener 2 mid-cascade.
	_ = surf.DataModel.Set("/msg", "initial")
	_ = comp.ApplyUpdate(map[string]any{"text": map[string]any{"@path": "/msg"}}, nil)
	compCtx, err := core.NewComponentContext(surf, "root", "/")
	if err != nil {
		t.Fatalf("NewComponentContext: %v", err)
	}
	binder := core.NewGenericBinder(compCtx, false)
	defer binder.Dispose()
	var unsubBinder2 func()
	binderCalled2 := false
	_ = binder.Subscribe(func(map[string]any) {
		if unsubBinder2 != nil {
			unsubBinder2()
		}
	})
	unsubBinder2 = binder.Subscribe(func(map[string]any) {
		binderCalled2 = true
	})
	binderCalled2 = false
	_ = surf.DataModel.Set("/msg", "updated")
	if binderCalled2 {
		t.Fatal("GenericBinder subscriber 2 invoked after unsubscribe during cascade")
	}

	resolver := core.NewNodeResolver(surf, nil)
	defer resolver.Dispose()
	rootNode := resolver.Root()
	var unsubNode2 func()
	nodeCalled2 := false
	_ = rootNode.SubscribeUpdated(func(map[string]any) {
		if unsubNode2 != nil {
			unsubNode2()
		}
	})
	unsubNode2 = rootNode.SubscribeUpdated(func(map[string]any) {
		nodeCalled2 = true
	})
	_ = surf.DataModel.Set("/msg", "updated-again")
	if nodeCalled2 {
		t.Fatal("ComponentNode subscriber 2 invoked after unsubscribe during cascade")
	}
}
