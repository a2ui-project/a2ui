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

package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
)

const unresolvedArgumentMessage = "An argument of the function call could not be resolved."

// resolveDynamicNoAgentHook is registered by resolution.go to evaluate dynamic RPC arguments
// (@path and local @call) without routing back to the agent.
var resolveDynamicNoAgentHook func(ctx *DataContext, val any) (any, error)

// AgentCallFuture represents an in-flight or settled asynchronous callAgentFunction result.
type AgentCallFuture struct {
	FunctionCallID string

	mu        sync.Mutex
	done      chan struct{}
	settled   bool
	val       any
	err       error
	callbacks []func(val any, err error)
}

func newPendingAgentCallFuture(callID string) *AgentCallFuture {
	return &AgentCallFuture{
		FunctionCallID: callID,
		done:           make(chan struct{}),
	}
}

func newSettledAgentCallFuture(val any, err error) *AgentCallFuture {
	ch := make(chan struct{})
	close(ch)
	return &AgentCallFuture{
		done:    ch,
		settled: true,
		val:     CloneJSONValue(val),
		err:     err,
	}
}

func (f *AgentCallFuture) settle(val any, err error) {
	f.mu.Lock()
	if f.settled {
		f.mu.Unlock()
		return
	}
	f.settled = true
	f.val = CloneJSONValue(val)
	f.err = err
	cbs := f.callbacks
	f.callbacks = nil
	close(f.done)
	f.mu.Unlock()

	for _, cb := range cbs {
		cb(CloneJSONValue(val), err)
	}
}

func (f *AgentCallFuture) then(cb func(val any, err error)) {
	if cb == nil {
		return
	}
	f.mu.Lock()
	if f.settled {
		v := CloneJSONValue(f.val)
		e := f.err
		f.mu.Unlock()
		cb(v, e)
		return
	}
	f.callbacks = append(f.callbacks, cb)
	f.mu.Unlock()
}

// Result returns the non-blocking state of the future.
func (f *AgentCallFuture) Result() (val any, settled bool, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.settled {
		return nil, false, nil
	}
	return CloneJSONValue(f.val), true, f.err
}

// Wait blocks until the future settles or ctx is cancelled.
func (f *AgentCallFuture) Wait(ctx context.Context) (any, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-f.done:
		val, _, err := f.Result()
		return val, err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type pendingAgentCall struct {
	surfaceID string
	future    *AgentCallFuture
	timer     *time.Timer
}

// DefaultAgentCallTimeout is the default timeout applied to outbound callAgentFunction requests.
const DefaultAgentCallTimeout = 30 * time.Second

// RPCHandlerOptions configures an RPCHandler.
type RPCHandlerOptions struct {
	OutboundListener OutboundListener
	DefaultTimeout   time.Duration
}

// AgentCallOptions configures an individual CallAgentFunction request.
type AgentCallOptions struct {
	FunctionCallID string
	Timeout        *time.Duration
	Version        ProtocolVersion
}

// RPCHandler manages v1.0 bidirectional function execution (callRendererFunction & callAgentFunction).
type RPCHandler struct {
	catalogs []*Catalog

	mu               sync.Mutex
	outboundListener OutboundListener
	defaultTimeout   time.Duration
	pending          map[string]*pendingAgentCall
	disposed         bool
}

// NewRPCHandler creates an RPCHandler over catalogs and options.
func NewRPCHandler(catalogs []*Catalog, opts *RPCHandlerOptions) *RPCHandler {
	var listener OutboundListener
	timeout := DefaultAgentCallTimeout
	if opts != nil {
		listener = opts.OutboundListener
		if opts.DefaultTimeout > 0 {
			timeout = opts.DefaultTimeout
		}
	}
	return &RPCHandler{
		catalogs:         append([]*Catalog(nil), catalogs...),
		outboundListener: listener,
		defaultTimeout:   timeout,
		pending:          make(map[string]*pendingAgentCall),
	}
}

// Disposed reports whether Dispose has been called on the RPCHandler.
func (r *RPCHandler) Disposed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.disposed
}

// PendingCount returns the number of currently pending outbound callAgentFunction calls.
func (r *RPCHandler) PendingCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pending)
}

// AddCatalog registers an additional Catalog on the RPCHandler.
func (r *RPCHandler) AddCatalog(cat *Catalog) {
	if r == nil || cat == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.catalogs = append(r.catalogs, cat)
}

