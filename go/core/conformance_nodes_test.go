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
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/a2ui-project/a2ui/go/core"
)

// Node resolution conformance runner (port of node_resolution_runner.py)

type nodeWatchState struct {
	path              string
	emissions         int
	metadataEmissions int
	destroyed         int
	lastProps         any
	lastMetadata      map[string]any
	stop              func()
}

func normalizeNodePropValue(val any, path string) any {
	switch typed := val.(type) {
	case *core.ComponentNode:
		if typed == nil {
			return nil
		}
		return map[string]any{"node": path}
	case *core.ResolvedBinding:
		if typed == nil {
			return nil
		}
		return map[string]any{
			"value":    normalizeNodePropValue(typed.Value, path),
			"writable": typed.Writable,
		}
	case *core.ResolvedAction:
		if typed == nil {
			return nil
		}
		return map[string]any{"action": true}
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = normalizeNodePropValue(item, fmt.Sprintf("%s/%d", path, i))
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(typed))
		for k, v := range typed {
			out[k] = normalizeNodePropValue(v, fmt.Sprintf("%s/%s", path, k))
		}
		return out
	default:
		return val
	}
}

func collectMountedNodes(t *testing.T, reason string, resolver *core.NodeResolver) map[string]*core.ComponentNode {
	t.Helper()
	nodes := map[string]*core.ComponentNode{}
	if resolver == nil || resolver.Root() == nil {
		return nodes
	}
	seen := map[*core.ComponentNode]bool{}
	var visit func(node *core.ComponentNode, path string)
	visit = func(node *core.ComponentNode, path string) {
		if seen[node] {
			t.Fatalf("%s: %s: duplicate ComponentNode pointer in mounted tree", reason, path)
		}
		if node.Disposed() {
			t.Fatalf("%s: %s: mounted ComponentNode is disposed", reason, path)
		}
		seen[node] = true
		nodes[path] = node
		siblingIDs := map[string]bool{}
		var walkChildren func(val any, childPath string)
		walkChildren = func(val any, childPath string) {
			switch v := val.(type) {
			case *core.ComponentNode:
				if v == nil {
					return
				}
				if siblingIDs[v.InstanceID] {
					t.Fatalf("%s: %s: duplicate sibling instance_id %q", reason, childPath, v.InstanceID)
				}
				siblingIDs[v.InstanceID] = true
				visit(v, childPath)
			case []any:
				for i, item := range v {
					walkChildren(item, fmt.Sprintf("%s/%d", childPath, i))
				}
			case map[string]any:
				var keys []string
				for k := range v {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					walkChildren(v[k], fmt.Sprintf("%s/%s", childPath, k))
				}
			}
		}
		walkChildren(node.Props, path)
	}
	visit(resolver.Root(), "root")
	return nodes
}

func updateFixtureComponents(t *testing.T, reason string, surf *core.SurfaceModel, cat *core.Catalog, comps []any) {
	t.Helper()
	for _, rc := range comps {
		comp, _ := rc.(map[string]any)
		compID, _ := comp["id"].(string)
		compType, _ := comp["component"].(string)
		var meta map[string]any
		if m, ok := comp["metadata"].(map[string]any); ok {
			meta, _ = core.CloneJSONValue(m).(map[string]any)
		}
		props := map[string]any{}
		for k, v := range comp {
			if k != "id" && k != "component" && k != "metadata" {
				props[k] = core.CloneJSONValue(v)
			}
		}
		if existing := surf.ComponentsModel.Get(compID); existing != nil {
			if existing.Type != compType {
				t.Fatalf("%s: update_components cannot change %s's type", reason, compID)
			}
			existing.ApplyUpdate(props, meta)
		} else {
			cm, err := core.NewComponentModel(compID, compType, cat, props, meta)
			if err != nil {
				t.Fatalf("%s: NewComponentModel(%s): %v", reason, compID, err)
			}
			surf.ComponentsModel.Upsert(cm)
		}
	}
}

func validateResolveNodesCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, nodeResolutionCaseKeys, "case key", caseKey)
	confRoot := conformanceRoot(t)
	fixtureRel, _ := caseMap["fixture"].(string)
	fixBytes, err := os.ReadFile(filepath.Join(confRoot, filepath.FromSlash(fixtureRel)))
	if err != nil {
		t.Fatalf("%s: read fixture %s: %v", caseKey, fixtureRel, err)
	}
	rawFix, _, err := decodeYAMLBytesWithKeyOrder(fixBytes)
	if err != nil {
		t.Fatalf("%s: parse fixture %s: %v", caseKey, fixtureRel, err)
	}
	fixture, _ := rawFix.(map[string]any)
	assertKnownKeys(t, fixture, nodeFixtureKeys, "fixture key", caseKey)

	var functionsLog []any
	var eventsLog []any
	var errorsLog []map[string]any

	catRel, _ := fixture["catalog"].(string)
	catBytes, err := os.ReadFile(filepath.Join(confRoot, filepath.FromSlash(catRel)))
	if err != nil {
		t.Fatalf("%s: read fixture catalog %s: %v", caseKey, catRel, err)
	}
	catalog, err := core.CatalogFromJSONBytes(catBytes, nil)
	if err != nil {
		t.Fatalf("%s: CatalogFromJSONBytes: %v", caseKey, err)
	}
	for _, fnName := range catalog.FunctionNames() {
		nameCopy := fnName
		catalog.SetFunctionEvaluator(nameCopy, func(args map[string]any, _ *core.DataContext) (any, error) {
			functionsLog = append(functionsLog, map[string]any{
				"name": nameCopy,
				"args": normalizeNodePropValue(args, ""),
			})
			return nil, nil
		})
	}

	proc, err := core.NewMessageProcessor([]*core.Catalog{catalog}, nil)
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}

	watches := map[*core.ComponentNode]*nodeWatchState{}
	createdEmissions := map[*core.ComponentNode]int{}
	var createdStops []func()

	var surface *core.SurfaceModel
	var resolver *core.NodeResolver
	var cleanups []func()

	var watchCreatedNodes func()
	watchCreatedNodes = func() {
		if resolver == nil {
			return
		}
		for _, node := range collectMountedNodes(t, caseKey, resolver) {
			if _, exists := createdEmissions[node]; exists {
				continue
			}
			createdEmissions[node] = 0
			nCopy := node
			stop := nCopy.SubscribeUpdated(func(_ map[string]any) {
				createdEmissions[nCopy] = createdEmissions[nCopy] + 1
				watchCreatedNodes()
			})
			createdStops = append(createdStops, stop)
		}
	}

	attachSurface := func(s *core.SurfaceModel) {
		if s.ID != "s" || resolver != nil {
			return
		}
		surface = s
		resolver = core.NewNodeResolver(s, catalog)
		stopRoot := resolver.SubscribeRootReplaced(func(_ *core.ComponentNode) {
			watchCreatedNodes()
		})
		cleanups = append(cleanups, stopRoot)
		s.OnAction = append(s.OnAction, func(action map[string]any) {
			ctxVal := action["context"]
			if ctxVal == nil {
				ctxVal = map[string]any{}
			}
			entry := map[string]any{
				"name":                action["name"],
				"source_component_id": action["sourceComponentId"],
				"context":             normalizeNodePropValue(ctxVal, ""),
			}
			if m, hasM := action["metadata"]; hasM && m != nil {
				entry["metadata"] = core.CloneJSONValue(m)
			}
			eventsLog = append(eventsLog, entry)
		})
		s.OnError = append(s.OnError, func(errObj map[string]any) {
			cp, _ := core.CloneJSONValue(errObj).(map[string]any)
			errorsLog = append(errorsLog, cp)
		})
	}
	proc.Model.OnSurfaceCreated = append(proc.Model.OnSurfaceCreated, attachSurface)

	defer func() {
		for _, stop := range createdStops {
			stop()
		}
		if resolver != nil {
			resolver.Dispose()
		}
		if surface != nil {
			surface.Dispose()
		}
		for _, w := range watches {
			if w.stop != nil {
				w.stop()
			}
		}
		for _, cb := range cleanups {
			cb()
		}
	}()

	if fixture["surface"] != false {
		seeded := core.NewSurfaceModel("s", catalog.CatalogID(), catalog)
		seeded.AvailableCatalogs = map[string]*core.Catalog{catalog.CatalogID(): catalog}
		seeded.ProtocolVersion = catalog.ProtocolVersion()
		dataInit := fixture["data"]
		if dataInit == nil {
			dataInit = map[string]any{}
		}
		if err := seeded.DataModel.Set("/", dataInit); err != nil {
			t.Fatalf("%s: seed DataModel: %v", caseKey, err)
		}
		compsInit, _ := fixture["components"].([]any)
		updateFixtureComponents(t, caseKey+" fixture", seeded, catalog, compsInit)
		proc.Model.AddSurface(seeded)
	}

	checkStepState := func(expected map[string]any, before map[string]*core.ComponentNode, reason string) {
		assertKnownKeys(t, expected, nodeExpectKeys, "expect key", reason)
		after := collectMountedNodes(t, reason, resolver)

		// 1. Check nodes
		expNodes, _ := expected["nodes"].(map[string]any)
		var gotPaths, wantPaths []string
		for p := range after {
			gotPaths = append(gotPaths, p)
		}
		for p := range expNodes {
			wantPaths = append(wantPaths, p)
		}
		sort.Strings(gotPaths)
		sort.Strings(wantPaths)
		if !jsonValuesEqual(gotPaths, wantPaths) {
			t.Fatalf("%s: node paths got %v, want %v", reason, gotPaths, wantPaths)
		}
		for path, rawFields := range expNodes {
			fields, _ := rawFields.(map[string]any)
			assertKnownKeys(t, fields, nodeFieldKeys, fmt.Sprintf("node '%s' key", path), reason)
			node := after[path]
			valErrors := make([]any, len(node.ValidationErrors))
			for i, s := range node.ValidationErrors {
				valErrors[i] = s
			}
			valResults := make([]any, len(node.ValidationResults))
			for i, r := range node.ValidationResults {
				valResults[i] = r
			}
			var metaVal any
			if m := node.Metadata(); m != nil {
				metaVal = m
			}
			actualFields := map[string]any{
				"component_id":      node.ComponentID,
				"type":              node.Type,
				"state":             string(node.State),
				"data_path":         node.DataPath,
				"metadata":          metaVal,
				"isValid":           node.IsValid,
				"validationErrors":  valErrors,
				"validationResults": valResults,
			}
			for _, k := range []string{"component_id", "type", "state", "data_path", "metadata", "isValid", "validationErrors", "validationResults"} {
				if expF, hasF := fields[k]; hasF {
					if !jsonValuesEqual(actualFields[k], expF) {
						t.Fatalf("%s: %s.%s got %v, want %v", reason, path, k, actualFields[k], expF)
					}
				}
			}
			if expProps, ok := fields["props"].(map[string]any); ok {
				for pk, pv := range expProps {
					rawActual, present := node.Props[pk]
					if !present {
						t.Fatalf("%s: %s.%s is absent from node.Props (%v)", reason, path, pk, node.Props)
					}
					normActual := normalizeNodePropValue(rawActual, fmt.Sprintf("%s/%s", path, pk))
					if !jsonValuesEqual(normActual, pv) {
						t.Fatalf("%s: %s.%s got %#v, want %#v", reason, path, pk, normActual, pv)
					}
				}
			}
		}

		// 2. Collect watch counts
		beforeSet := map[*core.ComponentNode]bool{}
		for _, n := range before {
			beforeSet[n] = true
		}
		surviving := map[*core.ComponentNode]bool{}
		for _, n := range after {
			surviving[n] = true
		}
		emissions := map[string]any{}
		metaEmissions := map[string]any{}
		destroyed := map[string]any{}
		for node, w := range watches {
			if w.emissions > 0 && surviving[node] {
				prev, _ := emissions[w.path].(int)
				emissions[w.path] = prev + w.emissions
				if !jsonValuesEqual(w.lastProps, normalizeNodePropValue(node.Props, w.path)) {
					t.Fatalf("%s: %s last emission props snapshot differs from current Props", reason, w.path)
				}
			}
			if w.metadataEmissions > 0 && surviving[node] {
				prev, _ := metaEmissions[w.path].(int)
				metaEmissions[w.path] = prev + w.metadataEmissions
				var curMeta any
				if m := node.Metadata(); m != nil {
					curMeta = m
				}
				var lastMeta any
				if w.lastMetadata != nil {
					lastMeta = w.lastMetadata
				}
				if !jsonValuesEqual(lastMeta, curMeta) {
					t.Fatalf("%s: %s last metadata emission differs from current Metadata", reason, w.path)
				}
			}
			if w.destroyed > 0 {
				prev, _ := destroyed[w.path].(int)
				destroyed[w.path] = prev + w.destroyed
				if !node.Disposed() {
					t.Fatalf("%s: %s emitted destroyed without being disposed", reason, w.path)
				}
			}
		}

		expEm, _ := expected["emissions"].(map[string]any)
		if expEm == nil {
			expEm = map[string]any{}
		}
		if !jsonValuesEqual(emissions, expEm) {
			t.Fatalf("%s: emissions got %v, want %v", reason, emissions, expEm)
		}
		if rawCreated, hasCreated := expected["created_emissions"]; hasCreated {
			expCreated, _ := rawCreated.(map[string]any)
			if expCreated == nil {
				expCreated = map[string]any{}
			}
			actualCreated := map[string]any{}
			for p, node := range after {
				if !beforeSet[node] {
					actualCreated[p] = createdEmissions[node]
				}
			}
			if !jsonValuesEqual(actualCreated, expCreated) {
				t.Fatalf("%s: created_emissions got %v, want %v", reason, actualCreated, expCreated)
			}
		}
		if rawMetaEm, hasMetaEm := expected["metadata_emissions"]; hasMetaEm {
			expMetaEm, _ := rawMetaEm.(map[string]any)
			if expMetaEm == nil {
				expMetaEm = map[string]any{}
			}
			if !jsonValuesEqual(metaEmissions, expMetaEm) {
				t.Fatalf("%s: metadata_emissions got %v, want %v", reason, metaEmissions, expMetaEm)
			}
		}
		expDest, _ := expected["destroyed"].(map[string]any)
		if expDest == nil {
			expDest = map[string]any{}
		}
		if !jsonValuesEqual(destroyed, expDest) {
			t.Fatalf("%s: destroyed got %v, want %v", reason, destroyed, expDest)
		}

		// 3. Node identity
		if sameList, ok := expected["same_nodes"].([]any); ok {
			for _, rp := range sameList {
				p, _ := rp.(string)
				if after[p] == nil || before[p] == nil || after[p] != before[p] {
					t.Fatalf("%s: expected same node pointer at %q", reason, p)
				}
			}
		}
		if repList, ok := expected["replaced_nodes"].([]any); ok {
			for _, rp := range repList {
				p, _ := rp.(string)
				if after[p] == nil || before[p] == nil || after[p] == before[p] {
					t.Fatalf("%s: expected replaced node pointer at %q", reason, p)
				}
			}
		}

		// 4. Data, events, functions, errors
		if expData, ok := expected["data"].(map[string]any); ok {
			for p, wantVal := range expData {
				gotVal, _, _ := surface.DataModel.Get(p)
				if !jsonValuesEqual(normalizeNodePropValue(gotVal, p), wantVal) {
					t.Fatalf("%s: data[%s] got %v, want %v", reason, p, gotVal, wantVal)
				}
			}
		}
		expEvents, _ := expected["events"].([]any)
		if expEvents == nil {
			expEvents = []any{}
		}
		gotEvents := eventsLog
		if gotEvents == nil {
			gotEvents = []any{}
		}
		if !jsonValuesEqual(gotEvents, expEvents) {
			t.Fatalf("%s: events got %v, want %v", reason, gotEvents, expEvents)
		}
		expFuncs, _ := expected["functions"].([]any)
		if expFuncs == nil {
			expFuncs = []any{}
		}
		gotFuncs := functionsLog
		if gotFuncs == nil {
			gotFuncs = []any{}
		}
		if !jsonValuesEqual(gotFuncs, expFuncs) {
			t.Fatalf("%s: functions got %v, want %v", reason, gotFuncs, expFuncs)
		}
		if rawErrs, hasErrs := expected["errors"]; hasErrs {
			expErrs, _ := rawErrs.([]any)
			if len(errorsLog) != len(expErrs) {
				t.Fatalf("%s: errors count got %d (%v), want %d (%v)", reason, len(errorsLog), errorsLog, len(expErrs), expErrs)
			}
			for i, re := range expErrs {
				ee, _ := re.(map[string]any)
				ae := errorsLog[i]
				for k, v := range ee {
					if !jsonValuesEqual(ae[k], v) {
						t.Fatalf("%s: error[%d].%s got %v, want %v", reason, i, k, ae[k], v)
					}
				}
			}
		}
	}

	initExpect, _ := caseMap["expect"].(map[string]any)
	checkStepState(initExpect, map[string]*core.ComponentNode{}, caseKey+" initial")

	type savedBinding struct {
		binding *core.ResolvedBinding
		val     any
	}
	saveBindings := func(nodes map[string]*core.ComponentNode) []savedBinding {
		var out []savedBinding
		var visit func(v any)
		visit = func(v any) {
			switch typed := v.(type) {
			case *core.ResolvedBinding:
				if typed != nil {
					out = append(out, savedBinding{binding: typed, val: normalizeNodePropValue(typed.Value, "")})
				}
			case []any:
				for _, item := range typed {
					visit(item)
				}
			case map[string]any:
				for _, item := range typed {
					visit(item)
				}
			}
		}
		for _, n := range nodes {
			visit(n.Props)
		}
		return out
	}

	rawSteps, _ := caseMap["steps"].([]any)
	for idx, rs := range rawSteps {
		step, _ := rs.(map[string]any)
		op, _ := step["op"].(string)
		reason := fmt.Sprintf("%s step %d (%s)", caseKey, idx, op)
		allowed := nodeStepKeysByOp[op]
		if allowed == nil {
			t.Fatalf("%s: unknown node op %q", reason, op)
		}
		assertKnownKeys(t, step, allowed, fmt.Sprintf("step (%s) key", op), reason)

		before := collectMountedNodes(t, reason, resolver)
		for p, node := range before {
			if existing, ok := watches[node]; ok {
				existing.path = p
				continue
			}
			w := &nodeWatchState{path: p}
			sProps := node.SubscribeUpdated(func(props map[string]any) {
				w.emissions++
				w.lastProps = normalizeNodePropValue(props, w.path)
				watchCreatedNodes()
			})
			sMeta := node.SubscribeMetadataChanged(func(meta map[string]any) {
				w.metadataEmissions++
				if meta != nil {
					w.lastMetadata, _ = core.CloneJSONValue(meta).(map[string]any)
				} else {
					w.lastMetadata = nil
				}
			})
			sDest := node.SubscribeDestroyed(func() {
				w.destroyed++
			})
			w.stop = func() {
				sProps()
				sMeta()
				sDest()
			}
			watches[node] = w
		}
		for _, w := range watches {
			w.emissions = 0
			w.metadataEmissions = 0
			w.destroyed = 0
			w.lastProps = nil
			w.lastMetadata = nil
		}
		for _, stop := range createdStops {
			stop()
		}
		createdStops = nil
		createdEmissions = map[*core.ComponentNode]int{}
		eventsLog = nil
		functionsLog = nil
		errorsLog = nil
		priorBindings := saveBindings(before)

		switch op {
		case "set_data":
			p, _ := step["path"].(string)
			if err := surface.DataModel.Set(p, step["value"]); err != nil {
				t.Fatalf("%s: DataModel.Set(%s): %v", reason, p, err)
			}
		case "update_components":
			comps, _ := step["components"].([]any)
			updateFixtureComponents(t, reason, surface, catalog, comps)
		case "remove_component":
			cid, _ := step["component_id"].(string)
			surface.ComponentsModel.Remove(cid)
		case "process_messages":
			if err := proc.ProcessPayload(step["messages"], nil); err != nil {
				t.Fatalf("%s: ProcessPayload: %v", reason, err)
			}
		case "write":
			nodePath, _ := step["node"].(string)
			propName, _ := step["property"].(string)
			n := before[nodePath]
			if n == nil {
				t.Fatalf("%s: no node at %q", reason, nodePath)
			}
			rb, ok := n.Props[propName].(*core.ResolvedBinding)
			if !ok || rb == nil || !rb.Writable {
				t.Fatalf("%s: %s.%s is not a writable binding", reason, nodePath, propName)
			}
			if err := rb.Set(step["value"]); err != nil {
				t.Fatalf("%s: ResolvedBinding.Set: %v", reason, err)
			}
		case "invoke":
			nodePath, _ := step["node"].(string)
			propName, _ := step["property"].(string)
			n := before[nodePath]
			if n == nil {
				t.Fatalf("%s: no node at %q", reason, nodePath)
			}
			act, ok := n.Props[propName].(*core.ResolvedAction)
			if !ok || act == nil || act.Invoke == nil {
				t.Fatalf("%s: %s.%s is not a ResolvedAction", reason, nodePath, propName)
			}
			var rawMeta map[string]any
			if m, hasM := step["metadata"].(map[string]any); hasM {
				rawMeta, _ = core.CloneJSONValue(m).(map[string]any)
			}
			if _, err := act.Invoke(rawMeta); err != nil {
				t.Fatalf("%s: ResolvedAction.Invoke: %v", reason, err)
			}
		case "dispose":
			resolver.Dispose()
		}

		stepExp, _ := step["expect"].(map[string]any)
		checkStepState(stepExp, before, reason)
		for _, sb := range priorBindings {
			if !jsonValuesEqual(normalizeNodePropValue(sb.binding.Value, ""), sb.val) {
				t.Fatalf("%s: prior ResolvedBinding snapshot mutated!", reason)
			}
		}
	}
}
