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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// --- Response Streaming ---

func runResponseStreamingCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "steps", "expect_close", "expect_error", "expect_matches_single_shot"), "parse_chunk case")
	args, _ := tc.Data["args"].(map[string]any)
	assertKnownKeys(t, args, makeSet("format", "catalog", "catalogs", "progressive_keys", "wrapped", "after_rejected_block"), "parse_chunk args")

	cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
	if err != nil {
		t.Fatalf("loadCatalogs failed: %v", err)
	}
	fmtName, _ := args["format"].(string)
	fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
	if err != nil {
		t.Fatalf("buildFormat failed: %v", err)
	}
	parser := fmtInst.CreateParser()

	wrapped := true
	if w, ok := args["wrapped"].(bool); ok {
		wrapped = w
	}
	afterPolicy := agent.AfterRejectedEnd
	if ar, _ := args["after_rejected_block"].(string); ar == "continue" {
		afterPolicy = agent.AfterRejectedContinue
	}
	stream, err := parser.OpenStream(&agent.StreamOptions{
		Unwrapped:          !wrapped,
		AfterRejectedBlock: afterPolicy,
	})
	if err != nil {
		t.Fatalf("OpenStream failed: %v", err)
	}

	var chunks []string
	var yielded []map[string]any
	steps, _ := tc.Data["steps"].([]any)
	for idx, rawStep := range steps {
		stepMap, _ := rawStep.(map[string]any)
		assertKnownKeys(t, stepMap, makeSet("input", "expect", "expect_error", "expect_in_block", "expect_partial_results"), "parse_chunk step")
		chunk, _ := stepMap["input"].(string)
		chunks = append(chunks, chunk)

		sp, feedErr := stream.Feed(chunk)
		if expErr, hasErr := stepMap["expect_error"]; hasErr {
			assertExpectedError(t, feedErr, expErr, fmt.Sprintf("%s.step[%d]", tc.Name, idx))
			if expErr == "closed" {
				var stateErr *core.StateError
				if !errors.Is(feedErr, agent.ErrStreamClosed) || !errors.As(feedErr, &stateErr) {
					t.Fatalf("expected ErrStreamClosed (*core.StateError), got (%T) %v", feedErr, feedErr)
				}
			}
			if expPartial, hasPartial := stepMap["expect_partial_results"]; hasPartial {
				partials := extractPartialResults(feedErr)
				gotPartials := make([]any, len(partials))
				for i, p := range partials {
					gotPartials[i] = responsePartToDict(p)
				}
				assertJSONEqual(t, gotPartials, expPartial, fmt.Sprintf("%s.step[%d].partial_results", tc.Name, idx))
			}
			if expInBlock, hasInBlock := stepMap["expect_in_block"].(bool); hasInBlock {
				if stream.IsInBlock() != expInBlock {
					t.Fatalf("step[%d] IsInBlock() = %v, want %v", idx, stream.IsInBlock(), expInBlock)
				}
			}
			return
		}
		if feedErr != nil {
			t.Fatalf("step[%d] Feed(%q) unexpected error: %v", idx, chunk, feedErr)
		}
		stepDicts := make([]map[string]any, len(sp))
		for i, p := range sp {
			stepDicts[i] = streamPartToDict(p)
		}
		assertJSONEqual(t, stepDicts, stepMap["expect"], fmt.Sprintf("%s.step[%d]", tc.Name, idx))
		if expInBlock, hasInBlock := stepMap["expect_in_block"].(bool); hasInBlock {
			if stream.IsInBlock() != expInBlock {
				t.Fatalf("step[%d] IsInBlock() = %v, want %v", idx, stream.IsInBlock(), expInBlock)
			}
		}
		yielded = append(yielded, stepDicts...)
	}

	closedParts, closeErr := stream.Close()
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, closeErr, expErr, tc.Name+".close")
		return
	}
	if closeErr != nil {
		t.Fatalf("Close() unexpected error: %v", closeErr)
	}
	closedDicts := make([]map[string]any, len(closedParts))
	for i, p := range closedParts {
		closedDicts[i] = streamPartToDict(p)
	}
	if expClose, hasClose := tc.Data["expect_close"]; hasClose {
		assertJSONEqual(t, closedDicts, expClose, tc.Name+".close")
	}
	yielded = append(yielded, closedDicts...)

	if matchSingle, _ := tc.Data["expect_matches_single_shot"].(bool); matchSingle {
		freshParser := fmtInst.CreateParser()
		singleParts, err := freshParser.ParseResponse(strings.Join(chunks, ""), &agent.ParseOptions{Unwrapped: !wrapped})
		if err != nil {
			t.Fatalf("single-shot ParseResponse failed: %v", err)
		}
		singleDicts := make([]map[string]any, len(singleParts))
		for i, p := range singleParts {
			singleDicts[i] = responsePartToDict(p)
		}
		assertJSONEqual(t, mergeTextPartDicts(yielded), mergeTextPartDicts(singleDicts), tc.Name+".matches_single_shot")
	}
}

// --- RendererState ---

func runRendererStateCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "turns"), "renderer_state_turns case")
	catArgs := map[string]any{}
	if rawCats, hasCats := tc.Data["catalogs"]; hasCats {
		catArgs["catalogs"] = rawCats
	}
	cats, err := loadCatalogsFromArgs(t, confRoot, catArgs, subKeyOrder(tc.KeyOrder, ""), true)
	if err != nil {
		t.Fatalf("loadCatalogs failed: %v", err)
	}
	state, err := agent.NewRendererState(cats)
	if err != nil {
		t.Fatalf("NewRendererState failed: %v", err)
	}

	turns, _ := tc.Data["turns"].([]any)
	for idx, rawTurn := range turns {
		turnMap, _ := rawTurn.(map[string]any)
		assertKnownKeys(t, turnMap, makeSet("format", "payload", "response", "expect_surfaces", "expectError", "expect_error"), "renderer_state turn")
		expErr := turnMap["expect_error"]
		if expErr == nil {
			expErr = turnMap["expectError"]
		}

		var turnErr error
		if rawPayload, hasPayload := turnMap["payload"]; hasPayload {
			msgs := toMessageSlice(t, rawPayload)
			turnErr = state.Transaction(func() error {
				touched, applyErr := state.Apply(msgs)
				if applyErr != nil {
					return applyErr
				}
				return state.CheckTopology(touched)
			})
		} else {
			fmtName, _ := turnMap["format"].(string)
			if fmtName == "" {
				fmtName = "direct_json"
			}
			fmtInst, buildErr := buildFormatForCase(t, fmtName, cats, nil, nil, false)
			if buildErr != nil {
				t.Fatalf("buildFormat failed: %v", buildErr)
			}
			respStr, _ := turnMap["response"].(string)
			_, turnErr = fmtInst.CreateParser().ParseResponse(respStr, &agent.ParseOptions{State: state})
		}

		if expErr != nil {
			assertExpectedError(t, turnErr, expErr, fmt.Sprintf("%s.turn[%d]", tc.Name, idx))
			continue
		}
		if turnErr != nil {
			t.Fatalf("turn[%d] failed: %v", idx, turnErr)
		}

		if expSurfaces, ok := turnMap["expect_surfaces"].(map[string]any); ok {
			gotSurfaceIDs := make([]string, 0, len(state.SurfaceIDs()))
			gotSurfaceIDs = append(gotSurfaceIDs, state.SurfaceIDs()...)
			sort.Strings(gotSurfaceIDs)
			wantSurfaceIDs := sortedMapKeys(expSurfaces)
			if !reflect.DeepEqual(gotSurfaceIDs, wantSurfaceIDs) {
				t.Fatalf("turn[%d] surface_ids = %v, want %v", idx, gotSurfaceIDs, wantSurfaceIDs)
			}
			for sid, rawExpSurf := range expSurfaces {
				expSurf, _ := rawExpSurf.(map[string]any)
				assertKnownKeys(t, expSurf, makeSet("components", "data"), "expect_surfaces."+sid)
				surf := state.Surface(sid)
				if surf == nil {
					t.Fatalf("turn[%d] missing surface %q", idx, sid)
				}
				if expComps, hasComps := expSurf["components"].(map[string]any); hasComps {
					gotKeys := append([]string(nil), surf.ComponentsModel.Keys()...)
					sort.Strings(gotKeys)
					wantKeys := sortedMapKeys(expComps)
					if !reflect.DeepEqual(gotKeys, wantKeys) {
						t.Fatalf("turn[%d] surface %q component keys = %v, want %v", idx, sid, gotKeys, wantKeys)
					}
					for cid, expComp := range expComps {
						cm := surf.ComponentsModel.Get(cid)
						actualComp := make(map[string]any, len(cm.Properties)+1)
						actualComp["component"] = cm.Type
						for k, v := range cm.Properties {
							actualComp[k] = v
						}
						assertJSONEqual(t, actualComp, expComp, fmt.Sprintf("%s.turn[%d].%s.%s", tc.Name, idx, sid, cid))
					}
				}
				if expData, hasData := expSurf["data"]; hasData {
					val, _, _ := surf.DataModel.Get("/")
					if val == nil {
						val = map[string]any{}
					}
					assertJSONEqual(t, val, expData, fmt.Sprintf("%s.turn[%d].%s.data", tc.Name, idx, sid))
				}
			}
		}
	}
}

// --- StreamedAnswer ---

func runStreamedAnswerCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "steps", "expect_close", "expect_error"), "stream_answer case")
	args, _ := tc.Data["args"].(map[string]any)
	assertKnownKeys(t, args, makeSet("format", "catalog", "renderer_catalogs"), "stream_answer args")
	if fmtName, _ := args["format"].(string); fmtName != "direct_json" {
		t.Fatalf("unexpected format %q in streamed_answer.yaml", fmtName)
	}

	loadCat := func(rel string) *core.Catalog {
		cat, err := (&agent.FileSystemCatalogProvider{Path: filepath.Join(confRoot, filepath.FromSlash(rel))}).Load()
		if err != nil {
			t.Fatalf("failed loading catalog %s: %v", rel, err)
		}
		return cat
	}

	catRel, _ := args["catalog"].(string)
	agentCat := loadCat(catRel)
	proc, err := agent.NewRequestProcessor([]*core.Catalog{agentCat}, &agent.RequestProcessorOptions{
		FormatFactory: agent.NewDirectJSONFormatFactory(nil),
	})
	if err != nil {
		t.Fatalf("NewRequestProcessor failed: %v", err)
	}

	var rendererCats []*core.Catalog
	if rawRC, ok := args["renderer_catalogs"].([]any); ok {
		for _, r := range toStringSlice(rawRC) {
			rendererCats = append(rendererCats, loadCat(r))
		}
	} else {
		rendererCats = []*core.Catalog{loadCat(catRel)}
	}
	renderer, err := core.NewMessageProcessor(rendererCats, nil)
	if err != nil {
		t.Fatalf("NewMessageProcessor failed: %v", err)
	}

	ans, err := agent.NewStreamedAnswer(proc, renderer)
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, err, expErr, tc.Name)
		return
	}
	if err != nil {
		t.Fatalf("NewStreamedAnswer failed: %v", err)
	}

	renderParts := func() []any {
		ps := ans.Parts()
		out := make([]any, len(ps))
		for i, p := range ps {
			if p.IsText() {
				out[i] = map[string]any{"text": p.Text}
			} else if p.IsError() {
				out[i] = map[string]any{"error": map[string]any{"category": errorCategoryOf(p.Error)}}
			} else {
				if p.Surface != renderer.Model.Surface(p.Surface.ID) {
					t.Fatalf("AnswerPart.Surface pointer does not match renderer.Model.Surface(%q)", p.Surface.ID)
				}
				out[i] = map[string]any{"surface": p.Surface.ID}
			}
		}
		return out
	}

	steps, _ := tc.Data["steps"].([]any)
	for idx, rawStep := range steps {
		stepMap, _ := rawStep.(map[string]any)
		assertKnownKeys(t, stepMap, makeSet("input", "expect_parts", "expect_in_block"), "stream_answer step")
		chunk, _ := stepMap["input"].(string)
		if err := ans.Feed(chunk); err != nil {
			t.Fatalf("step[%d] ans.Feed failed: %v", idx, err)
		}
		assertJSONEqual(t, renderParts(), stepMap["expect_parts"], fmt.Sprintf("%s.step[%d]", tc.Name, idx))
		if expInBlock, hasInBlock := stepMap["expect_in_block"].(bool); hasInBlock {
			if ans.IsInBlock() != expInBlock {
				t.Fatalf("step[%d] ans.IsInBlock() = %v, want %v", idx, ans.IsInBlock(), expInBlock)
			}
		}
	}

	if err := ans.Close(); err != nil {
		t.Fatalf("ans.Close failed: %v", err)
	}
	if expClose, hasClose := tc.Data["expect_close"]; hasClose {
		assertJSONEqual(t, renderParts(), expClose, tc.Name+".close")
	}
}

