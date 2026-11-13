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

package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/a2ui-project/a2ui/go/core"
)

// DefaultRendererCallTimeout is the default timeout for outbound callRendererFunction calls.
const DefaultRendererCallTimeout = 30 * time.Second

// ProcessResult records whether a renderer-to-agent message was handled and any outbound replies.
type ProcessResult struct {
	Handled bool
	Replies []core.AgentToRendererMessage
}

// RendererToAgentOptions configures a RendererToAgentMessageProcessor.
type RendererToAgentOptions struct {
	// AgentFunctionTimeout bounds each agent function execution when positive.
	// Handlers must respect ctx.Done() so timed-out goroutines exit promptly.
	AgentFunctionTimeout       time.Duration
	OnAction                   func(ctx context.Context, msg *core.RendererToAgentMessage) (bool, error)
	OnError                    func(ctx context.Context, msg *core.RendererToAgentMessage) (bool, error)
	OnRendererFunctionResponse func(ctx context.Context, msg *core.RendererToAgentMessage) (bool, error)
}

type registeredAgentFn struct {
	catalogID string
	catalog   *core.Catalog
	fn        *core.AgentFunction
}

// RendererToAgentMessageProcessor handles v1.0 messages sent from the renderer to the agent.
// A constructed RendererToAgentMessageProcessor is safe for concurrent use by multiple goroutines.
type RendererToAgentMessageProcessor struct {
	catalogs  []*core.Catalog
	catByID   map[string]*core.Catalog
	functions map[string]map[string]registeredAgentFn // catalogID -> fnName -> entry
	fnOrder   map[string][]string                     // fnName -> catalogIDs
	opts      RendererToAgentOptions
}

// NewRendererToAgentMessageProcessor creates a processor for v1.0 renderer-to-agent messages.
func NewRendererToAgentMessageProcessor(catalogs []*core.Catalog, opts *RendererToAgentOptions) (*RendererToAgentMessageProcessor, error) {
	var resolved RendererToAgentOptions
	if opts != nil {
		resolved = *opts
	}
	if resolved.AgentFunctionTimeout < 0 {
		return nil, fmt.Errorf("agent function timeout must be non-negative, got %v", resolved.AgentFunctionTimeout)
	}

	catByID := make(map[string]*core.Catalog, len(catalogs))
	functions := make(map[string]map[string]registeredAgentFn)
	fnOrder := make(map[string][]string)

	for _, cat := range catalogs {
		if cat == nil {
			continue
		}
		cid := cat.CatalogID()
		if _, dup := catByID[cid]; dup {
			return nil, core.NewCatalogErrorf("duplicate catalog ID %q", cid)
		}
		catByID[cid] = cat
		fnMap := make(map[string]registeredAgentFn)
		for name, fn := range cat.AgentFunctions() {
			fnMap[name] = registeredAgentFn{
				catalogID: cid,
				catalog:   cat,
				fn:        fn,
			}
			fnOrder[name] = append(fnOrder[name], cid)
		}
		functions[cid] = fnMap
	}

	return &RendererToAgentMessageProcessor{
		catalogs:  append([]*core.Catalog(nil), catalogs...),
		catByID:   catByID,
		functions: functions,
		fnOrder:   fnOrder,
		opts:      resolved,
	}, nil
}

// ProcessMessage validates and dispatches a typed v1.0 *core.RendererToAgentMessage.
func (p *RendererToAgentMessageProcessor) ProcessMessage(ctx context.Context, msg *core.RendererToAgentMessage) (ProcessResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if msg == nil {
		return ProcessResult{}, core.NewValidationError("renderer-to-agent message must not be nil")
	}
	return p.processTypedMessage(ctx, msg)
}

// ProcessMessageMap validates and dispatches a raw v1.0 renderer-to-agent message map.
func (p *RendererToAgentMessageProcessor) ProcessMessageMap(ctx context.Context, msgMap map[string]any) (ProcessResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if msgMap == nil {
		return ProcessResult{}, core.NewValidationError("a renderer-to-agent message must be a non-nil object")
	}
	ver, _ := msgMap["version"].(string)
	if ver != "1.0" {
		return ProcessResult{}, core.NewValidationErrorf(`a renderer-to-agent message must have "version": "1.0", got %v`, msgMap["version"])
	}

	var keys []string
	for k := range msgMap {
		if k != "version" {
			keys = append(keys, k)
		}
	}
	if len(keys) != 1 {
		sort.Strings(keys)
		return ProcessResult{}, core.NewValidationErrorf("a renderer-to-agent message must have exactly one kind key, got %v", keys)
	}
	kind := keys[0]
	switch kind {
	case "callAgentFunction":
		reply, err := p.handleCallAgentFunctionMap(ctx, msgMap)
		if err != nil {
			return ProcessResult{}, err
		}
		return ProcessResult{Handled: true, Replies: []core.AgentToRendererMessage{reply}}, nil

	case "action":
		if p.opts.OnAction == nil {
			return ProcessResult{Handled: false}, nil
		}
		parsed, err := parseActionMessage(msgMap)
		if err != nil {
			return ProcessResult{}, err
		}
		accepted, err := p.opts.OnAction(ctx, parsed)
		if err != nil {
			return ProcessResult{}, err
		}
		return ProcessResult{Handled: accepted}, nil

	case "error":
		if p.opts.OnError == nil {
			return ProcessResult{Handled: false}, nil
		}
		parsed, err := parseRendererErrorMessage(msgMap)
		if err != nil {
			return ProcessResult{}, err
		}
		accepted, err := p.opts.OnError(ctx, parsed)
		if err != nil {
			return ProcessResult{}, err
		}
		return ProcessResult{Handled: accepted}, nil

	case "rendererFunctionResponse":
		if p.opts.OnRendererFunctionResponse == nil {
			return ProcessResult{Handled: false}, nil
		}
		parsed, err := parseRendererFunctionResponseMessage(msgMap)
		if err != nil {
			return ProcessResult{}, err
		}
		accepted, err := p.opts.OnRendererFunctionResponse(ctx, parsed)
		if err != nil {
			return ProcessResult{}, err
		}
		return ProcessResult{Handled: accepted}, nil

	default:
		return ProcessResult{}, core.NewValidationErrorf("unknown renderer-to-agent message %q", kind)
	}
}