// Dispose cancels all pending outbound calls with CANCELLED and rejects subsequent calls with DISPOSED.
func (r *RPCHandler) Dispose() {
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return
	}
	r.disposed = true
	r.outboundListener = nil
	toCancel := make([]struct {
		id    string
		entry *pendingAgentCall
	}, 0, len(r.pending))
	for id, entry := range r.pending {
		toCancel = append(toCancel, struct {
			id    string
			entry *pendingAgentCall
		}{id: id, entry: entry})
	}
	r.pending = make(map[string]*pendingAgentCall)
	r.mu.Unlock()

	for _, item := range toCancel {
		if item.entry.timer != nil {
			item.entry.timer.Stop()
		}
		rpcErr := NewRPCError(RPCCodeCancelled, fmt.Sprintf("RpcHandler disposed while call '%s' was pending.", item.id))
		rpcErr.FunctionCallID = item.id
		item.entry.future.settle(nil, rpcErr)
	}
}

// CancelSurfaceCalls cancels pending outbound calls for surfaceID (or all surfaces if surfaceID is empty).
func (r *RPCHandler) CancelSurfaceCalls(surfaceID string) {
	r.mu.Lock()
	var toCancel []struct {
		id    string
		entry *pendingAgentCall
	}
	for id, entry := range r.pending {
		if surfaceID == "" || entry.surfaceID == surfaceID {
			delete(r.pending, id)
			toCancel = append(toCancel, struct {
				id    string
				entry *pendingAgentCall
			}{id: id, entry: entry})
		}
	}
	r.mu.Unlock()

	for _, item := range toCancel {
		if item.entry.timer != nil {
			item.entry.timer.Stop()
		}
		msg := fmt.Sprintf("Call '%s' was cancelled.", item.id)
		if surfaceID != "" {
			msg = fmt.Sprintf("Pending calls for surface '%s' were cancelled.", surfaceID)
		}
		rpcErr := NewRPCError(RPCCodeCancelled, msg)
		rpcErr.FunctionCallID = item.id
		item.entry.future.settle(nil, rpcErr)
	}
}

// ResolveCatalog looks up a registered catalog by exact catalogID without falling back to a default.
func (r *RPCHandler) ResolveCatalog(catalogID string) *Catalog {
	if catalogID == "" {
		return nil
	}
	r.mu.Lock()
	cats := append([]*Catalog(nil), r.catalogs...)
	r.mu.Unlock()
	for _, cat := range cats {
		if cat != nil && cat.CatalogID() == catalogID {
			return cat
		}
	}
	return nil
}

func (r *RPCHandler) emitOutbound(msg map[string]any) {
	r.mu.Lock()
	listener := r.outboundListener
	r.mu.Unlock()
	if listener != nil {
		listener(msg)
	}
}

func buildRendererErrorResponse(callID string, code RPCErrorCode, message string, version string) map[string]any {
	if version == "" {
		version = "1.0"
	}
	if callID == "" {
		callID = "unknown"
	}
	return map[string]any{
		"version": version,
		"rendererFunctionResponse": map[string]any{
			"functionCallId": callID,
			"error": map[string]any{
				"code":    string(code),
				"message": message,
			},
		},
	}
}

func buildRendererSuccessResponse(callID string, val any, version string) map[string]any {
	if version == "" {
		version = "1.0"
	}
	if callID == "" {
		callID = "unknown"
	}
	return map[string]any{
		"version": version,
		"rendererFunctionResponse": map[string]any{
			"functionCallId": callID,
			"value":          CloneJSONValue(val),
		},
	}
}