// --- Agent Functions & RendererToAgentMessageProcessor ---

var rejectedAgentCallCodes = makeSet("INVALID_FUNCTION_CALL", "UNKNOWN_FUNCTION")

func buildAgentFunctionCatalog(t *testing.T, confRoot string, entry any, keyOrder map[string][]string, calls *[]string) (*core.Catalog, error) {
	t.Helper()
	entryMap, _ := entry.(map[string]any)
	rawCat := entryMap["catalog"]
	var docMap map[string]any
	var fallbackID string
	var docOrder map[string][]string
	if relPath, isStr := rawCat.(string); isStr {
		docAny, ko := loadJSONFileWithOrder(t, filepath.Join(confRoot, filepath.FromSlash(relPath)))
		docMap, _ = docAny.(map[string]any)
		docOrder = ko
		fallbackID = strings.TrimSuffix(filepath.Base(relPath), ".json")
	} else {
		docMap, _ = rawCat.(map[string]any)
		docOrder = subKeyOrder(keyOrder, "/catalog")
		fallbackID = "inline"
	}

	pv := ""
	if _, hasPV := docMap["protocolVersion"]; !hasPV {
		pv = "1.0"
	}
	cid := ""
	if _, hasCID := docMap["catalogId"]; !hasCID {
		cid = fallbackID
	}
	cat, err := (&agent.InMemoryCatalogProvider{
		Document:        docMap,
		ProtocolVersion: core.ProtocolVersion(pv),
		CatalogID:       cid,
		KeyOrder:        docOrder,
	}).Load()
	if err != nil {
		return nil, err
	}

	rawAgentFns, _ := entryMap["agent_functions"].(map[string]any)
	if len(rawAgentFns) == 0 {
		return cat, nil
	}

	// Preserve YAML declaration order of agent_functions!
	var fnKeys []string
	if ordered := subKeyOrder(keyOrder, "/agent_functions"); ordered != nil && len(ordered[""]) > 0 {
		fnKeys = ordered[""]
	} else {
		fnKeys = sortedMapKeys(rawAgentFns)
	}

	var agentFns []*core.AgentFunction
	for _, key := range fnKeys {
		decl, _ := rawAgentFns[key].(map[string]any)
		name := key
		if explicitName, ok := decl["name"].(string); ok && explicitName != "" {
			name = explicitName
		} else if _, hasExplicit := decl["name"]; hasExplicit {
			name, _ = decl["name"].(string)
		}
		behavior, _ := decl["behavior"].(map[string]any)
		handler := makeScriptedAgentHandler(t, name, behavior, calls)

		if fromAPI, _ := decl["from_api"].(bool); fromAPI {
			api, exists := cat.Functions()[name]
			if !exists {
				rtStr, _ := decl["returnType"].(string)
				if rtStr == "" {
					rtStr = "any"
				}
				argsSchema, _ := decl["args"].(map[string]any)
				desc, _ := decl["description"].(string)
				api = core.FunctionAPI{
					Name:        name,
					Description: desc,
					ReturnType:  core.FunctionReturnType(rtStr),
					Schema:      argsSchema,
				}
				af, afErr := core.AgentFunctionFromAPI(api, handler)
				if afErr != nil {
					return nil, afErr
				}
				// Ensure CopyWith knows this declaration was NOT in cat.Functions() -> handled by CopyWith!
				agentFns = append(agentFns, af)
				continue
			}
			af, afErr := core.AgentFunctionFromAPI(api, handler)
			if afErr != nil {
				return nil, afErr
			}
			agentFns = append(agentFns, af)
			continue
		}

		rtStr, _ := decl["returnType"].(string)
		argsSchema, _ := decl["args"].(map[string]any)
		desc, _ := decl["description"].(string)
		reqAct, _ := decl["requiresUserActivation"].(bool)
		agentFns = append(agentFns, &core.AgentFunction{
			Name:                   name,
			Description:            desc,
			ReturnType:             core.FunctionReturnType(rtStr),
			ArgsSchema:             argsSchema,
			RequiresUserActivation: reqAct,
			Handler:                handler,
		})
	}

	return cat.CopyWith(core.CopyWithOptions{AgentFunctions: agentFns})
}

func makeScriptedAgentHandler(t *testing.T, name string, behavior map[string]any, calls *[]string) core.AgentFunctionHandler {
	t.Helper()
	return func(_ context.Context, args map[string]any, callCtx core.AgentFunctionContext) (any, error) {
		*calls = append(*calls, name)
		if retVal, hasRet := behavior["returns"]; hasRet {
			return retVal, nil
		}
		if retArgs, _ := behavior["returns_args"].(bool); retArgs {
			return args, nil
		}
		if retCtx, _ := behavior["returns_context"].(bool); retCtx {
			out := map[string]any{
				"catalogId":      callCtx.CatalogID,
				"functionCallId": callCtx.FunctionCallID,
			}
			if callCtx.SurfaceID != "" {
				out["surfaceId"] = callCtx.SurfaceID
			} else {
				out["surfaceId"] = nil
			}
			return out, nil
		}
		if raises, ok := behavior["raises"].(map[string]any); ok {
			msg, _ := raises["message"].(string)
			if code, hasCode := raises["code"].(string); hasCode {
				return nil, core.NewRPCError(core.RPCErrorCode(code), msg)
			}
			if isVal, _ := raises["validation"].(bool); isVal {
				return nil, core.NewValidationError(msg)
			}
			return nil, errors.New(msg)
		}
		return nil, fmt.Errorf("unknown scripted behavior %#v", behavior)
	}
}

func normalizeTimestamps(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, item := range x {
			if k == "timestamp" {
				if s, ok := item.(string); ok {
					if inst, err := time.Parse(time.RFC3339Nano, s); err == nil {
						out[k] = inst.UTC().Format(time.RFC3339Nano)
						continue
					}
				}
			}
			out[k] = normalizeTimestamps(item)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = normalizeTimestamps(item)
		}
		return out
	default:
		return v
	}
}

