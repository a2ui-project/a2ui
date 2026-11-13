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
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/a2ui-project/a2ui/go/core"
)

var (
	handleRPCCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalog", "expect", "expectError", "protocolVersion",
	))
	handleRPCArgsKeys = keySet(
		"afterCall", "catalogId", "catalogVersion", "dataModel", "functionMetadata",
		"inboundResponse", "lateInboundResponse", "message", "outboundCall",
		"outboundListener", "secondOutboundCall", "surfaceId",
		"uiActionFallbackScenario", "uiBindingScenario", "userActivationPresent",
	)
	handleRPCExpectKeys = keySet(
		"correlatedCallId", "dataModel", "error", "inFlightError", "initialValue",
		"lateResponseIgnored", "outboundCall", "resolvedValue", "response",
		"result", "siblings", "surfaceError", "validationResult",
	)
	uiBindingScenarioKeys = keySet(
		"catalogId", "component", "components", "inboundResponseError",
		"inboundResponseValue", "localFunctions", "observe", "surfaceId",
	)
	uiActionFallbackScenarioKeys = keySet(
		"actionPayload", "catalogId", "inboundResponseError",
		"inboundResponseValue", "localFunctions", "surfaceId",
	)

	routeAgentFunctionCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "catalogs", "dataModel", "protocolVersion", "steps", "surface",
	))
	routeAgentCatalogSpecKeys = keySet("agentFunctions", "catalogId", "localFunctions")
	routeAgentSurfaceSpecKeys = keySet("catalogId", "outboundListener")
	routeAgentStepKeys        = keySet(
		"as", "cancelSurfaceCalls", "deleteSurface", "evaluate",
		"expectActions", "expectErrors", "expectOutbound", "expectValues",
		"outboundInAnyOrder", "respond", "updateData",
	)

	nodeResolutionCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "expect", "fixture", "steps",
	))
	nodeFixtureKeys = keySet("catalog", "components", "data", "surface")
	nodeExpectKeys  = keySet(
		"created_emissions", "nodes", "emissions", "metadata_emissions",
		"destroyed", "same_nodes", "replaced_nodes", "data",
		"events", "functions", "errors",
	)
	nodeFieldKeys = keySet(
		"component_id", "type", "state", "data_path", "metadata",
		"isValid", "validationErrors", "validationResults", "props",
	)
	nodeStepKeysByOp = map[string]map[string]bool{
		"set_data":          keySet("op", "path", "value", "expect"),
		"update_components": keySet("op", "components", "expect"),
		"remove_component":  keySet("op", "component_id", "expect"),
		"process_messages":  keySet("op", "messages", "expect"),
		"write":             keySet("op", "node", "property", "value", "expect"),
		"invoke":            keySet("op", "node", "property", "metadata", "expect"),
		"dispose":           keySet("op", "expect"),
	}
)

func makeMockRPCExecutor(name string) core.FunctionEvaluator {
	return func(fnArgs map[string]any, _ *core.DataContext) (any, error) {
		switch name {
		case "playMedia":
			return map[string]any{"playing": true, "timestamp": int64(0)}, nil
		case "openExternalUrl":
			return map[string]any{"opened": true}, nil
		case "syncState":
			return nil, nil
		case "failingFunction":
			return nil, fmt.Errorf("An error occurred during function execution.")
		case "calculateTax":
			amt, _ := toFloatNumeric(fnArgs["amount"])
			return amt * 0.1, nil
		case "echoArgs":
			out := map[string]any{}
			for k, v := range fnArgs {
				out[k] = v
			}
			return out, nil
		default:
			return nil, nil
		}
	}
}