// HandleCallRendererFunction executes an inbound callRendererFunction payload and emits rendererFunctionResponse.
func (r *RPCHandler) HandleCallRendererFunction(
	req CallRendererFunctionPayload,
	hasSurfaceID bool,
	dataCtx *DataContext,
	isUserActivated bool,
) (map[string]any, error) {
	version := "1.0"
	callID := req.FunctionCallID
	if callID == "" {
		callID = "unknown"
	}

	if r.Disposed() {
		resp := buildRendererErrorResponse(callID, RPCCodeDisposed, "RpcHandler has been disposed.", version)
		r.emitOutbound(resp)
		return resp, nil
	}

	if req.CallFunction.Call == "" {
		resp := buildRendererErrorResponse(callID, RPCCodeInvalidFunctionCall, "Malformed message: missing callRendererFunction or callFunction.", version)
		r.emitOutbound(resp)
		return resp, nil
	}

	if hasSurfaceID {
		if dataCtx == nil || dataCtx.Surface == nil || dataCtx.Surface.ID != req.SurfaceID {
			resp := buildRendererErrorResponse(
				callID,
				RPCCodeInvalidFunctionCall,
				fmt.Sprintf("Surface not found: %s", req.SurfaceID),
				version,
			)
			r.emitOutbound(resp)
			return resp, nil
		}
	}

	matchedCat := r.ResolveCatalog(req.CallFunction.CatalogID)
	if matchedCat == nil {
		errMsg := "No catalog available for function resolution."
		if req.CallFunction.CatalogID != "" {
			errMsg = fmt.Sprintf("Catalog not found: %s", req.CallFunction.CatalogID)
		}
		resp := buildRendererErrorResponse(callID, RPCCodeInvalidFunctionCall, errMsg, version)
		r.emitOutbound(resp)
		return resp, nil
	}

	if !isCatalogVersionCompatible(string(matchedCat.ProtocolVersion()), version) {
		resp := buildRendererErrorResponse(
			callID,
			RPCCodeInvalidFunctionCall,
			fmt.Sprintf(
				"Catalog specification version (%s) does not match message protocol version (%s).",
				matchedCat.ProtocolVersion(), version,
			),
			version,
		)
		r.emitOutbound(resp)
		return resp, nil
	}

	fn, exists := matchedCat.functionByName(req.CallFunction.Call)
	if !exists {
		resp := buildRendererErrorResponse(
			callID,
			RPCCodeInvalidFunctionCall,
			fmt.Sprintf("Function not found: %s", req.CallFunction.Call),
			version,
		)
		r.emitOutbound(resp)
		return resp, nil
	}

	allowed := fn.AllowedCallers
	if allowed == "" {
		allowed = AllowedCallersRendererOnly
	}
	if allowed != AllowedCallersAgentOnly && allowed != AllowedCallersRendererOrAgent {
		resp := buildRendererErrorResponse(
			callID,
			RPCCodeInvalidFunctionCall,
			fmt.Sprintf("Function '%s' cannot be called by agent (allowedCallers is %s).", req.CallFunction.Call, allowed),
			version,
		)
		r.emitOutbound(resp)
		return resp, nil
	}

	if fn.RequiresUserActivation && !isUserActivated {
		resp := buildRendererErrorResponse(
			callID,
			RPCCodeInvalidFunctionCall,
			fmt.Sprintf("Function '%s' requires user activation context to execute.", req.CallFunction.Call),
			version,
		)
		r.emitOutbound(resp)
		return resp, nil
	}

	effectiveCtx := r.ensureDataContext(dataCtx, matchedCat, callID)
	callCtx := effectiveCtx.WithActiveCatalog(matchedCat.CatalogID(), matchedCat)
	if isUserActivated && callCtx != nil {
		cp := *callCtx
		cp.IsUserActivated = true
		callCtx = &cp
	}

	rawArgs := req.CallFunction.Args
	if rawArgs == nil {
		rawArgs = map[string]any{}
	}

	resolvedArgs, argErrMsg := resolveRPCArguments(rawArgs, callCtx)
	if argErrMsg != "" {
		resp := buildRendererErrorResponse(callID, RPCCodeExecutionError, argErrMsg, version)
		r.emitOutbound(resp)
		return resp, nil
	}

	validatedArgs, valErr := NewPayloadValidator(matchedCat, nil).ValidateFunctionArgs(req.CallFunction.Call, resolvedArgs)
	if valErr != nil {
		resp := buildRendererErrorResponse(
			callID,
			RPCCodeInvalidFunctionCall,
			fmt.Sprintf("Invalid arguments for function '%s': %v", req.CallFunction.Call, valErr),
			version,
		)
		r.emitOutbound(resp)
		return resp, nil
	}

	if fn.Evaluate == nil {
		resp := buildRendererErrorResponse(
			callID,
			RPCCodeExecutionError,
			fmt.Sprintf("Function '%s' is not callable and has no execute method.", req.CallFunction.Call),
			version,
		)
		r.emitOutbound(resp)
		return resp, nil
	}

	val, execErr := executeFunctionRecover(fn.Evaluate, validatedArgs, callCtx)
	if execErr != nil {
		errMsg := execErr.Error()
		if strings.TrimSpace(errMsg) == "" {
			errMsg = "An error occurred during function execution."
		}
		resp := buildRendererErrorResponse(callID, RPCCodeExecutionError, errMsg, version)
		r.emitOutbound(resp)
		return resp, nil
	}

	resp := buildRendererSuccessResponse(callID, val, version)
	r.emitOutbound(resp)
	return resp, nil
}