func (p *RendererToAgentMessageProcessor) processTypedMessage(ctx context.Context, msg *core.RendererToAgentMessage) (ProcessResult, error) {
	if msg.Version != "1.0" {
		return ProcessResult{}, core.NewValidationErrorf(`a renderer-to-agent message must have "version": "1.0", got %q`, msg.Version)
	}
	count := 0
	if msg.CallAgentFunction != nil {
		count++
	}
	if msg.Action != nil {
		count++
	}
	if msg.Error != nil {
		count++
	}
	if msg.RendererFunctionResponse != nil {
		count++
	}
	if count != 1 {
		return ProcessResult{}, core.NewValidationError("a renderer-to-agent message must set exactly one payload field")
	}

	if msg.CallAgentFunction != nil {
		call := msg.CallAgentFunction
		if call.FunctionCallID == "" {
			return ProcessResult{}, core.NewValidationError("callAgentFunction has an empty functionCallId")
		}
		if call.CallFunction.CatalogID == "" {
			reply := buildAgentFunctionErrorReply(call.FunctionCallID, core.RPCCodeInvalidFunctionCall, "callFunction 'catalogId' must be a non-empty string")
			return ProcessResult{Handled: true, Replies: []core.AgentToRendererMessage{reply}}, nil
		}
		reply := p.executeAgentFunction(ctx, call.FunctionCallID, call.SurfaceID, call.CallFunction.Call, call.CallFunction.CatalogID, true, call.CallFunction.Args)
		return ProcessResult{Handled: true, Replies: []core.AgentToRendererMessage{reply}}, nil
	}
	if msg.Action != nil {
		if p.opts.OnAction == nil {
			return ProcessResult{Handled: false}, nil
		}
		accepted, err := p.opts.OnAction(ctx, msg)
		return ProcessResult{Handled: accepted}, err
	}
	if msg.Error != nil {
		if p.opts.OnError == nil {
			return ProcessResult{Handled: false}, nil
		}
		accepted, err := p.opts.OnError(ctx, msg)
		return ProcessResult{Handled: accepted}, err
	}
	if p.opts.OnRendererFunctionResponse == nil {
		return ProcessResult{Handled: false}, nil
	}
	accepted, err := p.opts.OnRendererFunctionResponse(ctx, msg)
	return ProcessResult{Handled: accepted}, err
}

func (p *RendererToAgentMessageProcessor) handleCallAgentFunctionMap(ctx context.Context, msgMap map[string]any) (core.AgentToRendererMessage, error) {
	rawCall, ok := msgMap["callAgentFunction"].(map[string]any)
	if !ok || rawCall == nil {
		return nil, core.NewValidationError("malformed callAgentFunction message without a functionCallId")
	}
	callID, hasCallID := rawCall["functionCallId"].(string)
	if !hasCallID || callID == "" {
		return nil, core.NewValidationError("malformed callAgentFunction message without a non-empty functionCallId")
	}

	for _, k := range slices.Sorted(maps.Keys(rawCall)) {
		if k != "surfaceId" && k != "functionCallId" && k != "callFunction" {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, fmt.Sprintf("unrecognized field %q on callAgentFunction", k)), nil
		}
	}
	rawSID, hasSID := rawCall["surfaceId"]
	if !hasSID {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callAgentFunction requires 'surfaceId'"), nil
	}
	surfaceID, ok := rawSID.(string)
	if !ok {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callAgentFunction 'surfaceId' must be a string"), nil
	}

	rawCF, hasCF := rawCall["callFunction"]
	if !hasCF {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callAgentFunction requires 'callFunction'"), nil
	}
	cfMap, ok := rawCF.(map[string]any)
	if !ok || cfMap == nil {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callAgentFunction 'callFunction' must be an object"), nil
	}
	for _, k := range slices.Sorted(maps.Keys(cfMap)) {
		if k != "@call" && k != "catalogId" && k != "args" {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, fmt.Sprintf("unrecognized field %q on callFunction", k)), nil
		}
	}
	rawName, hasName := cfMap["@call"]
	if !hasName {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callFunction requires '@call'"), nil
	}
	name, ok := rawName.(string)
	if !ok {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callFunction '@call' must be a string"), nil
	}

	var catID string
	hasCatID := false
	if rawCID, present := cfMap["catalogId"]; present && rawCID != nil {
		cidStr, isStr := rawCID.(string)
		if !isStr || cidStr == "" {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callFunction 'catalogId' must be a non-empty string"), nil
		}
		catID = cidStr
		hasCatID = true
	}

	var argsMap map[string]any
	if rawArgs, present := cfMap["args"]; present && rawArgs != nil {
		am, isMap := rawArgs.(map[string]any)
		if !isMap {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callFunction 'args' must be an object"), nil
		}
		argsMap = am
	}

	return p.executeAgentFunction(ctx, callID, surfaceID, name, catID, hasCatID, argsMap), nil
}