func buildRPCMockFunctions(fnMetadata map[string]any) []core.FunctionAPI {
	var funcs []core.FunctionAPI
	var names []string
	for k := range fnMetadata {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, fnName := range names {
		meta, _ := fnMetadata[fnName].(map[string]any)
		allowed := core.AllowedCallersRendererOrAgent
		if ac, ok := meta["allowedCallers"].(string); ok && ac != "" {
			allowed = core.AllowedCallers(ac)
		}
		reqAct := meta["requiresUserActivation"] == true
		fnSchema, _ := meta["schema"].(map[string]any)
		if fnSchema == nil {
			fnSchema, _ = meta["parameters"].(map[string]any)
		}
		if fnSchema == nil {
			fnSchema = map[string]any{"type": "object"}
		}
		rt := core.ReturnTypeAny
		if rStr, ok := meta["returnType"].(string); ok && rStr != "" {
			rt = core.FunctionReturnType(rStr)
		}
		funcs = append(funcs, core.FunctionAPI{
			Name:                   fnName,
			ReturnType:             rt,
			Schema:                 fnSchema,
			AllowedCallers:         allowed,
			RequiresUserActivation: reqAct,
			Evaluate:               makeMockRPCExecutor(fnName),
		})
	}
	return funcs
}

func functionAPIsAsAny(fns []core.FunctionAPI) []any {
	out := make([]any, len(fns))
	for i, fn := range fns {
		out[i] = fn
	}
	return out
}

func buildScenarioLocalFunctions(specMap map[string]any) []core.FunctionAPI {
	if len(specMap) == 0 {
		return nil
	}
	var names []string
	for k := range specMap {
		names = append(names, k)
	}
	sort.Strings(names)
	var out []core.FunctionAPI
	for _, fnName := range names {
		spec, _ := specMap[fnName].(map[string]any)
		rt := core.ReturnTypeAny
		if rStr, ok := spec["returnType"].(string); ok && rStr != "" {
			rt = core.FunctionReturnType(rStr)
		}
		eff, _ := spec["effect"].(map[string]any)
		setData, _ := eff["setData"].(map[string]any)
		sdCopy := setData
		out = append(out, core.FunctionAPI{
			Name:       fnName,
			ReturnType: rt,
			Schema:     map[string]any{"type": "object"},
			Evaluate: func(_ map[string]any, evalCtx *core.DataContext) (any, error) {
				if sdCopy != nil && evalCtx != nil && evalCtx.Model != nil {
					if p, ok := sdCopy["path"].(string); ok && p != "" {
						_ = evalCtx.Model.Set(p, sdCopy["value"])
					}
				}
				return nil, nil
			},
		})
	}
	return out
}

func startRPCOutboundCall(proc *core.MessageProcessor, spec map[string]any) (*core.AgentCallFuture, error) {
	callFn, _ := spec["callFunction"].(map[string]any)
	callName, _ := callFn["@call"].(string)
	if callName == "" {
		callName, _ = callFn["call"].(string)
	}
	catID, _ := callFn["catalogId"].(string)
	if catID == "" {
		catID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
	}
	argsMap, _ := callFn["args"].(map[string]any)
	surfaceID, _ := spec["surfaceId"].(string)
	fcID, _ := spec["functionCallId"].(string)
	var timeoutPtr *time.Duration
	if rawT, hasT := spec["timeoutMs"]; hasT && rawT != nil {
		if tf, ok := toFloatNumeric(rawT); ok {
			d := time.Duration(tf * float64(time.Millisecond))
			timeoutPtr = &d
		}
	}
	return proc.RPC.CallAgentFunction(surfaceID, core.CallFunctionPayload{
		Call:      callName,
		CatalogID: catID,
		Args:      argsMap,
	}, &core.AgentCallOptions{
		FunctionCallID: fcID,
		Version:        core.Version1_0,
		Timeout:        timeoutPtr,
	})
}

func assertOutboundCallAgentMessage(t *testing.T, caseKey string, outboundMsgs []map[string]any, expectedOutbound map[string]any) string {
	t.Helper()
	var callMsgs []map[string]any
	for _, m := range outboundMsgs {
		if _, has := m["callAgentFunction"]; has {
			callMsgs = append(callMsgs, m)
		}
	}
	if len(callMsgs) != 1 {
		t.Fatalf("%s: expected 1 outbound callAgentFunction message, got %v", caseKey, callMsgs)
	}
	actual := callMsgs[0]
	if actual["version"] != expectedOutbound["version"] {
		t.Fatalf("%s: outbound version got %v, want %v", caseKey, actual["version"], expectedOutbound["version"])
	}
	actCall, _ := actual["callAgentFunction"].(map[string]any)
	expCall, _ := expectedOutbound["callAgentFunction"].(map[string]any)
	if actCall["surfaceId"] != expCall["surfaceId"] {
		t.Fatalf("%s: outbound surfaceId got %v, want %v", caseKey, actCall["surfaceId"], expCall["surfaceId"])
	}
	if !jsonValuesEqual(actCall["callFunction"], expCall["callFunction"]) {
		t.Fatalf("%s: outbound callFunction got %v, want %v", caseKey, actCall["callFunction"], expCall["callFunction"])
	}
	fcID, _ := actCall["functionCallId"].(string)
	if fcID == "" {
		t.Fatalf("%s: expected non-empty functionCallId", caseKey)
	}
	return fcID
}

func findNodeByComponentID(node any, compID string) *core.ComponentNode {
	if node == nil {
		return nil
	}
	switch typed := node.(type) {
	case *core.ComponentNode:
		if typed == nil {
			return nil
		}
		if typed.ComponentID == compID {
			return typed
		}
		for _, val := range typed.Props {
			if found := findNodeByComponentID(val, compID); found != nil {
				return found
			}
		}
	case []any:
		for _, item := range typed {
			if found := findNodeByComponentID(item, compID); found != nil {
				return found
			}
		}
	case map[string]any:
		for _, val := range typed {
			if found := findNodeByComponentID(val, compID); found != nil {
				return found
			}
		}
	}
	return nil
}

func assertSurfaceErrorForRPC(t *testing.T, caseKey string, surfErrors []map[string]any, expErr map[string]any, outboundCallID string) {
	t.Helper()
	if expErr == nil {
		return
	}
	if len(surfErrors) == 0 {
		t.Fatalf("%s: expected surfaceError %v, got none", caseKey, expErr)
	}
	actual := surfErrors[0]
	if expCode, ok := expErr["code"].(string); ok && actual["code"] != expCode {
		t.Fatalf("%s: surfaceError.code got %v, want %q", caseKey, actual["code"], expCode)
	}
	if expFC, ok := expErr["functionCallId"].(string); ok {
		want := expFC
		if want == "$outboundCallId" {
			want = outboundCallID
		}
		if actual["functionCallId"] != want {
			t.Fatalf("%s: surfaceError.functionCallId got %v, want %q", caseKey, actual["functionCallId"], want)
		}
	}
}

func validateHandleRPCCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, handleRPCCaseKeys, "case key", caseKey)
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, handleRPCArgsKeys, "args key", caseKey)
	expDict, _ := caseMap["expect"].(map[string]any)
	assertKnownKeys(t, expDict, handleRPCExpectKeys, "expect key", caseKey)

	message := argsMap["message"]
	outboundCall, hasOutboundCall := argsMap["outboundCall"].(map[string]any)
	inboundResp := argsMap["inboundResponse"]
	fnMeta, _ := argsMap["functionMetadata"].(map[string]any)
	userAct := argsMap["userActivationPresent"] == true

	funcs := buildRPCMockFunctions(fnMeta)
	catID, _ := argsMap["catalogId"].(string)
	if catID == "" {
		if msgMap, ok := message.(map[string]any); ok {
			if crf, ok := msgMap["callRendererFunction"].(map[string]any); ok {
				if cf, ok := crf["callFunction"].(map[string]any); ok {
					msgCatID, _ := cf["catalogId"].(string)
					respMap, _ := expDict["response"].(map[string]any)
					rfr, _ := respMap["rendererFunctionResponse"].(map[string]any)
					rErr, _ := rfr["error"].(map[string]any)
					rErrMsg, _ := rErr["message"].(string)
					if !strings.Contains(rErrMsg, "Catalog not found") {
						catID = msgCatID
					}
				}
			}
		}
	}
	if catID == "" && hasOutboundCall {
		if cf, ok := outboundCall["callFunction"].(map[string]any); ok {
			catID, _ = cf["catalogId"].(string)
		}
	}
	if catID == "" {
		catID = "basic"
	}
	catSpec, _ := caseMap["catalog"].(map[string]any)
	catVer, _ := argsMap["catalogVersion"].(string)
	if catVer == "" {
		catVer, _ = catSpec["protocolVersion"].(string)
	}
	if catVer == "" {
		catVer, _ = caseMap["protocolVersion"].(string)
	}
	if catVer == "" {
		catVer = "1.0"
	}

	v10Cat := mustBasicCatalog(t, core.Version1_0)
	mainFns := make([]any, 0, len(funcs))
	seenFn := map[string]bool{}
	for _, f := range funcs {
		seenFn[f.Name] = true
		mainFns = append(mainFns, f)
	}
	if catID == "basic" {
		for _, name := range v10Cat.FunctionNames() {
			if !seenFn[name] {
				mainFns = append(mainFns, name)
			}
		}
	}
	mainCat := deriveTestCatalog(t, v10Cat, catID, catVer, []any{}, mainFns)
	catalogs := []*core.Catalog{mainCat}
	if catID != "basic" {
		catalogs = append(catalogs, deriveTestCatalog(t, v10Cat, "basic", catVer, []any{}, nil))
	}

	var outboundMessages []map[string]any
	var capturedRendererErrors []map[string]any
	hasListener := argsMap["outboundListener"] != false
	var outListener core.OutboundListener
	if hasListener {
		outListener = func(msg map[string]any) {
			outboundMessages = append(outboundMessages, msg)
		}
	}
	proc, err := core.NewMessageProcessor(catalogs, &core.MessageProcessorOptions{
		OutboundListener: outListener,
		ErrorHandler: func(env map[string]any) {
			capturedRendererErrors = append(capturedRendererErrors, env)
		},
	})
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}

	if setupSID, ok := argsMap["surfaceId"].(string); ok && setupSID != "" {
		setupSurf := core.NewSurfaceModel(setupSID, mainCat.CatalogID(), mainCat)
		for _, c := range catalogs {
			setupSurf.AvailableCatalogs[c.CatalogID()] = c
		}
		if dmMap, ok := argsMap["dataModel"].(map[string]any); ok {
			_ = setupSurf.DataModel.Set("/", dmMap)
		}
		proc.Model.AddSurface(setupSurf)
	}

	handled := false
	if message != nil {
		expErr := caseMap["expectError"]
		if expErr == nil {
			expErr = expDict["error"]
		}
		if expErr != nil {
			err := proc.ProcessPayload(message, nil)
			assertErrorExpectation(t, caseKey, expErr, err, capturedRendererErrors)
		} else if _, hasRespKey := expDict["response"]; hasRespKey {
			resps, err := proc.ProcessPayloadWithResponses(message, &core.ExecutionContext{IsUserActivated: userAct})
			if err != nil {
				t.Fatalf("%s: ProcessPayloadWithResponses: %v", caseKey, err)
			}
			expResp := expDict["response"]
			if expResp == nil {
				if len(resps) != 0 {
					t.Fatalf("%s: expected 0 responses, got %v", caseKey, resps)
				}
				if len(capturedRendererErrors) != 0 || proc.RPC.PendingCount() != 0 {
					t.Fatalf("%s: expected ignored message with 0 errors and 0 pending calls", caseKey)
				}
			} else if expRespMap, ok := expResp.(map[string]any); ok {
				if len(resps) != 1 {
					t.Fatalf("%s: expected 1 response, got %v", caseKey, resps)
				}
				actual := resps[0]
				if actual["version"] != expRespMap["version"] {
					t.Fatalf("%s: response.version got %v, want %v", caseKey, actual["version"], expRespMap["version"])
				}
				actRF, _ := actual["rendererFunctionResponse"].(map[string]any)
				expRF, _ := expRespMap["rendererFunctionResponse"].(map[string]any)
				if actRF["functionCallId"] != expRF["functionCallId"] {
					t.Fatalf("%s: functionCallId got %v, want %v", caseKey, actRF["functionCallId"], expRF["functionCallId"])
				}
				if expVal, hasVal := expRF["value"]; hasVal {
					if !jsonValuesEqual(actRF["value"], expVal) {
						t.Fatalf("%s: response.value got %v, want %v", caseKey, actRF["value"], expVal)
					}
				}
				if expErrObj, hasErrObj := expRF["error"].(map[string]any); hasErrObj {
					actErrObj, _ := actRF["error"].(map[string]any)
					if actErrObj["code"] != expErrObj["code"] {
						t.Fatalf("%s: response.error.code got %v, want %v", caseKey, actErrObj["code"], expErrObj["code"])
					}
					if expMsg, ok := expErrObj["message"].(string); ok {
						actMsg, _ := actErrObj["message"].(string)
						if !strings.Contains(actMsg, expMsg) {
							t.Fatalf("%s: response.error.message got %q, want substring %q", caseKey, actMsg, expMsg)
						}
					}
				}
			}
		} else {
			t.Fatalf("%s: inbound handle_rpc case missing expectation", caseKey)
		}
		handled = true
	}

	hasErr := caseMap["expectError"] != nil || expDict["error"] != nil
	if hasOutboundCall && inboundResp != nil && !hasErr {
		if corrID, ok := expDict["correlatedCallId"].(string); ok {
			irMap, _ := inboundResp.(map[string]any)
			afr, _ := irMap["agentFunctionResponse"].(map[string]any)
			if afr["functionCallId"] != corrID {
				t.Fatalf("%s: correlatedCallId mismatch", caseKey)
			}
		}
		fut, err := startRPCOutboundCall(proc, outboundCall)
		if err != nil {
			t.Fatalf("%s: startRPCOutboundCall: %v", caseKey, err)
		}
		if err := proc.ProcessPayload(inboundResp, nil); err != nil {
			t.Fatalf("%s: ProcessPayload inboundResponse: %v", caseKey, err)
		}
		got, err := fut.Wait(context.Background())
		if err != nil {
			t.Fatalf("%s: fut.Wait: %v", caseKey, err)
		}
		if !jsonValuesEqual(got, expDict["result"]) {
			t.Fatalf("%s: outbound RPC result got %v, want %v", caseKey, got, expDict["result"])
		}
		handled = true
	} else if hasOutboundCall && hasErr {
		expErrMap, _ := caseMap["expectError"].(map[string]any)
		if expErrMap == nil {
			expErrMap, _ = expDict["error"].(map[string]any)
		}
		checkLateIgnored := func() {
			late := argsMap["lateInboundResponse"]
			if late == nil {
				return
			}
			beforeOut := len(outboundMessages)
			beforeErr := len(capturedRendererErrors)
			_ = proc.ProcessPayload(late, nil)
			if expDict["lateResponseIgnored"] == true {
				if len(outboundMessages) != beforeOut || len(capturedRendererErrors) != beforeErr || proc.RPC.PendingCount() != 0 {
					t.Fatalf("%s: lateInboundResponse was not ignored cleanly", caseKey)
				}
			}
		}
		assertRPCCode := func(err error, want string) {
			var re *core.RPCError
			if !errors.As(err, &re) {
				t.Fatalf("%s: expected *core.RPCError(%s), got %T (%v)", caseKey, want, err, err)
			}
			if want != "" && string(re.RPCCode) != want {
				t.Fatalf("%s: RPCError code got %q, want %q", caseKey, re.RPCCode, want)
			}
		}
		wantCode, _ := expErrMap["code"].(string)

		if argsMap["outboundListener"] == false {
			_, err := startRPCOutboundCall(proc, outboundCall)
			if wantCode == "" {
				wantCode = "NO_LISTENER"
			}
			assertRPCCode(err, wantCode)
		} else if secondCall, hasSecond := argsMap["secondOutboundCall"].(map[string]any); hasSecond {
			_, err1 := startRPCOutboundCall(proc, outboundCall)
			if err1 != nil {
				t.Fatalf("%s: first call failed: %v", caseKey, err1)
			}
			_, err2 := startRPCOutboundCall(proc, secondCall)
			if wantCode == "" {
				wantCode = "DUPLICATE"
			}
			assertRPCCode(err2, wantCode)
			proc.RPC.CancelSurfaceCalls("")
		} else if inboundResp != nil {
			fut, err1 := startRPCOutboundCall(proc, outboundCall)
			if err1 != nil {
				t.Fatalf("%s: startRPCOutboundCall: %v", caseKey, err1)
			}
			if err := proc.ProcessPayload(inboundResp, nil); err != nil {
				t.Fatalf("%s: ProcessPayload inbound error response: %v", caseKey, err)
			}
			_, waitErr := fut.Wait(context.Background())
			assertRPCCode(waitErr, wantCode)
			if expMsg, ok := expErrMap["message"].(string); ok && !strings.Contains(waitErr.Error(), expMsg) {
				t.Fatalf("%s: expected message %q in %q", caseKey, expMsg, waitErr.Error())
			}
		} else if argsMap["afterCall"] == "cancel" {
			fut, err1 := startRPCOutboundCall(proc, outboundCall)
			if err1 != nil {
				t.Fatalf("%s: startRPCOutboundCall: %v", caseKey, err1)
			}
			sid, _ := outboundCall["surfaceId"].(string)
			proc.RPC.CancelSurfaceCalls(sid)
			_, waitErr := fut.Wait(context.Background())
			if wantCode == "" {
				wantCode = "CANCELLED"
			}
			assertRPCCode(waitErr, wantCode)
		} else if argsMap["afterCall"] == "dispose" {
			fut, err1 := startRPCOutboundCall(proc, outboundCall)
			if err1 != nil {
				t.Fatalf("%s: startRPCOutboundCall: %v", caseKey, err1)
			}
			proc.RPC.Dispose()
			_, inFlightErr := fut.Wait(context.Background())
			inFlightSpec, _ := expDict["inFlightError"].(map[string]any)
			inFlightCode, _ := inFlightSpec["code"].(string)
			if inFlightCode == "" {
				inFlightCode = "CANCELLED"
			}
			assertRPCCode(inFlightErr, inFlightCode)
			_, subErr := startRPCOutboundCall(proc, outboundCall)
			if wantCode == "" {
				wantCode = "DISPOSED"
			}
			assertRPCCode(subErr, wantCode)
			checkLateIgnored()
		} else if _, hasTimeout := outboundCall["timeoutMs"]; hasTimeout {
			fut, err1 := startRPCOutboundCall(proc, outboundCall)
			if err1 != nil {
				t.Fatalf("%s: startRPCOutboundCall: %v", caseKey, err1)
			}
			_, waitErr := fut.Wait(context.Background())
			if wantCode == "" {
				wantCode = "TIMEOUT"
			}
			assertRPCCode(waitErr, wantCode)
			checkLateIgnored()
		} else {
			t.Fatalf("%s: unhandled outboundCall error scenario", caseKey)
		}
		handled = true
	}

	if scenario, hasUIBind := argsMap["uiBindingScenario"].(map[string]any); hasUIBind {
		assertKnownKeys(t, scenario, uiBindingScenarioKeys, "args.uiBindingScenario key", caseKey)
		sID, _ := scenario["surfaceId"].(string)
		sCatID, _ := scenario["catalogId"].(string)
		localSpecs, _ := scenario["localFunctions"].(map[string]any)
		sCat := deriveTestCatalog(t, v10Cat, sCatID, "1.0", nil, functionAPIsAsAny(buildScenarioLocalFunctions(localSpecs)))
		proc.AddCatalog(sCat)
		if err := proc.ProcessPayload(map[string]any{
			"version":       "1.0",
			"createSurface": map[string]any{"surfaceId": sID, "catalogId": sCatID},
		}, nil); err != nil {
			t.Fatalf("%s: createSurface: %v", caseKey, err)
		}
		surf := proc.Model.Surface(sID)
		var surfErrors []map[string]any
		surf.OnError = append(surf.OnError, func(e map[string]any) { surfErrors = append(surfErrors, e) })

		var rawComps []any
		if cs, ok := scenario["components"].([]any); ok {
			rawComps = cs
		} else if c, ok := scenario["component"].(map[string]any); ok {
			rawComps = []any{c}
		}
		for _, rc := range rawComps {
			cmMap, _ := rc.(map[string]any)
			cID, _ := cmMap["id"].(string)
			cType, _ := cmMap["component"].(string)
			props := map[string]any{}
			for k, v := range cmMap {
				if k != "id" && k != "component" {
					props[k] = core.CloneJSONValue(v)
				}
			}
			cm, err := core.NewComponentModel(cID, cType, sCat, props, nil)
			if err != nil {
				t.Fatalf("%s: NewComponentModel: %v", caseKey, err)
			}
			surf.ComponentsModel.Upsert(cm)
		}
		resolver := core.NewNodeResolver(surf, sCat)
		defer func() {
			resolver.Dispose()
			surf.Dispose()
		}()

		root := resolver.Root()
		if root == nil {
			t.Fatalf("%s: expected mounted root node", caseKey)
		}
		obsSpec, _ := scenario["observe"].(map[string]any)
		obsID, _ := obsSpec["componentId"].(string)
		if obsID == "" {
			obsID = "root"
		}
		obsProp, _ := obsSpec["property"].(string)
		if obsProp == "" {
			obsProp = "text"
		}
		obsNode := findNodeByComponentID(root, obsID)
		if obsNode == nil {
			t.Fatalf("%s: observed node %q not found", caseKey, obsID)
		}
		if initExp, hasInit := expDict["initialValue"]; hasInit {
			rawB := obsNode.Props[obsProp]
			actual := rawB
			if rb, ok := rawB.(*core.ResolvedBinding); ok {
				actual = rb.Value
			}
			if !jsonValuesEqual(actual, initExp) {
				t.Fatalf("%s: initialValue got %v, want %v", caseKey, actual, initExp)
			}
		}

		expOutMap, _ := expDict["outboundCall"].(map[string]any)
		callID := assertOutboundCallAgentMessage(t, caseKey, outboundMessages, expOutMap)
		respPayload := map[string]any{"functionCallId": callID}
		if inErr, hasInErr := scenario["inboundResponseError"]; hasInErr {
			respPayload["error"] = inErr
		} else {
			respPayload["value"] = scenario["inboundResponseValue"]
		}
		if err := proc.ProcessPayload(map[string]any{"version": "1.0", "agentFunctionResponse": respPayload}, nil); err != nil {
			t.Fatalf("%s: agentFunctionResponse: %v", caseKey, err)
		}

		obsNode = findNodeByComponentID(resolver.Root(), obsID)
		if resExp, hasRes := expDict["resolvedValue"]; hasRes {
			rawB := obsNode.Props[obsProp]
			actual := rawB
			if rb, ok := rawB.(*core.ResolvedBinding); ok {
				actual = rb.Value
			}
			if !jsonValuesEqual(actual, resExp) {
				t.Fatalf("%s: resolvedValue got %v, want %v", caseKey, actual, resExp)
			}
		}
		if sibs, ok := expDict["siblings"].(map[string]any); ok {
			for sibID, rawSibProps := range sibs {
				sibNode := findNodeByComponentID(resolver.Root(), sibID)
				if sibNode == nil {
					t.Fatalf("%s: sibling %q not found", caseKey, sibID)
				}
				sibProps, _ := rawSibProps.(map[string]any)
				for pk, pv := range sibProps {
					rawP := sibNode.Props[pk]
					actP := rawP
					if rb, ok := rawP.(*core.ResolvedBinding); ok {
						actP = rb.Value
					}
					if !jsonValuesEqual(actP, pv) {
						t.Fatalf("%s: sibling %s.%s got %v, want %v", caseKey, sibID, pk, actP, pv)
					}
				}
			}
		}
		if expVR, ok := expDict["validationResult"].(map[string]any); ok {
			if expValid, ok := expVR["valid"].(bool); ok && obsNode.IsValid != expValid {
				t.Fatalf("%s: obsNode.IsValid got %v, want %v", caseKey, obsNode.IsValid, expValid)
			}
			if expMsg, ok := expVR["message"].(string); ok {
				var firstMsg string
				if len(obsNode.ValidationResults) > 0 {
					firstMsg, _ = obsNode.ValidationResults[0]["message"].(string)
				} else if len(obsNode.ValidationErrors) > 0 {
					firstMsg = obsNode.ValidationErrors[0]
				}
				if firstMsg != expMsg {
					t.Fatalf("%s: validationResult.message got %q, want %q", caseKey, firstMsg, expMsg)
				}
			}
			if expSev, ok := expVR["severity"].(string); ok {
				if len(obsNode.ValidationResults) == 0 || obsNode.ValidationResults[0]["severity"] != expSev {
					t.Fatalf("%s: validationResult.severity mismatch, got %v", caseKey, obsNode.ValidationResults)
				}
			}
			if expErrs, ok := expVR["errors"]; ok {
				if !jsonValuesEqual(obsNode.ValidationErrors, expErrs) {
					t.Fatalf("%s: validationErrors got %v, want %v", caseKey, obsNode.ValidationErrors, expErrs)
				}
			}
		}
		expSurfErr, _ := expDict["surfaceError"].(map[string]any)
		assertSurfaceErrorForRPC(t, caseKey, surfErrors, expSurfErr, callID)
		handled = true
	}

	if scenario, hasUIAct := argsMap["uiActionFallbackScenario"].(map[string]any); hasUIAct {
		assertKnownKeys(t, scenario, uiActionFallbackScenarioKeys, "args.uiActionFallbackScenario key", caseKey)
		sID, _ := scenario["surfaceId"].(string)
		sCatID, _ := scenario["catalogId"].(string)
		localSpecs, _ := scenario["localFunctions"].(map[string]any)
		sCat := deriveTestCatalog(t, v10Cat, sCatID, "1.0", []any{}, functionAPIsAsAny(buildScenarioLocalFunctions(localSpecs)))
		proc.AddCatalog(sCat)
		if err := proc.ProcessPayload(map[string]any{
			"version":       "1.0",
			"createSurface": map[string]any{"surfaceId": sID, "catalogId": sCatID},
		}, nil); err != nil {
			t.Fatalf("%s: createSurface: %v", caseKey, err)
		}
		surf := proc.Model.Surface(sID)
		defer surf.Dispose()
		var surfErrors []map[string]any
		surf.OnError = append(surf.OnError, func(e map[string]any) { surfErrors = append(surfErrors, e) })
		ctx := core.NewDataContext(surf, "/")
		actPayload, _ := scenario["actionPayload"].(map[string]any)
		actionRes := ctx.ResolveAction(actPayload, true)

		expOutMap, _ := expDict["outboundCall"].(map[string]any)
		callID := assertOutboundCallAgentMessage(t, caseKey, outboundMessages, expOutMap)
		respPayload := map[string]any{"functionCallId": callID}
		if inErr, hasInErr := scenario["inboundResponseError"]; hasInErr {
			respPayload["error"] = inErr
		} else {
			respPayload["value"] = scenario["inboundResponseValue"]
		}
		if err := proc.ProcessPayload(map[string]any{"version": "1.0", "agentFunctionResponse": respPayload}, nil); err != nil {
			t.Fatalf("%s: agentFunctionResponse: %v", caseKey, err)
		}
		if expRes, hasRes := expDict["result"]; hasRes {
			gotRes := actionRes
			if pr, ok := actionRes.(*core.PendingResult); ok {
				gotRes = pr.Peek()
			}
			if !jsonValuesEqual(gotRes, expRes) {
				t.Fatalf("%s: action fallback result got %v, want %v", caseKey, gotRes, expRes)
			}
		}
		if expDM, hasDM := expDict["dataModel"]; hasDM {
			gotDM, _, _ := surf.DataModel.Get("/")
			if !jsonValuesEqual(gotDM, expDM) {
				t.Fatalf("%s: action fallback dataModel got %v, want %v", caseKey, gotDM, expDM)
			}
		}
		expSurfErr, _ := expDict["surfaceError"].(map[string]any)
		assertSurfaceErrorForRPC(t, caseKey, surfErrors, expSurfErr, callID)
		handled = true
	}

	if !handled {
		t.Fatalf("%s: no handle_rpc scenario branch matched", caseKey)
	}
}