func executeFunctionRecover(eval FunctionEvaluator, args map[string]any, ctx *DataContext) (val any, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			if e, ok := rec.(error); ok {
				err = e
			} else {
				err = fmt.Errorf("%v", rec)
			}
		}
	}()
	return eval(args, ctx)
}

func (r *RPCHandler) ensureDataContext(ctx *DataContext, matchedCat *Catalog, callID string) *DataContext {
	if ctx != nil {
		return ctx
	}
	r.mu.Lock()
	cats := append([]*Catalog(nil), r.catalogs...)
	r.mu.Unlock()
	fallback := NewSurfaceModel("_rpc_fallback_"+callID, matchedCat.CatalogID(), matchedCat)
	for _, cat := range cats {
		if cat != nil && isCatalogVersionCompatible(string(cat.ProtocolVersion()), string(matchedCat.ProtocolVersion())) {
			fallback.AvailableCatalogs[cat.CatalogID()] = cat
		}
	}
	return NewDataContext(fallback, "/")
}

func resolveRPCArguments(args map[string]any, ctx *DataContext) (map[string]any, string) {
	if ctx == nil || len(args) == 0 {
		out := map[string]any{}
		for k, v := range args {
			out[k] = CloneJSONValue(v)
		}
		return out, ""
	}

	var capturedErr string
	var origLen int
	if ctx.Surface != nil {
		origLen = len(ctx.Surface.OnError)
		ctx.Surface.OnError = append(ctx.Surface.OnError, func(errObj map[string]any) {
			if capturedErr != "" || errObj == nil {
				return
			}
			code, _ := errObj["code"].(string)
			if code == "CATALOG_ERROR" || code == "EXPRESSION_ERROR" || code == "EXECUTION_ERROR" {
				msg, _ := errObj["message"].(string)
				if msg == "" {
					msg = unresolvedArgumentMessage
				}
				capturedErr = msg
			}
		})
		defer func() {
			if len(ctx.Surface.OnError) > origLen {
				ctx.Surface.OnError = ctx.Surface.OnError[:origLen]
			}
		}()
	}

	out := make(map[string]any, len(args))
	for k, v := range args {
		if resolveDynamicNoAgentHook != nil {
			resolved, err := resolveDynamicNoAgentHook(ctx, v)
			if err != nil {
				msg := err.Error()
				if msg == "" {
					msg = unresolvedArgumentMessage
				}
				return nil, msg
			}
			out[k] = resolved
		} else {
			out[k] = CloneJSONValue(v)
		}
		if capturedErr != "" {
			return nil, capturedErr
		}
	}
	if capturedErr != "" {
		return nil, capturedErr
	}
	return out, ""
}

// HandleAgentFunctionResponse settles a pending outbound callAgentFunction request if present.
func (r *RPCHandler) HandleAgentFunctionResponse(resp FunctionResponsePayload) {
	if resp.FunctionCallID == "" {
		return
	}
	r.mu.Lock()
	entry, exists := r.pending[resp.FunctionCallID]
	if exists {
		delete(r.pending, resp.FunctionCallID)
	}
	r.mu.Unlock()
	if !exists || entry == nil {
		return
	}
	if entry.timer != nil {
		entry.timer.Stop()
	}
	if resp.Error != nil {
		errCode := RPCErrorCode(resp.Error.Code)
		if errCode == "" {
			errCode = RPCCodeUnknownError
		}
		errMsg := resp.Error.Message
		if errMsg == "" {
			errMsg = "Agent function execution failed"
		}
		rpcErr := NewRPCError(errCode, errMsg)
		rpcErr.FunctionCallID = resp.FunctionCallID
		entry.future.settle(nil, rpcErr)
		return
	}
	entry.future.settle(resp.Value, nil)
}