func (p *RendererToAgentMessageProcessor) executeAgentFunction(
	ctx context.Context,
	callID string,
	surfaceID string,
	name string,
	catalogID string,
	hasCatalogID bool,
	args map[string]any,
) core.AgentToRendererMessage {
	if surfaceID == "" {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, fmt.Sprintf("The call to %q has an empty surfaceId.", name))
	}
	if name == "" {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, "callAgentFunction.callFunction['@call'] must be a non-empty string.")
	}

	resolvedCID := catalogID
	if !hasCatalogID {
		matches := p.fnOrder[name]
		if len(matches) > 1 {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, fmt.Sprintf("The call to %q has no catalogId, and several catalogs have an agent function of that name.", name))
		}
		if len(matches) == 0 {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeUnknownFunction, fmt.Sprintf("No catalog of the agent has an agent function %q.", name))
		}
		resolvedCID = matches[0]
	}

	cat, catExists := p.catByID[resolvedCID]
	if !catExists {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeUnknownFunction, fmt.Sprintf("The agent has no catalog %q.", resolvedCID))
	}
	entry, fnExists := p.functions[resolvedCID][name]
	if !fnExists {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeUnknownFunction, fmt.Sprintf("Catalog %q has no agent function %q.", resolvedCID, name))
	}
	if entry.fn.AllowedCallers == core.AllowedCallersAgentOnly {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, fmt.Sprintf("Function %q can't be called by the renderer (allowedCallers is agentOnly).", name))
	}

	validatedArgs, err := core.ValidateAndApplyFunctionDefaults(entry.fn, cat, args)
	if err != nil {
		return buildAgentFunctionErrorReply(callID, core.RPCCodeInvalidFunctionCall, fmt.Sprintf("Invalid arguments for function %q: %v", name, err))
	}

	callMeta := core.AgentFunctionContext{
		CatalogID:      resolvedCID,
		SurfaceID:      surfaceID,
		FunctionCallID: callID,
	}

	if p.opts.AgentFunctionTimeout <= 0 {
		val, runErr := invokeAgentFunctionHandler(ctx, entry.fn, validatedArgs, callMeta)
		if runErr != nil {
			return mapHandlerErrorToReply(callID, runErr)
		}
		return buildAgentFunctionValueReply(callID, val)
	}

	runCtx, cancel := context.WithTimeout(ctx, p.opts.AgentFunctionTimeout)
	defer cancel()

	type handlerOutcome struct {
		val any
		err error
	}
	doneCh := make(chan handlerOutcome, 1)
	go func() {
		v, e := invokeAgentFunctionHandler(runCtx, entry.fn, validatedArgs, callMeta)
		doneCh <- handlerOutcome{val: v, err: e}
	}()

	select {
	case out := <-doneCh:
		if out.err != nil {
			if errors.Is(runCtx.Err(), context.DeadlineExceeded) && errors.Is(out.err, context.DeadlineExceeded) {
				return buildAgentFunctionErrorReply(callID, core.RPCCodeExecutionError, fmt.Sprintf("Function %q timed out after %v.", name, p.opts.AgentFunctionTimeout))
			}
			return mapHandlerErrorToReply(callID, out.err)
		}
		return buildAgentFunctionValueReply(callID, out.val)
	case <-runCtx.Done():
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return buildAgentFunctionErrorReply(callID, core.RPCCodeExecutionError, fmt.Sprintf("Function %q timed out after %v.", name, p.opts.AgentFunctionTimeout))
		}
		return buildAgentFunctionErrorReply(callID, core.RPCCodeCancelled, runCtx.Err().Error())
	}
}

func invokeAgentFunctionHandler(
	ctx context.Context,
	fn *core.AgentFunction,
	args map[string]any,
	callCtx core.AgentFunctionContext,
) (val any, err error) {
	if fn.Handler == nil {
		return nil, nil
	}
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in agent function %q: %v", fn.Name, r)
		}
	}()
	return fn.Handler(ctx, args, callCtx)
}

func mapHandlerErrorToReply(callID string, err error) core.AgentToRendererMessage {
	var rpcErr *core.RPCError
	if errors.As(err, &rpcErr) && rpcErr != nil {
		code := rpcErr.RPCCode
		if code == "" && rpcErr.Code != "" {
			code = core.RPCErrorCode(rpcErr.Code)
		}
		if code == "" {
			code = core.RPCCodeExecutionError
		}
		return buildAgentFunctionErrorReply(callID, code, rpcErr.Error())
	}
	return buildAgentFunctionErrorReply(callID, core.RPCCodeExecutionError, err.Error())
}