func validateRouteAgentFunctionCase(t *testing.T, caseKey string, caseMap map[string]any, caseKeyOrder map[string][]string) {
	t.Helper()
	assertKnownKeys(t, caseMap, routeAgentFunctionCaseKeys, "case key", caseKey)
	rawVer, _ := caseMap["protocolVersion"].(string)
	normVer := strings.TrimPrefix(rawVer, "v")
	wireVer := "v" + normVer
	if normVer == "1.0" {
		wireVer = "1.0"
	}

	basic := mustBasicCatalog(t, core.Version0_9)
	if normVer == "1.0" {
		basic = mustBasicCatalog(t, core.Version1_0)
	}
	var catalogs []*core.Catalog
	rawCatSpecs, _ := caseMap["catalogs"].([]any)
	for idx, rcs := range rawCatSpecs {
		spec, _ := rcs.(map[string]any)
		assertKnownKeys(t, spec, routeAgentCatalogSpecKeys, fmt.Sprintf("catalogs[%d] key", idx), caseKey)
		var fns []any
		if locals, ok := spec["localFunctions"].([]any); ok {
			for _, rl := range locals {
				name, _ := rl.(string)
				fns = append(fns, name)
			}
		}
		if agents, ok := spec["agentFunctions"].(map[string]any); ok {
			var aNames []string
			for k := range agents {
				aNames = append(aNames, k)
			}
			sort.Strings(aNames)
			for _, name := range aNames {
				decl, _ := agents[name].(map[string]any)
				argsS, _ := decl["args"].(map[string]any)
				rt := core.ReturnTypeAny
				if rStr, ok := decl["returnType"].(string); ok && rStr != "" {
					rt = core.FunctionReturnType(rStr)
				}
				ac := core.AllowedCallersRendererOnly
				if acStr, ok := decl["allowedCallers"].(string); ok && acStr != "" {
					ac = core.AllowedCallers(acStr)
				}
				rua := decl["requiresUserActivation"] == true
				fns = append(fns, core.FunctionAPI{
					Name:                   name,
					Schema:                 argsS,
					ReturnType:             rt,
					AllowedCallers:         ac,
					RequiresUserActivation: rua,
				})
			}
		}
		cID, _ := spec["catalogId"].(string)
		if fns == nil {
			fns = []any{}
		}
		catalogs = append(catalogs, deriveTestCatalog(t, basic, cID, normVer, []any{}, fns))
	}

	surfSpec, _ := caseMap["surface"].(map[string]any)
	if surfSpec != nil {
		assertKnownKeys(t, surfSpec, routeAgentSurfaceSpecKeys, "surface key", caseKey)
	}
	var outbound []map[string]any
	var outListener core.OutboundListener
	if surfSpec["outboundListener"] != false {
		outListener = func(msg map[string]any) {
			outbound = append(outbound, msg)
		}
	}
	proc, err := core.NewMessageProcessor(catalogs, &core.MessageProcessorOptions{
		OutboundListener: outListener,
	})
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}
	createSurface := map[string]any{"surfaceId": "main"}
	if cid, ok := surfSpec["catalogId"]; ok {
		createSurface["catalogId"] = cid
	}
	if err := proc.ProcessPayload([]any{map[string]any{"version": wireVer, "createSurface": createSurface}}, nil); err != nil {
		t.Fatalf("%s: createSurface: %v", caseKey, err)
	}
	surf := proc.Model.Surface("main")
	if dmInit, hasDM := caseMap["dataModel"]; hasDM && dmInit != nil {
		if err := surf.DataModel.Set("/", dmInit); err != nil {
			t.Fatalf("%s: DataModel.Set(/): %v", caseKey, err)
		}
	}

	var reportedErrors []map[string]any
	surf.OnError = append(surf.OnError, func(e map[string]any) { reportedErrors = append(reportedErrors, e) })
	var dispatchedActions []map[string]any
	surf.OnAction = append(surf.OnAction, func(a map[string]any) { dispatchedActions = append(dispatchedActions, a) })

	ctx := core.NewDataContext(surf, "/")
	var values []any
	var evaluations []func() any
	var disposables []func()
	defer func() {
		for _, d := range disposables {
			d()
		}
	}()

	outboundSeen := 0
	errorsSeen := 0
	actionsSeen := 0

	rawSteps, _ := caseMap["steps"].([]any)
	for index, rs := range rawSteps {
		step, _ := rs.(map[string]any)
		assertKnownKeys(t, step, routeAgentStepKeys, fmt.Sprintf("steps[%d] key", index), caseKey)
		label := fmt.Sprintf("%s step %d", caseKey, index)

		if evalExpr, hasEval := step["evaluate"]; hasEval {
			kind, _ := step["as"].(string)
			if kind == "" {
				kind = "binding"
			}
			evalKO := extractSubKeyOrder(caseKeyOrder, fmt.Sprintf("/steps/%d/evaluate", index))
			switch kind {
			case "action":
				_ = ctx.ResolveActionWithKeyOrder(map[string]any{"functionCall": evalExpr}, true, evalKO)
			case "event":
				resolved := ctx.ResolveActionWithKeyOrder(map[string]any{"event": evalExpr}, true, evalKO)
				_ = surf.DispatchResolvedAction(resolved, "probe", nil)
			case "check":
				probeID := fmt.Sprintf("probe_%d", len(evaluations))
				defCat := surf.Catalog
				if defCat == nil && len(proc.Catalogs) > 0 {
					defCat = proc.Catalogs[0]
				}
				cm, err := core.NewComponentModel(probeID, "Probe", defCat, map[string]any{
					"checks": []any{map[string]any{"condition": evalExpr, "message": "Check failed"}},
				}, nil)
				if err != nil {
					t.Fatalf("%s: NewComponentModel: %v", label, err)
				}
				surf.ComponentsModel.Upsert(cm)
				compCtx, _ := core.NewComponentContext(surf, probeID, "/")
				binder := core.NewGenericBinder(compCtx, false)
				disposables = append(disposables, binder.Dispose)
				evaluations = append(evaluations, func() any {
					return binder.CurrentProps["isValid"]
				})
			default:
				slot := len(values)
				values = append(values, nil)
				sub := ctx.SubscribeDynamicValue(evalExpr, func(val any) {
					values[slot] = val
				})
				values[slot] = sub.InitialState.Value
				disposables = append(disposables, sub.Unsubscribe)
				evaluations = append(evaluations, func() any {
					return values[slot]
				})
			}
		} else if respSpec, hasResp := step["respond"].(map[string]any); hasResp {
			callIdxF, _ := toFloatNumeric(respSpec["call"])
			callIdx := int(callIdxF)
			var calls []map[string]any
			for _, m := range outbound {
				if _, ok := m["callAgentFunction"]; ok {
					calls = append(calls, m)
				}
			}
			if callIdx < 0 || callIdx >= len(calls) {
				t.Fatalf("%s: respond call index %d out of range (%d calls)", label, callIdx, len(calls))
			}
			caf, _ := calls[callIdx]["callAgentFunction"].(map[string]any)
			fcID, _ := caf["functionCallId"].(string)
			afr := map[string]any{"functionCallId": fcID}
			for k, v := range respSpec {
				if k != "call" {
					afr[k] = v
				}
			}
			if err := proc.ProcessPayload([]any{map[string]any{"version": "1.0", "agentFunctionResponse": afr}}, nil); err != nil {
				t.Fatalf("%s: ProcessPayload agentFunctionResponse: %v", label, err)
			}
		} else if upd, hasUpd := step["updateData"].(map[string]any); hasUpd {
			p, _ := upd["path"].(string)
			if err := surf.DataModel.Set(p, upd["value"]); err != nil {
				t.Fatalf("%s: updateData Set(%s): %v", label, p, err)
			}
		} else if step["cancelSurfaceCalls"] == true {
			proc.RPC.CancelSurfaceCalls("main")
		} else if step["deleteSurface"] == true {
			if err := proc.ProcessPayload([]any{map[string]any{"version": wireVer, "deleteSurface": map[string]any{"surfaceId": "main"}}}, nil); err != nil {
				t.Fatalf("%s: deleteSurface: %v", label, err)
			}
		} else {
			t.Fatalf("%s: step missing action key", label)
		}

		sent := outbound[outboundSeen:]
		outboundSeen = len(outbound)
		var sentPayloads []any
		for _, m := range sent {
			caf, ok := m["callAgentFunction"].(map[string]any)
			if !ok {
				t.Fatalf("%s: unexpected outbound message %v", label, m)
			}
			if caf["surfaceId"] != "main" {
				t.Fatalf("%s: expected surfaceId 'main', got %v", label, caf["surfaceId"])
			}
			sentPayloads = append(sentPayloads, caf["callFunction"])
		}
		if sentPayloads == nil {
			sentPayloads = []any{}
		}
		expOut, _ := step["expectOutbound"].([]any)
		if expOut == nil {
			expOut = []any{}
		}
		if step["outboundInAnyOrder"] == true {
			sortJSON := func(items []any) []any {
				cp := append([]any(nil), items...)
				sort.Slice(cp, func(i, j int) bool {
					bi, _ := json.Marshal(cp[i])
					bj, _ := json.Marshal(cp[j])
					return string(bi) < string(bj)
				})
				return cp
			}
			sentPayloads = sortJSON(sentPayloads)
			expOut = sortJSON(expOut)
		}
		if !jsonValuesEqual(sentPayloads, expOut) {
			t.Fatalf("%s: outbound callFunction payloads got %v, want %v", label, sentPayloads, expOut)
		}

		rep := reportedErrors[errorsSeen:]
		errorsSeen = len(reportedErrors)
		expErrs, _ := step["expectErrors"].([]any)
		if len(rep) != len(expErrs) {
			t.Fatalf("%s: reported errors count got %d (%v), want %d (%v)", label, len(rep), rep, len(expErrs), expErrs)
		}
		for i, rawExpE := range expErrs {
			ee, _ := rawExpE.(map[string]any)
			ae := rep[i]
			if ae["code"] != ee["code"] {
				t.Fatalf("%s: error[%d].code got %v, want %v", label, i, ae["code"], ee["code"])
			}
			if expM, ok := ee["message"].(string); ok {
				actM, _ := ae["message"].(string)
				if !strings.Contains(actM, expM) {
					t.Fatalf("%s: error[%d].message got %q, want substring %q", label, i, actM, expM)
				}
			}
		}

		disp := dispatchedActions[actionsSeen:]
		actionsSeen = len(dispatchedActions)
		var slimDisp []any
		for _, a := range disp {
			entry := map[string]any{}
			for _, k := range []string{"name", "context", "userMessage"} {
				if v, present := a[k]; present {
					entry[k] = v
				}
			}
			slimDisp = append(slimDisp, entry)
		}
		if slimDisp == nil {
			slimDisp = []any{}
		}
		expActs, _ := step["expectActions"].([]any)
		if expActs == nil {
			expActs = []any{}
		}
		if !jsonValuesEqual(slimDisp, expActs) {
			t.Fatalf("%s: dispatched actions got %v, want %v", label, slimDisp, expActs)
		}

		if expVals, hasExpVals := step["expectValues"].([]any); hasExpVals {
			gotVals := make([]any, len(evaluations))
			for i, readFn := range evaluations {
				gotVals[i] = readFn()
			}
			if !jsonValuesEqual(gotVals, expVals) {
				t.Fatalf("%s: expectValues got %v, want %v", label, gotVals, expVals)
			}
		}
	}
}