func assertAgentReplyMatches(t *testing.T, actual, expected any, path []string) {
	t.Helper()
	expMap, isExpMap := expected.(map[string]any)
	if !isExpMap {
		assertJSONEqual(t, actual, expected, strings.Join(path, "."))
		return
	}
	actMap, isActMap := actual.(map[string]any)
	if !isActMap {
		t.Fatalf("%s: expected map, got %#v", strings.Join(path, "."), actual)
	}
	if len(path) == 2 && path[0] == "agentFunctionResponse" && path[1] == "error" {
		if !reflect.DeepEqual(sortedMapKeys(actMap), []string{"code", "message"}) {
			t.Fatalf("expected error keys [code, message], got %v", sortedMapKeys(actMap))
		}
		msg, _ := actMap["message"].(string)
		if msg == "" {
			t.Fatalf("expected non-empty error.message")
		}
		if actMap["code"] != expMap["code"] {
			t.Fatalf("error.code = %v, want %v", actMap["code"], expMap["code"])
		}
		if expMsg, ok := expMap["message"].(string); ok && !strings.Contains(msg, expMsg) {
			t.Fatalf("expected error.message %q to contain %q", msg, expMsg)
		}
		return
	}
	if !reflect.DeepEqual(sortedMapKeys(actMap), sortedMapKeys(expMap)) {
		t.Fatalf("%s keys = %v, want %v (actual=%#v)", strings.Join(path, "."), sortedMapKeys(actMap), sortedMapKeys(expMap), actMap)
	}
	for k, ev := range expMap {
		assertAgentReplyMatches(t, actMap[k], ev, append(path, k))
	}
}

func runAgentFunctionsCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expect", "expect_error", "expect_valid"), "agent_functions case")
	args, _ := tc.Data["args"].(map[string]any)
	var calls []string

	switch tc.Action {
	case "declare_agent_functions":
		cat, err := buildAgentFunctionCatalog(t, confRoot, args["catalog"], subKeyOrder(tc.KeyOrder, "/args/catalog"), &calls)
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			if len(calls) != 0 {
				t.Fatalf("expected 0 handler calls, got %v", calls)
			}
			return
		}
		if err != nil {
			t.Fatalf("declare_agent_functions failed: %v", err)
		}
		expMap, _ := tc.Data["expect"].(map[string]any)
		if got, want := sortedMapKeys(cat.Functions()), dedupSortedStrings(toStringSlice(expMap["functions"])); !reflect.DeepEqual(got, want) {
			t.Fatalf("functions = %v, want %v", got, want)
		}
		if got, want := sortedMapKeys(cat.AgentFunctions()), dedupSortedStrings(toStringSlice(expMap["agent_functions"])); !reflect.DeepEqual(got, want) {
			t.Fatalf("agent_functions = %v, want %v", got, want)
		}
		docFns, _ := cat.ToJSON()["functions"].(map[string]any)
		if got, want := sortedMapKeys(docFns), dedupSortedStrings(toStringSlice(expMap["document_functions"])); !reflect.DeepEqual(got, want) {
			t.Fatalf("document_functions = %v, want %v", got, want)
		}
		if len(calls) != 0 {
			t.Fatalf("expected 0 handler calls, got %v", calls)
		}

	case "handle_agent_function":
		rawCats, _ := args["catalogs"].([]any)
		buildProc := func() (*agent.RendererToAgentMessageProcessor, error) {
			cats := make([]*core.Catalog, len(rawCats))
			for i, entry := range rawCats {
				c, err := buildAgentFunctionCatalog(t, confRoot, entry, subKeyOrder(tc.KeyOrder, fmt.Sprintf("/args/catalogs/%d", i)), &calls)
				if err != nil {
					return nil, err
				}
				cats[i] = c
			}
			return agent.NewRendererToAgentMessageProcessor(cats, nil)
		}
		proc, err := buildProc()
		if err == nil {
			msgMap, _ := args["message"].(map[string]any)
			res, procErr := proc.ProcessMessageMap(context.Background(), msgMap)
			if expErr, hasErr := tc.Data["expect_error"]; hasErr {
				assertExpectedError(t, procErr, expErr, tc.Name)
				if len(calls) != 0 {
					t.Fatalf("expected 0 calls on rejected message, got %v", calls)
				}
				return
			}
			if procErr != nil {
				t.Fatalf("ProcessMessage failed: %v", procErr)
			}
			if !res.Handled || len(res.Replies) != 1 {
				t.Fatalf("expected Handled=true and 1 reply, got %+v", res)
			}
			reply := mustNormalizeJSON(t, res.Replies[0]).(map[string]any)
			if reply["version"] != "1.0" {
				t.Fatalf("expected reply version 1.0, got %v", reply["version"])
			}
			resp, _ := reply["agentFunctionResponse"].(map[string]any)
			expMap, _ := tc.Data["expect"].(map[string]any)
			if resp["functionCallId"] != expMap["functionCallId"] {
				t.Fatalf("functionCallId = %v, want %v", resp["functionCallId"], expMap["functionCallId"])
			}
			if expErrObj, hasErrObj := expMap["error"].(map[string]any); hasErrObj {
				assertAgentReplyMatches(t, resp["error"], expErrObj, []string{"agentFunctionResponse", "error"})
				if code, _ := expErrObj["code"].(string); rejectedAgentCallCodes[code] && len(calls) != 0 {
					t.Fatalf("expected 0 handler calls for %s, got %v", code, calls)
				}
			} else {
				if !reflect.DeepEqual(sortedMapKeys(resp), []string{"functionCallId", "value"}) {
					t.Fatalf("expected [functionCallId, value], got %v", sortedMapKeys(resp))
				}
				assertJSONEqual(t, resp["value"], expMap["value"], tc.Name+".value")
			}
			return
		}
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			return
		}
		t.Fatalf("buildProc failed: %v", err)

	case "validate_payload":
		rawCats, _ := args["catalogs"].([]any)
		cats := make([]*core.Catalog, len(rawCats))
		for i, entry := range rawCats {
			c, err := buildAgentFunctionCatalog(t, confRoot, entry, subKeyOrder(tc.KeyOrder, fmt.Sprintf("/args/catalogs/%d", i)), &calls)
			if err != nil {
				if expErr, hasErr := tc.Data["expect_error"]; hasErr {
					assertExpectedError(t, err, expErr, tc.Name)
					return
				}
				t.Fatalf("buildAgentFunctionCatalog failed: %v", err)
			}
			cats[i] = c
		}
		msgs := toMessageSlice(t, args["messages"])
		err := agent.ValidatePayload(cats, msgs)
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			if len(calls) != 0 {
				t.Fatalf("expected 0 calls, got %v", calls)
			}
			return
		}
		if err != nil {
			t.Fatalf("ValidatePayload failed: %v", err)
		}
		if len(calls) != 0 {
			t.Fatalf("expected 0 calls, got %v", calls)
		}

	case "process_renderer_message":
		type receivedCB struct {
			kind string
			msg  *core.RendererToAgentMessage
		}
		var received []receivedCB
		opts := &agent.RendererToAgentOptions{}
		if rawCBs, ok := args["callbacks"].([]any); ok {
			for _, entry := range rawCBs {
				var kind string
				var declines bool
				if s, isStr := entry.(string); isStr {
					kind = s
				} else if em, isMap := entry.(map[string]any); isMap {
					kind, _ = em["kind"].(string)
					declines, _ = em["declines"].(bool)
				}
				cbKind := kind
				cbDeclines := declines
				cb := func(_ context.Context, payload *core.RendererToAgentMessage) (bool, error) {
					received = append(received, receivedCB{kind: cbKind, msg: payload})
					return !cbDeclines, nil
				}
				switch kind {
				case "action":
					opts.OnAction = cb
				case "error":
					opts.OnError = cb
				case "rendererFunctionResponse":
					opts.OnRendererFunctionResponse = cb
				default:
					t.Fatalf("unknown callback kind %q", kind)
				}
			}
		}

		var entries []any
		var prefix string
		if rawCats, ok := args["catalogs"].([]any); ok {
			entries = rawCats
			prefix = "/args/catalogs"
		} else if singleCat, hasSingle := args["catalog"]; hasSingle {
			entries = []any{singleCat}
			prefix = "/args/catalog"
		}
		var cats []*core.Catalog
		var buildErr error
		for i, entry := range entries {
			koPath := fmt.Sprintf("%s/%d", prefix, i)
			if prefix == "/args/catalog" {
				koPath = prefix
			}
			c, err := buildAgentFunctionCatalog(t, confRoot, entry, subKeyOrder(tc.KeyOrder, koPath), &calls)
			if err != nil {
				buildErr = err
				break
			}
			cats = append(cats, c)
		}
		var proc *agent.RendererToAgentMessageProcessor
		if buildErr == nil {
			proc, buildErr = agent.NewRendererToAgentMessageProcessor(cats, opts)
		}
		var res agent.ProcessResult
		if buildErr == nil {
			msgMap, _ := args["message"].(map[string]any)
			res, buildErr = proc.ProcessMessageMap(context.Background(), msgMap)
		}
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, buildErr, expErr, tc.Name)
			if len(received) != 0 || len(calls) != 0 {
				t.Fatalf("expected 0 callbacks/calls on error, got received=%v calls=%v", received, calls)
			}
			return
		}
		if buildErr != nil {
			t.Fatalf("process_renderer_message failed: %v", buildErr)
		}

		expMap, _ := tc.Data["expect"].(map[string]any)
		wantHandled, _ := expMap["handled"].(bool)
		if res.Handled != wantHandled {
			t.Fatalf("Handled = %v, want %v", res.Handled, wantHandled)
		}
		var expReplies []any
		if r, ok := expMap["replies"].([]any); ok {
			expReplies = r
		}
		if len(res.Replies) != len(expReplies) {
			t.Fatalf("len(Replies) = %d, want %d (%+v)", len(res.Replies), len(expReplies), res.Replies)
		}
		for i, expRep := range expReplies {
			actRep := mustNormalizeJSON(t, res.Replies[i])
			assertAgentReplyMatches(t, actRep, expRep, nil)
			if erm, ok := expRep.(map[string]any); ok {
				if afr, ok2 := erm["agentFunctionResponse"].(map[string]any); ok2 {
					if errObj, ok3 := afr["error"].(map[string]any); ok3 {
						if code, _ := errObj["code"].(string); rejectedAgentCallCodes[code] && len(calls) != 0 {
							t.Fatalf("expected 0 handler calls on %s, got %v", code, calls)
						}
					}
				}
			}
		}
		if expCB, hasCB := expMap["callback"].(map[string]any); hasCB {
			if len(received) != 1 {
				t.Fatalf("expected 1 callback invocation, got %d", len(received))
			}
			if received[0].kind != expCB["kind"] {
				t.Fatalf("callback kind = %q, want %v", received[0].kind, expCB["kind"])
			}
			assertJSONEqual(
				t,
				normalizeTimestamps(mustNormalizeJSON(t, received[0].msg)),
				normalizeTimestamps(mustNormalizeJSON(t, expCB["message"])),
				tc.Name+".callback",
			)
		} else if len(received) != 0 {
			t.Fatalf("expected 0 callbacks, got %+v", received)
		}

	default:
		t.Fatalf("unknown agent_functions action %q", tc.Action)
	}
}

// --- RendererFunctionCalls ---

func buildCodeRendererCatalog(t *testing.T, entry map[string]any) *core.Catalog {
	t.Helper()
	cid, _ := entry["catalogId"].(string)
	base, err := core.CatalogFromJSON(map[string]any{
		"catalogId":       cid,
		"protocolVersion": "1.0",
		"components":      map[string]any{},
		"functions":       map[string]any{},
	}, nil)
	if err != nil {
		t.Fatalf("CatalogFromJSON failed: %v", err)
	}
	rawFns, _ := entry["functions"].(map[string]any)
	fnMap := make(map[string]core.FunctionAPI, len(rawFns))
	var fnOrder []string
	for name, rawSpec := range rawFns {
		spec, _ := rawSpec.(map[string]any)
		api := core.FunctionAPI{
			Name:       name,
			ReturnType: core.ReturnTypeAny,
			Schema:     map[string]any{"type": "object"},
		}
		if ac, ok := spec["allowedCallers"].(string); ok {
			api.AllowedCallers = core.AllowedCallers(ac)
		}
		if rua, ok := spec["requiresUserActivation"].(bool); ok {
			api.RequiresUserActivation = rua
		}
		fnMap[name] = api
		fnOrder = append(fnOrder, name)
	}
	sort.Strings(fnOrder)
	updated, err := base.CopyWith(core.CopyWithOptions{
		ClearFunctions: len(fnMap) == 0,
		Functions:      fnMap,
		FunctionOrder:  fnOrder,
	})
	if err != nil {
		t.Fatalf("CopyWith failed: %v", err)
	}
	return updated
}