func buildAgentFunctionValueReply(callID string, val any) core.AgentToRendererMessage {
	return core.AgentToRendererMessage{
		"version": "1.0",
		"agentFunctionResponse": map[string]any{
			"functionCallId": callID,
			"value":          core.CloneJSONValue(val),
		},
	}
}

func buildAgentFunctionErrorReply(callID string, code core.RPCErrorCode, msg string) core.AgentToRendererMessage {
	return core.AgentToRendererMessage{
		"version": "1.0",
		"agentFunctionResponse": map[string]any{
			"functionCallId": callID,
			"error": map[string]any{
				"code":    string(code),
				"message": msg,
			},
		},
	}
}

func parseActionMessage(msgMap map[string]any) (*core.RendererToAgentMessage, error) {
	body, ok := msgMap["action"].(map[string]any)
	if !ok || body == nil {
		return nil, core.NewValidationError("action message payload must be an object")
	}
	allowed := map[string]bool{
		"name":              true,
		"userMessage":       true,
		"surfaceId":         true,
		"sourceComponentId": true,
		"timestamp":         true,
		"context":           true,
		"metadata":          true,
	}
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !allowed[k] {
			return nil, core.NewValidationErrorf("unrecognized field %q in action message", k)
		}
	}
	name, ok1 := body["name"].(string)
	sid, ok2 := body["surfaceId"].(string)
	srcID, ok3 := body["sourceComponentId"].(string)
	ts, ok4 := body["timestamp"].(string)
	ctxMap, ok5 := body["context"].(map[string]any)
	if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || ctxMap == nil {
		return nil, core.NewValidationError("action message missing required fields (name, surfaceId, sourceComponentId, timestamp, context)")
	}
	if _, err := parseISO8601Timestamp(ts); err != nil {
		return nil, core.NewValidationErrorf("action timestamp %q is not a valid ISO 8601 date-time", ts)
	}
	var userMsg string
	if rawUM, present := body["userMessage"]; present {
		umStr, isStr := rawUM.(string)
		if !isStr {
			return nil, core.NewValidationError("action userMessage must be a string")
		}
		userMsg = umStr
	}
	var metaMap map[string]any
	if rawMeta, present := body["metadata"]; present {
		mm, isMap := rawMeta.(map[string]any)
		if !isMap || mm == nil {
			return nil, core.NewValidationError("action metadata must be an object")
		}
		if err := core.ValidateMetadata(mm, core.Version1_0); err != nil {
			return nil, err
		}
		metaMap, _ = core.CloneJSONValue(mm).(map[string]any)
	}
	clonedCtx, _ := core.CloneJSONValue(ctxMap).(map[string]any)
	return &core.RendererToAgentMessage{
		Version: "1.0",
		Action: &core.ActionPayload{
			Name:              name,
			SurfaceID:         sid,
			SourceComponentID: srcID,
			Timestamp:         ts,
			UserMessage:       userMsg,
			Context:           clonedCtx,
			Metadata:          metaMap,
		},
	}, nil
}

func parseISO8601Timestamp(ts string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, ts); err == nil {
		return t, nil
	}
	return time.Parse("2006-01-02T15:04:05", ts)
}

func parseRendererErrorMessage(msgMap map[string]any) (*core.RendererToAgentMessage, error) {
	body, ok := msgMap["error"].(map[string]any)
	if !ok || body == nil {
		return nil, core.NewValidationError("error message payload must be an object")
	}
	code, ok1 := body["code"].(string)
	message, ok2 := body["message"].(string)
	if !ok1 || !ok2 {
		return nil, core.NewValidationError("error message requires string 'code' and 'message'")
	}
	isValidationCode := code == "VALIDATION_FAILED" || code == "UNALLOWED_PARENT" || code == "UNALLOWED_CHILD"
	if isValidationCode {
		for _, k := range slices.Sorted(maps.Keys(body)) {
			if k != "code" && k != "surfaceId" && k != "path" && k != "message" {
				return nil, core.NewValidationErrorf("validation error message has unrecognized field %q", k)
			}
		}
		sid, hasSID := body["surfaceId"].(string)
		p, hasPath := body["path"].(string)
		if !hasSID || !hasPath {
			return nil, core.NewValidationError("validation error message requires 'surfaceId' and 'path'")
		}
		return &core.RendererToAgentMessage{
			Version: "1.0",
			Error: &core.RendererErrorPayload{
				Code:      code,
				Message:   message,
				SurfaceID: sid,
				Path:      p,
			},
		}, nil
	}

	rawSID, hasSID := body["surfaceId"]
	rawFCID, hasFCID := body["functionCallId"]
	if hasSID == hasFCID {
		return nil, core.NewValidationError("generic error message must specify exactly one of 'surfaceId' or 'functionCallId'")
	}
	var sid, fcid string
	if hasSID {
		s, isStr := rawSID.(string)
		if !isStr {
			return nil, core.NewValidationError("error surfaceId must be a string")
		}
		sid = s
	}
	if hasFCID {
		f, isStr := rawFCID.(string)
		if !isStr || f == "" {
			return nil, core.NewValidationError("error functionCallId must be a non-empty string")
		}
		fcid = f
	}
	extra := make(map[string]any)
	for k, v := range body {
		if k != "code" && k != "message" && k != "surfaceId" && k != "functionCallId" {
			extra[k] = core.CloneJSONValue(v)
		}
	}
	if len(extra) == 0 {
		extra = nil
	}
	return &core.RendererToAgentMessage{
		Version: "1.0",
		Error: &core.RendererErrorPayload{
			Code:           code,
			Message:        message,
			SurfaceID:      sid,
			FunctionCallID: fcid,
			Extra:          extra,
		},
	}, nil
}