// HandleAgentFunctionResponseMessage parses a raw v1.0 agentFunctionResponse envelope map and settles any matching pending call.
func (r *RPCHandler) HandleAgentFunctionResponseMessage(msg map[string]any) {
	if msg == nil {
		return
	}
	respObj, ok := msg["agentFunctionResponse"].(map[string]any)
	if !ok || respObj == nil {
		return
	}
	fcID, _ := respObj["functionCallId"].(string)
	val, hasVal := respObj["value"]
	var fnErr *FunctionResponseError
	if errMap, ok := respObj["error"].(map[string]any); ok && errMap != nil {
		c, _ := errMap["code"].(string)
		m, _ := errMap["message"].(string)
		fnErr = &FunctionResponseError{Code: c, Message: m}
	}
	r.HandleAgentFunctionResponse(FunctionResponsePayload{
		FunctionCallID: fcID,
		Value:          val,
		HasValue:       hasVal,
		Error:          fnErr,
	})
}

// CallAgentFunction emits a v1.0 callAgentFunction message and returns an AgentCallFuture for its response.
func (r *RPCHandler) CallAgentFunction(surfaceID string, call CallFunctionPayload, opts *AgentCallOptions) (*AgentCallFuture, error) {
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return nil, NewRPCError(RPCCodeDisposed, "RpcHandler has been disposed.")
	}
	listener := r.outboundListener
	if listener == nil {
		r.mu.Unlock()
		return nil, NewRPCError(RPCCodeNoListener, "Cannot call agent function without outbound_listener configured.")
	}
	if call.Call == "" {
		r.mu.Unlock()
		return nil, NewRPCError(RPCCodeInvalidFunctionCall, "Missing or invalid function call name.")
	}

	callID := ""
	timeout := r.defaultTimeout
	version := "1.0"
	if opts != nil {
		callID = opts.FunctionCallID
		if opts.Timeout != nil {
			timeout = *opts.Timeout
		}
		if opts.Version != "" {
			version = versionWireOrLabel(opts.Version)
		}
	}
	if callID == "" {
		callID = "call-" + randomHex12()
	}

	if _, dup := r.pending[callID]; dup {
		r.mu.Unlock()
		err := NewRPCError(RPCCodeDuplicate, fmt.Sprintf("A call with functionCallId '%s' is already pending.", callID))
		err.FunctionCallID = callID
		return nil, err
	}

	fut := newPendingAgentCallFuture(callID)
	entry := &pendingAgentCall{
		surfaceID: surfaceID,
		future:    fut,
	}
	if timeout > 0 {
		callName := call.Call
		timeoutMs := float64(timeout) / float64(time.Millisecond)
		entry.timer = time.AfterFunc(timeout, func() {
			r.mu.Lock()
			cur, stillPending := r.pending[callID]
			if stillPending && cur == entry {
				delete(r.pending, callID)
			} else {
				stillPending = false
			}
			r.mu.Unlock()
			if stillPending {
				tErr := NewRPCError(RPCCodeTimeout, fmt.Sprintf("Agent function call '%s' timed out after %gms.", callName, timeoutMs))
				tErr.FunctionCallID = callID
				fut.settle(nil, tErr)
			}
		})
	}
	r.pending[callID] = entry
	r.mu.Unlock()

	callFnMap := map[string]any{
		"@call": call.Call,
	}
	if call.CatalogID != "" {
		callFnMap["catalogId"] = call.CatalogID
	}
	if call.Args != nil {
		callFnMap["args"] = CloneJSONValue(call.Args)
	} else {
		callFnMap["args"] = map[string]any{}
	}

	outboundMsg := map[string]any{
		"version": version,
		"callAgentFunction": map[string]any{
			"surfaceId":      surfaceID,
			"functionCallId": callID,
			"callFunction":   callFnMap,
		},
	}

	delivered := false
	defer func() {
		if !delivered {
			r.mu.Lock()
			if cur, ok := r.pending[callID]; ok && cur == entry {
				delete(r.pending, callID)
			}
			r.mu.Unlock()
			if entry.timer != nil {
				entry.timer.Stop()
			}
		}
	}()
	listener(outboundMsg)
	delivered = true
	return fut, nil
}

func randomHex12() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%012x", time.Now().UnixNano()&0xffffffffffff)
	}
	return hex.EncodeToString(b[:])
}