func callStateDict(p *agent.PendingRendererCall) any {
	val, ok, err := p.Result()
	if !ok {
		return "pending"
	}
	if err == nil {
		return map[string]any{"value": val}
	}
	var rpcErr *core.RPCError
	if !errors.As(err, &rpcErr) {
		return map[string]any{"error": map[string]any{"code": "UNKNOWN", "message": err.Error()}}
	}
	return map[string]any{"error": map[string]any{"code": rpcErr.Code, "message": rpcErr.Message}}
}

func assertRendererCallState(t *testing.T, label string, actual, expected any) {
	t.Helper()
	if expected == "pending" || actual == "pending" {
		if actual != expected {
			t.Fatalf("call %s: state = %#v, want %#v", label, actual, expected)
		}
		return
	}
	expMap, _ := expected.(map[string]any)
	actMap, _ := actual.(map[string]any)
	if _, hasVal := expMap["value"]; hasVal {
		assertJSONEqual(t, actMap, expMap, "call "+label)
		return
	}
	expErr, _ := expMap["error"].(map[string]any)
	actErr, ok := actMap["error"].(map[string]any)
	if !ok {
		t.Fatalf("call %s: expected error state, got %#v", label, actual)
	}
	if actErr["code"] != expErr["code"] {
		t.Fatalf("call %s: error.code = %v, want %v", label, actErr["code"], expErr["code"])
	}
	msg, _ := actErr["message"].(string)
	if msg == "" {
		t.Fatalf("call %s: expected non-empty error.message", label)
	}
	if expMsg, hasMsg := expErr["message"].(string); hasMsg && !strings.Contains(msg, expMsg) {
		t.Fatalf("call %s: expected error.message %q to contain %q", label, msg, expMsg)
	}
}

func runRendererFunctionCallsCase(t *testing.T, tc loadedYAMLCase) string {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "steps", "expect_error"), "renderer_function_calls case")
	clock := &fakeClock{}
	opts := &agent.RendererFunctionCallsOptions{Clock: clock}
	args, _ := tc.Data["args"].(map[string]any)
	if args != nil {
		assertKnownKeys(t, args, makeSet("catalogs", "default_timeout_ms", "max_pending"), "renderer_function_calls args")
		if rawCats, ok := args["catalogs"].([]any); ok {
			for _, entry := range rawCats {
				em, _ := entry.(map[string]any)
				opts.Catalogs = append(opts.Catalogs, buildCodeRendererCatalog(t, em))
			}
		}
		if rawTimeout, hasTimeout := args["default_timeout_ms"]; hasTimeout {
			if rawTimeout == nil {
				opts.DisableDefaultTimeout = true
			} else if ms, ok := intValue(rawTimeout); ok {
				opts.DefaultTimeout = time.Duration(ms) * time.Millisecond
			}
		}
		if mp, ok := intValue(args["max_pending"]); ok {
			opts.MaxPending = mp
		}
	}

	calls, err := agent.NewRendererFunctionCalls(opts)
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, err, expErr, tc.Name)
		return ""
	}
	if err != nil {
		t.Fatalf("NewRendererFunctionCalls failed: %v", err)
	}
	defer calls.Dispose("")

	proc, err := agent.NewRendererToAgentMessageProcessor(nil, &agent.RendererToAgentOptions{
		OnRendererFunctionResponse: func(_ context.Context, resp *core.RendererToAgentMessage) (bool, error) {
			return calls.Resolve(resp.RendererFunctionResponse), nil
		},
	})
	if err != nil {
		t.Fatalf("NewRendererToAgentMessageProcessor failed: %v", err)
	}

	pendingByLabel := make(map[string]*agent.PendingRendererCall)
	callIDs := make(map[string]string)
	usedCallIDs := make(map[string]bool)

	steps, _ := tc.Data["steps"].([]any)
	for idx, rawStep := range steps {
		stepMap, _ := rawStep.(map[string]any)
		assertKnownKeys(t, stepMap, makeSet("call", "respond", "advance_ms", "dispose", "expect_error", "expect_message", "expect_calls", "expect_pending_count"), "renderer_function_calls step")
		where := fmt.Sprintf("%s.step[%d]", tc.Name, idx)

		if rawCall, hasCall := stepMap["call"].(map[string]any); hasCall {
			req := agent.CallRendererRequest{
				CatalogID: stringField(rawCall, "catalogId"),
				Name:      stringField(rawCall, "name"),
				SurfaceID: stringField(rawCall, "surfaceId"),
			}
			if v, ok := rawCall["args"]; ok && v != nil {
				argsMap, isMap := v.(map[string]any)
				if !isMap {
					return "CallRendererRequest.Args is typed as map[string]any in Go, so non-map arguments are rejected at compile time."
				}
				req.Args = argsMap
			}
			if ms, ok := intValue(rawCall["timeout_ms"]); ok {
				req.Timeout = time.Duration(ms) * time.Millisecond
			}
			if _, hasID := rawCall["functionCallId"]; hasID {
				id := stringField(rawCall, "functionCallId")
				req.FunctionCallID = &id
			}

			msg, fut, callErr := calls.Call(req)
			if expErr, hasExpErr := stepMap["expect_error"].(map[string]any); hasExpErr {
				if callErr == nil {
					t.Fatalf("%s: expected RPCError %v, got nil", where, expErr)
				}
				var rpcErr *core.RPCError
				if !errors.As(callErr, &rpcErr) {
					t.Fatalf("%s: expected *core.RPCError, got (%T) %v", where, callErr, callErr)
				}
				if rpcErr.Code != expErr["code"] {
					t.Fatalf("%s: rpcErr.Code = %q, want %v", where, rpcErr.Code, expErr["code"])
				}
				if expMsg, ok := expErr["message"].(string); ok && !strings.Contains(rpcErr.Message, expMsg) {
					t.Fatalf("%s: expected rpcErr.Message %q to contain %q", where, rpcErr.Message, expMsg)
				}
			} else {
				if callErr != nil {
					t.Fatalf("%s: unexpected Call error: %v", where, callErr)
				}
				dumped := mustNormalizeJSON(t, msg).(map[string]any)
				body, _ := dumped["callRendererFunction"].(map[string]any)
				cid, _ := body["functionCallId"].(string)
				if cid == "" {
					t.Fatalf("%s: missing functionCallId", where)
				}
				if usedCallIDs[cid] {
					t.Fatalf("%s: reused functionCallId %q", where, cid)
				}
				usedCallIDs[cid] = true
				delete(body, "functionCallId")
				label := stringField(rawCall, "label")
				callIDs[label] = cid
				pendingByLabel[label] = fut
				if expMsg, hasExpMsg := stepMap["expect_message"]; hasExpMsg {
					assertJSONEqual(t, dumped, expMsg, where+".expect_message")
				}
			}
		} else if rawResp, hasResp := stepMap["respond"].(map[string]any); hasResp {
			var cid string
			if lbl, hasLbl := rawResp["call"].(string); hasLbl {
				cid = callIDs[lbl]
			} else {
				cid = stringField(rawResp, "functionCallId")
			}
			respPayload := map[string]any{"functionCallId": cid}
			if errObj, hasErrObj := rawResp["error"]; hasErrObj {
				respPayload["error"] = errObj
			} else {
				respPayload["value"] = rawResp["value"]
			}
			owned := calls.IsPending(cid)
			res, procErr := proc.ProcessMessageMap(context.Background(), map[string]any{
				"version":                  "1.0",
				"rendererFunctionResponse": respPayload,
			})
			if procErr != nil {
				t.Fatalf("%s: ProcessMessage failed: %v", where, procErr)
			}
			if res.Handled != owned || len(res.Replies) != 0 {
				t.Fatalf("%s: Handled=%v (want %v), Replies=%v", where, res.Handled, owned, res.Replies)
			}
		} else if advMS, hasAdv := intValue(stepMap["advance_ms"]); hasAdv {
			clock.Advance(advMS)
		} else if rawDispose, hasDisp := stepMap["dispose"].(map[string]any); hasDisp {
			reason, _ := rawDispose["reason"].(string)
			calls.Dispose(reason)
		} else {
			t.Fatalf("%s: unknown step %#v", where, stepMap)
		}

		if expCalls, ok := stepMap["expect_calls"].(map[string]any); ok {
			for lbl, expState := range expCalls {
				assertRendererCallState(t, lbl, callStateDict(pendingByLabel[lbl]), expState)
			}
		}
		if rawCount, hasCount := stepMap["expect_pending_count"]; hasCount {
			expCount, ok := intValue(rawCount)
			if !ok {
				t.Fatalf("%s: expect_pending_count %#v is not a number", where, rawCount)
			}
			if calls.PendingCount() != expCount {
				t.Fatalf("%s: PendingCount() = %d, want %d", where, calls.PendingCount(), expCount)
			}
		}
	}
	return ""
}