func parseRendererFunctionResponseMessage(msgMap map[string]any) (*core.RendererToAgentMessage, error) {
	ver, _ := msgMap["version"].(string)
	if ver != "1.0" {
		return nil, core.NewValidationErrorf(`rendererFunctionResponse requires "version": "1.0", got %v`, msgMap["version"])
	}
	if len(msgMap) != 2 {
		return nil, core.NewValidationError("rendererFunctionResponse envelope must contain only version and rendererFunctionResponse")
	}
	body, ok := msgMap["rendererFunctionResponse"].(map[string]any)
	if !ok || body == nil {
		return nil, core.NewValidationError("rendererFunctionResponse must be an object")
	}
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if k != "functionCallId" && k != "value" && k != "error" {
			return nil, core.NewValidationErrorf("unrecognized field %q in rendererFunctionResponse", k)
		}
	}
	callID, ok := body["functionCallId"].(string)
	if !ok || callID == "" {
		return nil, core.NewValidationError("rendererFunctionResponse requires a non-empty string 'functionCallId'")
	}
	rawVal, hasVal := body["value"]
	rawErr, hasErr := body["error"]
	if hasVal == hasErr {
		return nil, core.NewValidationError("rendererFunctionResponse must specify exactly one of 'value' or 'error'")
	}
	if hasErr {
		errMap, isMap := rawErr.(map[string]any)
		if !isMap || errMap == nil {
			return nil, core.NewValidationError("rendererFunctionResponse 'error' must be an object")
		}
		for _, k := range slices.Sorted(maps.Keys(errMap)) {
			if k != "code" && k != "message" {
				return nil, core.NewValidationErrorf("unrecognized field %q in FunctionResponseError", k)
			}
		}
		code, okC := errMap["code"].(string)
		msg, okM := errMap["message"].(string)
		if !okC || !okM {
			return nil, core.NewValidationError("FunctionResponseError requires string 'code' and 'message'")
		}
		return &core.RendererToAgentMessage{
			Version: "1.0",
			RendererFunctionResponse: &core.FunctionResponsePayload{
				FunctionCallID: callID,
				Error:          &core.FunctionResponseError{Code: code, Message: msg},
			},
		}, nil
	}
	return &core.RendererToAgentMessage{
		Version: "1.0",
		RendererFunctionResponse: &core.FunctionResponsePayload{
			FunctionCallID: callID,
			Value:          core.CloneJSONValue(rawVal),
			HasValue:       true,
		},
	}, nil
}

// Clock abstracts timer scheduling so conformance tests can drive timeouts deterministically via advance_ms.
type Clock interface {
	AfterFunc(d time.Duration, f func()) TimerHandle
}

// TimerHandle cancels a scheduled Clock timer.
type TimerHandle interface {
	Stop() bool
}

type realClock struct{}

func (realClock) AfterFunc(d time.Duration, f func()) TimerHandle {
	return time.AfterFunc(d, f)
}

// RendererFunctionCallsOptions configures a RendererFunctionCalls table.
// The zero value of each field is the default.
type RendererFunctionCallsOptions struct {
	// DefaultTimeout defaults to DefaultRendererCallTimeout when zero; negative values are rejected.
	// Set DisableDefaultTimeout to disable default timeouts unless a call sets its own Timeout.
	DefaultTimeout        time.Duration
	DisableDefaultTimeout bool
	MaxPending            int
	Catalogs              []*core.Catalog
	Clock                 Clock
}

// CallRendererRequest specifies parameters for RendererFunctionCalls.Call.
type CallRendererRequest struct {
	CatalogID string
	Name      string
	Args      map[string]any
	SurfaceID string
	// Timeout overrides the manager's default timeout when positive; 0 uses the manager default; negative values are rejected.
	Timeout time.Duration
	// FunctionCallID specifies an explicit call ID when non-nil (an empty string is rejected); nil auto-generates an ID.
	FunctionCallID *string
}

// PendingRendererCall awaits the response of an outbound callRendererFunction invocation.
// A PendingRendererCall is safe for concurrent use by multiple goroutines.
type PendingRendererCall struct {
	FunctionCallID string
	name           string
	timer          TimerHandle
	settleOnce     sync.Once
	done           chan struct{}
	val            any
	err            error
}

func newPendingRendererCall(id, name string) *PendingRendererCall {
	return &PendingRendererCall{
		FunctionCallID: id,
		name:           name,
		done:           make(chan struct{}),
	}
}

func (c *PendingRendererCall) settle(val any, err error) bool {
	settled := false
	c.settleOnce.Do(func() {
		settled = true
		c.val = val
		c.err = err
		close(c.done)
	})
	return settled
}

func (c *PendingRendererCall) isSettled() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