func canonicalAgentCallKey(call CallFunctionPayload) (string, bool) {
	args := call.Args
	if args == nil {
		args = map[string]any{}
	}
	if !isJSONSerializableValue(args) {
		return "", false
	}
	raw, err := json.Marshal([]any{call.CatalogID, call.Call, args})
	if err != nil {
		return "", false
	}
	return string(raw), true
}

func isJSONSerializableValue(v any) bool {
	switch val := v.(type) {
	case nil, bool, string, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, json.Number:
		return true
	case float32:
		f := float64(val)
		return !math.IsNaN(f) && !math.IsInf(f, 0)
	case float64:
		return !math.IsNaN(val) && !math.IsInf(val, 0)
	case []any:
		for _, item := range val {
			if !isJSONSerializableValue(item) {
				return false
			}
		}
		return true
	case map[string]any:
		for _, item := range val {
			if !isJSONSerializableValue(item) {
				return false
			}
		}
		return true
	default:
		b, err := json.Marshal(v)
		return err == nil && len(b) > 0
	}
}

// CallSurfaceAgentFunction routes call through surf.AgentFunctionCaller with surface caching and in-flight request sharing.
func (s *SurfaceModel) CallSurfaceAgentFunction(call CallFunctionPayload, bypassCache bool) (*AgentCallFuture, error) {
	if s == nil || s.disposed {
		sid := ""
		if s != nil {
			sid = s.ID
		}
		return nil, NewRPCError(RPCCodeCancelled, fmt.Sprintf("Pending calls for surface '%s' were cancelled.", sid))
	}
	caller := s.AgentFunctionCaller
	if caller == nil {
		err := NewExpressionErrorf("Function '%s' is not implemented locally and surface '%s' cannot call the agent.", call.Call, s.ID)
		err.SurfaceID = s.ID
		return nil, err
	}
	key, ok := canonicalAgentCallKey(call)
	if !ok {
		err := NewExpressionErrorf("Function '%s' arguments are not valid JSON, so the call was not sent to the agent.", call.Call)
		err.SurfaceID = s.ID
		return nil, err
	}
	if !bypassCache {
		if cached, hit := s.getCachedAgentCall(key); hit {
			return newSettledAgentCallFuture(cached, nil), nil
		}
		if s.inFlightAgentCalls != nil {
			if existing, inFlight := s.inFlightAgentCalls[key]; inFlight && existing != nil {
				return isolateAgentCallFuture(existing), nil
			}
		}
	}
	if bypassCache {
		return caller(call)
	}

	pending, err := caller(call)
	if err != nil {
		return nil, err
	}
	if s.inFlightAgentCalls == nil {
		s.inFlightAgentCalls = make(map[string]*AgentCallFuture)
	}
	s.inFlightAgentCalls[key] = pending
	pending.then(func(val any, callErr error) {
		if s.inFlightAgentCalls != nil && s.inFlightAgentCalls[key] == pending {
			delete(s.inFlightAgentCalls, key)
		}
		if s.disposed || callErr != nil {
			return
		}
		s.putCachedAgentCall(key, val)
	})
	return isolateAgentCallFuture(pending), nil
}

func isolateAgentCallFuture(src *AgentCallFuture) *AgentCallFuture {
	dst := newPendingAgentCallFuture(src.FunctionCallID)
	src.then(func(val any, err error) {
		dst.settle(CloneJSONValue(val), err)
	})
	return dst
}

func (p *MessageProcessor) makeSurfaceAgentCallExecutor(surf *SurfaceModel) func(call CallFunctionPayload) (any, bool, error) {
	surf.AgentFunctionCaller = func(call CallFunctionPayload) (*AgentCallFuture, error) {
		if p.Model.Surface(surf.ID) != surf {
			return nil, NewRPCError(RPCCodeCancelled, fmt.Sprintf("Pending calls for surface '%s' were cancelled.", surf.ID))
		}
		return p.RPC.CallAgentFunction(surf.ID, call, &AgentCallOptions{Version: Version1_0})
	}
	return func(call CallFunctionPayload) (any, bool, error) {
		fut, err := surf.CallSurfaceAgentFunction(call, false)
		if err != nil {
			return nil, false, err
		}
		val, settled, fErr := fut.Result()
		if !settled {
			return nil, false, nil
		}
		return val, true, fErr
	}
}