func stringField(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// --- Skills ---

func TestPromptGeneratorBaseRulesAndCatalogInstructionsConformance(t *testing.T) {
	repoRoot, confRoot := findRepoAndConformanceRoot(t)
	catCfg, err := agent.CatalogConfigFromPath(filepath.Join(repoRoot, "catalogs", "basic", "v1", "catalog.json"), nil)
	if err != nil {
		t.Fatalf("CatalogConfigFromPath failed: %v", err)
	}
	cat := catCfg.TransformedCatalog()
	expFmt, err := agent.NewExpressFormat([]*core.Catalog{cat}, nil, nil)
	if err != nil {
		t.Fatalf("NewExpressFormat failed: %v", err)
	}

	baseGolden, err := os.ReadFile(filepath.Join(confRoot, "test_data", "skills", "express_base_rules.txt"))
	if err != nil {
		t.Fatalf("failed reading express_base_rules.txt: %v", err)
	}
	gotBase := expFmt.PromptGenerator().GenerateBaseRules(nil)
	if gotBase != string(baseGolden) {
		t.Fatalf("GenerateBaseRules mismatch:\ngot:\n%s\nwant:\n%s", gotBase, string(baseGolden))
	}

	catGolden, err := os.ReadFile(filepath.Join(confRoot, "test_data", "skills", "express_catalog_instructions.txt"))
	if err != nil {
		t.Fatalf("failed reading express_catalog_instructions.txt: %v", err)
	}
	gotCat := expFmt.PromptGenerator().GenerateCatalogInstructions(true, cat)
	if gotCat != string(catGolden) {
		t.Fatalf("GenerateCatalogInstructions mismatch:\ngot:\n%s\nwant:\n%s", gotCat, string(catGolden))
	}
}

func runSkillCase(t *testing.T, repoRoot string, tc loadedYAMLCase) string {
	t.Helper()
	args, _ := tc.Data["args"].(map[string]any)
	if tc.Action == "export_to_directory" {
		assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expect_error", "expected_files", "expected_absent_files"), "export_to_directory case")
		tmpDir := t.TempDir()
		for _, rel := range toStringSlice(args["pre_existing_files"]) {
			abs := filepath.Join(tmpDir, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				t.Fatalf("MkdirAll failed: %v", err)
			}
			if err := os.WriteFile(abs, []byte("pre-existing"), 0o644); err != nil {
				t.Fatalf("WriteFile failed: %v", err)
			}
		}

		runExport := func() error {
			ss := &agent.SkillSet{}
			if rawSkills, ok := args["skills"].([]any); ok {
				for _, rs := range rawSkills {
					sm, _ := rs.(map[string]any)
					sk, err := agent.NewSkill(agent.Skill{
						Name:        stringField(sm, "name"),
						Description: stringField(sm, "description"),
						Content:     stringField(sm, "content"),
						Filename:    stringField(sm, "filename"),
					})
					if err != nil {
						return err
					}
					ss.Add(sk)
				}
			}
			return ss.ExportToDirectory(tmpDir)
		}
		err := runExport()
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
		} else if err != nil {
			t.Fatalf("ExportToDirectory failed: %v", err)
		}

		for _, rel := range toStringSlice(tc.Data["expected_files"]) {
			if _, statErr := os.Stat(filepath.Join(tmpDir, filepath.FromSlash(rel))); statErr != nil {
				t.Fatalf("expected file %s to exist: %v", rel, statErr)
			}
		}
		for _, rel := range toStringSlice(tc.Data["expected_absent_files"]) {
			if _, statErr := os.Stat(filepath.Join(tmpDir, filepath.FromSlash(rel))); !os.IsNotExist(statErr) {
				t.Fatalf("expected file %s to be absent", rel)
			}
		}
		return ""
	}

	if reason := unsupportedFormatReason(args); reason != "" {
		return reason
	}

	var catRelPaths []string
	if rawList, ok := args["catalogs"].([]any); ok {
		catRelPaths = toStringSlice(rawList)
	} else if single, ok := args["catalog"].(string); ok && single != "" {
		catRelPaths = []string{single}
	}
	var catalogs []*core.Catalog
	for _, rel := range catRelPaths {
		cfg, err := agent.CatalogConfigFromPath(filepath.Join(repoRoot, filepath.FromSlash(rel)), nil)
		if err != nil {
			t.Fatalf("CatalogConfigFromPath(%s) failed: %v", rel, err)
		}
		catalogs = append(catalogs, cfg.TransformedCatalog())
	}

	fmtName, _ := args["format"].(string)
	if fmtName == "" {
		fmtName = "express"
	}
	var fmtInst agent.InferenceFormat
	var err error
	if fmtName == "express" {
		expCats := catalogs
		if len(expCats) == 0 {
			basicCat, bErr := core.BasicCatalog(core.Version1_0)
			if bErr != nil {
				t.Fatalf("BasicCatalog failed: %v", bErr)
			}
			expCats = []*core.Catalog{basicCat}
		}
		fmtInst, err = agent.NewExpressFormat(expCats, nil, nil)
	} else {
		djCats := catalogs
		if len(djCats) == 0 {
			basicCat, bErr := core.BasicCatalog(core.Version1_0)
			if bErr != nil {
				t.Fatalf("BasicCatalog failed: %v", bErr)
			}
			djCats = []*core.Catalog{basicCat}
		}
		fmtInst, err = agent.NewDirectJSONFormat(djCats, nil, nil)
	}
	if err != nil {
		t.Fatalf("building format %s failed: %v", fmtName, err)
	}

	gen := agent.NewSkillGenerator(fmtInst)

	switch tc.Action {
	case "from_format":
		assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expected_file"), "from_format case")
		name := stringField(args, "name")
		sk, err := gen.GenerateSkill(&agent.SkillGeneratorOptions{Name: name})
		if err != nil {
			t.Fatalf("GenerateSkill failed: %v", err)
		}
		md := sk.ToMarkdown()
		golden, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(stringField(tc.Data, "expected_file"))))
		if err != nil {
			t.Fatalf("ReadFile golden failed: %v", err)
		}
		if md != string(golden) {
			t.Fatalf("from_format mismatch:\ngot:\n%s\nwant:\n%s", md, string(golden))
		}

	case "core_syntax":
		assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expected_file"), "core_syntax case")
		name := stringField(args, "name")
		sk, err := gen.GenerateCoreSkill(&agent.SkillGeneratorOptions{Name: name})
		if err != nil {
			t.Fatalf("GenerateCoreSkill failed: %v", err)
		}
		md := sk.ToMarkdown()
		golden, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(stringField(tc.Data, "expected_file"))))
		if err != nil {
			t.Fatalf("ReadFile golden failed: %v", err)
		}
		if md != string(golden) {
			t.Fatalf("core_syntax mismatch:\ngot:\n%s\nwant:\n%s", md, string(golden))
		}

	case "from_catalog":
		assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expected_file"), "from_catalog case")
		sk, err := gen.GenerateCatalogSkill(catalogs[0], nil)
		if err != nil {
			t.Fatalf("GenerateCatalogSkill failed: %v", err)
		}
		md := sk.ToMarkdown()
		golden, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(stringField(tc.Data, "expected_file"))))
		if err != nil {
			t.Fatalf("ReadFile golden failed: %v", err)
		}
		if md != string(golden) {
			t.Fatalf("from_catalog mismatch:\ngot:\n%s\nwant:\n%s", md, string(golden))
		}

	case "monolithic_skill_equals_prompt_snippet":
		assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args"), "monolithic_skill_equals_prompt_snippet case")
		sk, err := gen.GenerateSkill(nil)
		if err != nil {
			t.Fatalf("GenerateSkill failed: %v", err)
		}
		snippet, err := fmtInst.PromptGenerator().Generate()
		if err != nil {
			t.Fatalf("PromptGenerator().Generate failed: %v", err)
		}
		if sk.Content != snippet+"\n" {
			t.Fatalf("expected sk.Content == snippet + '\\n'")
		}
		md := sk.ToMarkdown()
		idx := strings.Index(md, "\n---\n\n")
		if idx < 0 {
			t.Fatalf("missing frontmatter closing delimiter in %q", md)
		}
		body := md[idx+len("\n---\n\n"):]
		if body != strings.TrimSpace(snippet)+"\n" {
			t.Fatalf("markdown body mismatch")
		}

	case "skill_set":
		assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expected_skills", "expected_skill_files"), "skill_set case")
		ss, err := gen.GenerateSkillSet(nil, "")
		if err != nil {
			t.Fatalf("GenerateSkillSet failed: %v", err)
		}
		dict, err := ss.ToMap()
		if err != nil {
			t.Fatalf("SkillSet.ToMap failed: %v", err)
		}
		for _, k := range toStringSlice(tc.Data["expected_skills"]) {
			if _, ok := dict[k]; !ok {
				t.Fatalf("expected skill key %q in %v", k, sortedMapKeys(dict))
			}
		}
		if expFiles, ok := tc.Data["expected_skill_files"].(map[string]any); ok {
			for k, rawRel := range expFiles {
				rel, _ := rawRel.(string)
				golden, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(rel)))
				if err != nil {
					t.Fatalf("ReadFile(%s) failed: %v", rel, err)
				}
				if dict[k] != string(golden) {
					t.Fatalf("skill file %s mismatch against %s:\ngot:\n%s\nwant:\n%s", k, rel, dict[k], string(golden))
				}
			}
		}

	default:
		t.Fatalf("unknown skill action %q", tc.Action)
	}
	return ""
}