// Wait blocks until the renderer function response arrives, times out, is disposed, or ctx is cancelled.
func (c *PendingRendererCall) Wait(ctx context.Context) (any, error) {
	select {
	case <-c.done:
		return c.val, c.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Done returns a channel closed when the call settles.
func (c *PendingRendererCall) Done() <-chan struct{} { return c.done }

// Result returns the settled value and error without blocking when ok is true,
// or (nil, false, nil) if the call has not settled yet.
func (c *PendingRendererCall) Result() (val any, ok bool, err error) {
	select {
	case <-c.done:
		return c.val, true, c.err
	default:
		return nil, false, nil
	}
}

// RendererFunctionCalls manages outbound callRendererFunction messages and correlates rendererFunctionResponse replies.
// A RendererFunctionCalls instance is safe for concurrent use by multiple goroutines.
type RendererFunctionCalls struct {
	mu             sync.Mutex
	defaultTimeout time.Duration
	hasDefault     bool
	maxPending     int
	hasCatalogs    bool
	catalogs       map[string]*core.Catalog
	clock          Clock
	pending        map[string]*PendingRendererCall
	disposed       bool
}

// NewRendererFunctionCalls creates a session-scoped RendererFunctionCalls manager.
func NewRendererFunctionCalls(opts *RendererFunctionCallsOptions) (*RendererFunctionCalls, error) {
	var resolved RendererFunctionCallsOptions
	if opts != nil {
		resolved = *opts
	}
	if resolved.DefaultTimeout < 0 {
		return nil, fmt.Errorf("default timeout must be non-negative, got %v", resolved.DefaultTimeout)
	}
	if resolved.MaxPending < 0 {
		return nil, fmt.Errorf("maxPending must be non-negative, got %d", resolved.MaxPending)
	}

	var catMap map[string]*core.Catalog
	hasCats := opts != nil && opts.Catalogs != nil
	if hasCats {
		catMap = make(map[string]*core.Catalog, len(resolved.Catalogs))
		for _, cat := range resolved.Catalogs {
			if cat == nil {
				continue
			}
			if _, dup := catMap[cat.CatalogID()]; dup {
				return nil, core.NewCatalogErrorf("duplicate catalog ID %q", cat.CatalogID())
			}
			catMap[cat.CatalogID()] = cat
		}
	}

	defTimeout := DefaultRendererCallTimeout
	hasDef := !resolved.DisableDefaultTimeout
	if hasDef && resolved.DefaultTimeout > 0 {
		defTimeout = resolved.DefaultTimeout
	}
	clk := resolved.Clock
	if clk == nil {
		clk = realClock{}
	}

	return &RendererFunctionCalls{
		defaultTimeout: defTimeout,
		hasDefault:     hasDef,
		maxPending:     resolved.MaxPending,
		hasCatalogs:    hasCats,
		catalogs:       catMap,
		clock:          clk,
		pending:        make(map[string]*PendingRendererCall),
	}, nil
}

// Call validates req in strict 9-step order, registers a pending call, and returns the outbound envelope and future handle.
func (r *RendererFunctionCalls) Call(req CallRendererRequest) (core.AgentToRendererMessage, *PendingRendererCall, error) {
	// 1. Timeout check.
	if req.Timeout < 0 {
		return nil, nil, fmt.Errorf("timeout must be non-negative, got %v", req.Timeout)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// 2. Disposal check.
	if r.disposed {
		return nil, nil, core.NewRPCError(core.RPCCodeDisposed, "RendererFunctionCalls has been disposed.")
	}

	// 3. FunctionCallID check.
	var callID string
	if req.FunctionCallID != nil {
		if *req.FunctionCallID == "" {
			return nil, nil, core.NewRPCError(core.RPCCodeInvalidFunctionCall, "functionCallId must not be empty.")
		}
		callID = *req.FunctionCallID
	} else {
		callID = generateCallID()
	}

	// 4. Duplicate pending ID check.
	if _, exists := r.pending[callID]; exists {
		return nil, nil, newRPCErrorWithCallID(core.RPCCodeDuplicate, fmt.Sprintf("A call with functionCallId %q is already pending.", callID), callID)
	}

	// 5. MaxPending check.
	if r.maxPending > 0 && len(r.pending) >= r.maxPending {
		return nil, nil, newRPCErrorWithCallID(core.RPCCodeTooManyPending, fmt.Sprintf("%d renderer function calls are already pending, the most allowed.", len(r.pending)), callID)
	}

	// 6. Empty Name check (before CatalogID).
	if req.Name == "" {
		return nil, nil, newRPCErrorWithCallID(core.RPCCodeInvalidFunctionCall, "The call needs a function name.", callID)
	}

	// 7. Empty CatalogID check.
	if req.CatalogID == "" {
		return nil, nil, newRPCErrorWithCallID(core.RPCCodeInvalidFunctionCall, fmt.Sprintf("The call to %q needs a catalogId.", req.Name), callID)
	}

	// 8. Name identifier check & Args check (before Catalogs check).
	if strings.HasPrefix(req.Name, "@") || !core.IsValidUAX31Identifier(req.Name) {
		return nil, nil, newRPCErrorWithCallID(core.RPCCodeInvalidFunctionCall, fmt.Sprintf("The function name %q must be a UAX #31 identifier that doesn't start with '@'.", req.Name), callID)
	}
	argsMap := map[string]any{}
	if req.Args != nil {
		problem, normalizedArgs := checkCallArgs(req.Args)
		if problem != "" {
			return nil, nil, newRPCErrorWithCallID(core.RPCCodeInvalidFunctionCall, fmt.Sprintf("Invalid arguments for %q: %s", req.Name, problem), callID)
		}
		argsMap = normalizedArgs
	}

	// 9. Catalogs check (when configured).
	if r.hasCatalogs {
		cat, exists := r.catalogs[req.CatalogID]
		if !exists {
			return nil, nil, newRPCErrorWithCallID(core.RPCCodeUnknownFunction, fmt.Sprintf("The call to %q names catalog %q, which isn't one of the agent's catalogs.", req.Name, req.CatalogID), callID)
		}
		fn, declared := cat.RendererFunctions()[req.Name]
		if !declared {
			return nil, nil, newRPCErrorWithCallID(core.RPCCodeUnknownFunction, fmt.Sprintf("Catalog %q has no renderer function %q.", req.CatalogID, req.Name), callID)
		}
		if fn.AllowedCallers == "" || fn.AllowedCallers == core.AllowedCallersRendererOnly {
			return nil, nil, newRPCErrorWithCallID(core.RPCCodeInvalidFunctionCall, fmt.Sprintf("Function %q is rendererOnly, so the agent may not call it.", req.Name), callID)
		}
		if fn.RequiresUserActivation {
			return nil, nil, newRPCErrorWithCallID(core.RPCCodeInvalidFunctionCall, fmt.Sprintf("Function %q requires user activation, and a call from the agent has no user gesture.", req.Name), callID)
		}
	}

	callBody := map[string]any{
		"functionCallId": callID,
		"callFunction": map[string]any{
			"@call":     req.Name,
			"catalogId": req.CatalogID,
			"args":      argsMap,
		},
	}
	if req.SurfaceID != "" {
		callBody["surfaceId"] = req.SurfaceID
	}
	envelope := core.AgentToRendererMessage{
		"version":              "1.0",
		"callRendererFunction": callBody,
	}

	pending := newPendingRendererCall(callID, req.Name)
	var effectiveTimeout time.Duration
	useTimeout := false
	if req.Timeout > 0 {
		effectiveTimeout = req.Timeout
		useTimeout = true
	} else if r.hasDefault {
		effectiveTimeout = r.defaultTimeout
		useTimeout = true
	}

	r.pending[callID] = pending
	if useTimeout {
		pending.timer = r.clock.AfterFunc(effectiveTimeout, func() {
			r.timeOutCall(callID, effectiveTimeout)
		})
	}
	return envelope, pending, nil
}

// Resolve settles a pending call matching resp, returning true if a pending call was matched.
func (r *RendererFunctionCalls) Resolve(resp *core.FunctionResponsePayload) bool {
	if resp == nil || resp.FunctionCallID == "" {
		return false
	}
	callID := resp.FunctionCallID

	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return false
	}
	pending, exists := r.pending[callID]
	if !exists || pending.isSettled() {
		r.mu.Unlock()
		return false
	}
	delete(r.pending, callID)
	timer := pending.timer
	r.mu.Unlock()

	if timer != nil {
		timer.Stop()
	}
	if resp.Error != nil {
		errObj := newRPCErrorWithCallID(
			core.RPCErrorCode(resp.Error.Code),
			fmt.Sprintf("Renderer function %q failed (%s): %s", pending.name, resp.Error.Code, resp.Error.Message),
			callID,
		)
		return pending.settle(nil, errObj)
	}
	return pending.settle(core.CloneJSONValue(resp.Value), nil)
}

// ResolveMessage parses a raw v1.0 rendererFunctionResponse envelope map and settles the matching pending call.
func (r *RendererFunctionCalls) ResolveMessage(raw map[string]any) bool {
	if raw == nil {
		return false
	}
	parsed, err := parseRendererFunctionResponseMessage(raw)
	if err != nil {
		callID := extractRawResponseCallID(raw)
		if callID == "" {
			return false
		}
		return r.failMalformedCall(callID, fmt.Sprintf("Malformed rendererFunctionResponse: %v", err))
	}
	if parsed == nil || parsed.RendererFunctionResponse == nil {
		return false
	}
	return r.Resolve(parsed.RendererFunctionResponse)
}

func (r *RendererFunctionCalls) failMalformedCall(callID, reason string) bool {
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return false
	}
	pending, exists := r.pending[callID]
	if !exists || pending.isSettled() {
		r.mu.Unlock()
		return false
	}
	delete(r.pending, callID)
	timer := pending.timer
	r.mu.Unlock()

	if timer != nil {
		timer.Stop()
	}
	return pending.settle(nil, newRPCErrorWithCallID(core.RPCCodeUnknownError, reason, callID))
}

func (r *RendererFunctionCalls) timeOutCall(callID string, timeout time.Duration) {
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return
	}
	pending, exists := r.pending[callID]
	if !exists || pending.isSettled() {
		r.mu.Unlock()
		return
	}
	delete(r.pending, callID)
	r.mu.Unlock()

	pending.settle(nil, newRPCErrorWithCallID(
		core.RPCCodeTimeout,
		fmt.Sprintf("Renderer function %q timed out after %v.", pending.name, timeout),
		callID,
	))
}

// IsPending reports whether functionCallID is currently awaiting a response.
func (r *RendererFunctionCalls) IsPending(functionCallID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disposed {
		return false
	}
	p, ok := r.pending[functionCallID]
	return ok && !p.isSettled()
}

// PendingCount returns the number of in-flight calls awaiting responses.
func (r *RendererFunctionCalls) PendingCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pending)
}

// Disposed reports whether Dispose has been called.
func (r *RendererFunctionCalls) Disposed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.disposed
}

// Dispose cancels all pending calls with RPCCodeCancelled and rejects subsequent calls with RPCCodeDisposed.
func (r *RendererFunctionCalls) Dispose(reason string) {
	if reason == "" {
		reason = "RendererFunctionCalls was disposed."
	}
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return
	}
	r.disposed = true
	items := make([]*PendingRendererCall, 0, len(r.pending))
	for _, p := range r.pending {
		items = append(items, p)
	}
	r.pending = make(map[string]*PendingRendererCall)
	r.mu.Unlock()

	for _, p := range items {
		if p.timer != nil {
			p.timer.Stop()
		}
		p.settle(nil, newRPCErrorWithCallID(core.RPCCodeCancelled, reason, p.FunctionCallID))
	}
}

func newRPCErrorWithCallID(code core.RPCErrorCode, msg, callID string) *core.RPCError {
	err := core.NewRPCError(code, msg)
	err.FunctionCallID = callID
	return err
}

func generateCallID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("call-%d", time.Now().UnixNano())
	}
	return "call-" + hex.EncodeToString(b[:])
}

func extractRawResponseCallID(msgMap map[string]any) string {
	body, ok := msgMap["rendererFunctionResponse"].(map[string]any)
	if !ok {
		return ""
	}
	id, _ := body["functionCallId"].(string)
	return id
}

func checkCallArgs(m map[string]any) (string, map[string]any) {
	keys := slices.Sorted(maps.Keys(m))
	for _, k := range keys {
		if !core.IsValidUAX31Identifier(k) {
			return fmt.Sprintf("the key %q is not a UAX #31 identifier.", k), nil
		}
	}
	out := make(map[string]any, len(m))
	for _, k := range keys {
		prob, cloned := checkJSONValue(m[k], k)
		if prob != "" {
			return prob, nil
		}
		out[k] = cloned
	}
	return "", out
}

func checkJSONValue(val any, path string) (string, any) {
	switch v := val.(type) {
	case nil, bool, string, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return "", v
	case json.Number:
		if !json.Valid([]byte(v)) {
			return fmt.Sprintf("%q is %q, which isn't a JSON number.", path, v), nil
		}
		if i, err := v.Int64(); err == nil {
			return "", i
		}
		f, err := v.Float64()
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Sprintf("%q is %q, which isn't a JSON number.", path, v), nil
		}
		return "", f
	case float32:
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return fmt.Sprintf("%q is %v, which isn't a JSON number.", path, v), nil
		}
		return "", float64(v)
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Sprintf("%q is %v, which isn't a JSON number.", path, v), nil
		}
		return "", v
	case []byte:
		return fmt.Sprintf("%q is a %T, which isn't a JSON value.", path, val), nil
	case []any:
		if v == nil {
			return "", nil
		}
		out := make([]any, len(v))
		for i, item := range v {
			prob, c := checkJSONValue(item, fmt.Sprintf("%s[%d]", path, i))
			if prob != "" {
				return prob, nil
			}
			out[i] = c
		}
		return "", out
	case map[string]any:
		if v == nil {
			return "", nil
		}
		out := make(map[string]any, len(v))
		for _, k := range slices.Sorted(maps.Keys(v)) {
			prob, c := checkJSONValue(v[k], path+"."+k)
			if prob != "" {
				return prob, nil
			}
			out[k] = c
		}
		return "", out
	default:
		rv := reflect.ValueOf(val)
		switch rv.Kind() {
		case reflect.Pointer:
			if rv.IsNil() {
				return "", nil
			}
		case reflect.Slice:
			if rv.IsNil() {
				return "", nil
			}
			out := make([]any, rv.Len())
			for i := 0; i < rv.Len(); i++ {
				prob, c := checkJSONValue(rv.Index(i).Interface(), fmt.Sprintf("%s[%d]", path, i))
				if prob != "" {
					return prob, nil
				}
				out[i] = c
			}
			return "", out
		case reflect.Map:
			if rv.Type().Key().Kind() == reflect.String {
				if rv.IsNil() {
					return "", nil
				}
				rawKeys := rv.MapKeys()
				keyMap := make(map[string]reflect.Value, len(rawKeys))
				keys := make([]string, 0, len(rawKeys))
				for _, rk := range rawKeys {
					ks := rk.String()
					keys = append(keys, ks)
					keyMap[ks] = rk
				}
				sort.Strings(keys)
				out := make(map[string]any, len(keys))
				for _, k := range keys {
					prob, c := checkJSONValue(rv.MapIndex(keyMap[k]).Interface(), path+"."+k)
					if prob != "" {
						return prob, nil
					}
					out[k] = c
				}
				return "", out
			}
		}
		return fmt.Sprintf("%q is a %T, which isn't a JSON value.", path, val), nil
	}
}
