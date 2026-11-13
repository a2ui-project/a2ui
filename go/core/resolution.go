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
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
)

func init() {
	resolveDynamicNoAgentHook = func(ctx *DataContext, val any) (any, error) {
		if ctx == nil {
			return CloneJSONValue(val), nil
		}
		return ctx.ResolveWithoutAgent(val)
	}
}

// abortController cancels stale asynchronous evaluations when a reactive binding re-evaluates or unsubscribes.
type abortController struct {
	mu      sync.Mutex
	aborted bool
	cbs     []func()
}

// newAbortController creates an active abortController.
func newAbortController() *abortController {
	return &abortController{}
}

// Aborted reports whether Abort has been called.
func (a *abortController) Aborted() bool {
	if a == nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.aborted
}

// Abort marks the controller aborted and runs registered callbacks once.
func (a *abortController) Abort() {
	if a == nil {
		return
	}
	a.mu.Lock()
	if a.aborted {
		a.mu.Unlock()
		return
	}
	a.aborted = true
	cbs := a.cbs
	a.cbs = nil
	a.mu.Unlock()
	for _, cb := range cbs {
		cb()
	}
}

// OnAbort registers cb to run when Abort is called (or immediately if already aborted).
func (a *abortController) OnAbort(cb func()) {
	if a == nil || cb == nil {
		return
	}
	a.mu.Lock()
	if a.aborted {
		a.mu.Unlock()
		cb()
		return
	}
	a.cbs = append(a.cbs, cb)
	a.mu.Unlock()
}

func childAbortController(parent *abortController) *abortController {
	ch := newAbortController()
	if parent != nil {
		parent.OnAbort(ch.Abort)
	}
	return ch
}

// PendingResult represents an asynchronous value (such as an in-flight callAgentFunction) during resolution.
type PendingResult struct {
	mu      sync.Mutex
	settled bool
	failed  bool
	value   any
	cbs     []func()
}

func newPendingResult() *PendingResult {
	return &PendingResult{}
}

func newFailedPendingResult() *PendingResult {
	return &PendingResult{settled: true, failed: true}
}

func (p *PendingResult) settle(val any) {
	p.mu.Lock()
	if p.settled {
		p.mu.Unlock()
		return
	}
	p.settled = true
	p.value = CloneJSONValue(val)
	cbs := p.cbs
	p.cbs = nil
	p.mu.Unlock()
	for _, cb := range cbs {
		cb()
	}
}

func (p *PendingResult) fail() {
	p.mu.Lock()
	if p.settled {
		p.mu.Unlock()
		return
	}
	p.settled = true
	p.failed = true
	cbs := p.cbs
	p.cbs = nil
	p.mu.Unlock()
	for _, cb := range cbs {
		cb()
	}
}

func (p *PendingResult) whenSettled(cb func()) {
	if cb == nil {
		return
	}
	p.mu.Lock()
	if p.settled {
		p.mu.Unlock()
		cb()
		return
	}
	p.cbs = append(p.cbs, cb)
	p.mu.Unlock()
}

// Peek returns the current value (nil while pending or failed).
func (p *PendingResult) Peek() any {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return CloneJSONValue(p.value)
}

// State returns (settled, failed).
func (p *PendingResult) State() (settled bool, failed bool) {
	if p == nil {
		return true, false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.settled, p.failed
}

func collectPendingResults(v any, out *[]*PendingResult) {
	switch typed := v.(type) {
	case *PendingResult:
		if typed != nil {
			settled, _ := typed.State()
			if !settled {
				*out = append(*out, typed)
			}
		}
	case map[string]any:
		for _, item := range typed {
			collectPendingResults(item, out)
		}
	case []any:
		for _, item := range typed {
			collectPendingResults(item, out)
		}
	}
}

func hasFailedPendingResult(v any) bool {
	switch typed := v.(type) {
	case *PendingResult:
		if typed != nil {
			_, failed := typed.State()
			return failed
		}
	case map[string]any:
		for _, item := range typed {
			if hasFailedPendingResult(item) {
				return true
			}
		}
	case []any:
		for _, item := range typed {
			if hasFailedPendingResult(item) {
				return true
			}
		}
	}
	return false
}

func unwrapPendingResults(v any) any {
	switch typed := v.(type) {
	case *PendingResult:
		if typed == nil {
			return nil
		}
		return typed.Peek()
	case map[string]any:
		out := make(map[string]any, len(typed))
		for k, item := range typed {
			out[k] = unwrapPendingResults(item)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = unwrapPendingResults(item)
		}
		return out
	default:
		return v
	}
}

func whenAllSettled(pending []*PendingResult, cb func()) {
	if len(pending) == 0 {
		cb()
		return
	}
	var mu sync.Mutex
	rem := len(pending)
	for _, p := range pending {
		p.whenSettled(func() {
			mu.Lock()
			rem--
			done := rem == 0
			mu.Unlock()
			if done {
				cb()
			}
		})
	}
}

type agentCallMemory struct {
	failed map[string]bool
	made   map[string]bool
}

func newAgentCallMemory() *agentCallMemory {
	return &agentCallMemory{
		failed: map[string]bool{},
		made:   map[string]bool{},
	}
}

func (m *agentCallMemory) startEvaluation() {
	nextFailed := map[string]bool{}
	for k := range m.failed {
		if m.made[k] {
			nextFailed[k] = true
		}
	}
	m.failed = nextFailed
	m.made = map[string]bool{}
}

func (m *agentCallMemory) makeCall(key string) bool {
	m.made[key] = true
	return m.failed[key]
}

func (m *agentCallMemory) record(key string, failed bool) {
	if failed {
		m.failed[key] = true
	} else {
		delete(m.failed, key)
	}
}

// DynamicValueState holds a reactively subscribed value and whether any nested call is still pending.
type DynamicValueState struct {
	Value   any
	Pending bool
}

// DynamicSubscription represents an active reactive subscription on a DataContext.
type DynamicSubscription struct {
	InitialState DynamicValueState
	Unsubscribe  func()
}

// SurfaceProtocolVersion returns the effective ProtocolVersion for this DataContext.
func (c *DataContext) SurfaceProtocolVersion() ProtocolVersion {
	if c == nil {
		return Version0_9
	}
	if c.Surface != nil && c.Surface.ProtocolVersion != "" {
		return c.Surface.ProtocolVersion
	}
	if c.Surface != nil && c.Surface.Catalog != nil && c.Surface.Catalog.ProtocolVersion() != "" {
		return c.Surface.Catalog.ProtocolVersion()
	}
	for cur := c; cur != nil; cur = cur.Parent {
		if cur.ActiveCatalog != nil && cur.ActiveCatalog.ProtocolVersion() != "" {
			return cur.ActiveCatalog.ProtocolVersion()
		}
	}
	return Version0_9
}

// AtLeastV10 reports whether this DataContext targets protocol version v1.0 or later.
func (c *DataContext) AtLeastV10() bool {
	return IsAtLeastVersion(string(c.SurfaceProtocolVersion()), Version1_0)
}

// EffectiveIndexOrPath returns an explicit IterationIndex or trailing numeric path segment index.
func (c *DataContext) EffectiveIndexOrPath() (int, bool) {
	for cur := c; cur != nil; cur = cur.Parent {
		if cur.IterationIndex != nil {
			return *cur.IterationIndex, true
		}
		trimmed := strings.Trim(cur.ContextPath, "/")
		if trimmed != "" {
			parts := strings.Split(trimmed, "/")
			last := parts[len(parts)-1]
			if idx, ok := parseCanonicalArrayIndex(last); ok {
				return idx, true
			}
		}
	}
	return 0, false
}

// Set writes value into the DataModel at relOrAbsPath resolved against ContextPath.
func (c *DataContext) Set(relOrAbsPath string, val any) error {
	if c == nil || c.Model == nil {
		return nil
	}
	abs, err := c.ResolvePath(relOrAbsPath)
	if err != nil {
		return err
	}
	return c.Model.Set(abs, val)
}

type evalOptions struct {
	peek          bool
	keepFailed    bool
	agentDisabled bool
	inAction      bool
	userActivated bool
	abort         *abortController
	memory        *agentCallMemory
	keyOrder      map[string][]string
}

// ResolveDynamicValue evaluates literals, @path/path bindings, and @call/call functions synchronously.
func (c *DataContext) ResolveDynamicValue(val any) (any, error) {
	res, err := c.resolveValueWithOpts(val, evalOptions{
		peek:          true,
		keepFailed:    false,
		inAction:      c != nil && c.InAction,
		userActivated: c != nil && c.EffectiveUserActivated(),
	})
	if err != nil {
		return nil, err
	}
	return unwrapPendingResults(res), nil
}

// ResolveWithoutAgent evaluates val like ResolveDynamicValue while disabling fallback agent routing and cache reads.
func (c *DataContext) ResolveWithoutAgent(val any) (any, error) {
	res, err := c.resolveValueWithOpts(val, evalOptions{
		peek:          true,
		keepFailed:    false,
		agentDisabled: true,
		inAction:      c != nil && c.InAction,
		userActivated: c != nil && c.EffectiveUserActivated(),
	})
	if err != nil {
		return nil, err
	}
	return unwrapPendingResults(res), nil
}

func (c *DataContext) lookupScopedCatalog(catalogID string) *Catalog {
	for cur := c; cur != nil; cur = cur.Parent {
		if cur.ActiveCatalogID != "" {
			if cur.ActiveCatalogID == catalogID {
				return cur.ActiveCatalog
			}
			return nil
		}
	}
	return nil
}

func isCancellationError(err error) bool {
	if err == nil {
		return false
	}
	if rpcErr, ok := err.(*RPCError); ok && rpcErr.RPCCode == RPCCodeCancelled {
		return true
	}
	return false
}

func (c *DataContext) dispatchFunctionError(err error, fnName string, codeOverride string) bool {
	if c == nil || c.Surface == nil {
		return false
	}
	if c.Surface.Disposed() {
		return true
	}
	code := codeOverride
	if code == "" {
		if _, isCat := err.(*CatalogError); isCat {
			code = "CATALOG_ERROR"
		} else {
			code = "EXPRESSION_ERROR"
		}
	}
	payload := map[string]any{
		"code":       code,
		"surfaceId":  c.Surface.ID,
		"message":    err.Error(),
		"expression": fnName,
	}
	if rpcErr, ok := err.(*RPCError); ok && rpcErr.FunctionCallID != "" {
		payload["functionCallId"] = rpcErr.FunctionCallID
	}
	c.Surface.DispatchError(payload)
	return true
}

func (c *DataContext) resolveValueWithOpts(val any, opts evalOptions) (any, error) {
	if val == nil {
		return nil, nil
	}
	atLeastV10 := c.AtLeastV10()
	protoVer := c.SurfaceProtocolVersion()

	if m, isMap := val.(map[string]any); isMap {
		if !hasKey(m, "componentId") {
			var bindPath string
			hasPath := false
			if atLeastV10 {
				bindPath, hasPath = m["@path"].(string)
			} else {
				bindPath, hasPath = m["path"].(string)
			}
			if hasPath {
				resolvedPath, err := c.ResolvePath(bindPath)
				if err != nil {
					return nil, err
				}
				if c.Model == nil {
					return nil, nil
				}
				v, _, _ := c.Model.Get(resolvedPath)
				return v, nil
			}
		}

		var fnName string
		hasCall := false
		if atLeastV10 {
			fnName, hasCall = m["@call"].(string)
		} else {
			fnName, hasCall = m["call"].(string)
		}
		if hasCall {
			rawArgs := m["args"]
			if rawArgs == nil {
				rawArgs = map[string]any{}
			}
			namesCatalog := false
			var catIDPtr *string
			if atLeastV10 {
				if hasKey(m, "catalogId") {
					namesCatalog = true
					if s, ok := m["catalogId"].(string); ok {
						catIDPtr = &s
					} else {
						empty := ""
						catIDPtr = &empty
					}
				} else if hasKey(m, "catalog_id") {
					namesCatalog = true
					if s, ok := m["catalog_id"].(string); ok {
						catIDPtr = &s
					}
				}
			}
			res, err := c.executeFunction(fnName, rawArgs, catIDPtr, namesCatalog, opts, !opts.peek || opts.keepFailed)
			if err != nil {
				return nil, err
			}
			if pr, isPR := res.(*PendingResult); isPR {
				settled, failed := pr.State()
				if failed && !opts.keepFailed {
					return nil, nil
				}
				if !opts.peek || (opts.keepFailed && (!settled || failed)) {
					return pr, nil
				}
				return pr.Peek(), nil
			}
			return res, nil
		}

		if atLeastV10 {
			keys := make([]string, 0, len(m))
			for k := range m {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			if err := validateReservedDirectives(keys, protoVer); err != nil {
				return nil, err
			}
			out := make(map[string]any, len(m))
			for k, v := range m {
				rv, err := c.resolveValueWithOpts(v, opts)
				if err != nil {
					return nil, err
				}
				out[unescapeAtKey(k)] = rv
			}
			return out, nil
		}

		out := make(map[string]any, len(m))
		for k, v := range m {
			rv, err := c.resolveValueWithOpts(v, opts)
			if err != nil {
				return nil, err
			}
			out[k] = rv
		}
		return out, nil
	}

	if arr, isSlice := val.([]any); isSlice {
		out := make([]any, len(arr))
		for i, item := range arr {
			rv, err := c.resolveValueWithOpts(item, opts)
			if err != nil {
				return nil, err
			}
			out[i] = rv
		}
		return out, nil
	}

	return CloneJSONValue(val), nil
}

func resolveFunctionErrorCode(err error, inAction bool, inBody bool) string {
	if _, isCat := err.(*CatalogError); isCat {
		return "CATALOG_ERROR"
	}
	if inAction && inBody {
		return "EXECUTION_ERROR"
	}
	return "EXPRESSION_ERROR"
}

func (c *DataContext) executeFunction(
	name string,
	rawArgs any,
	catalogID *string,
	namesCatalog bool,
	opts evalOptions,
	canWait bool,
) (any, error) {
	inBody := false
	inAction := opts.inAction || (c != nil && c.InAction)
	userAct := opts.userActivated || (c != nil && c.EffectiveUserActivated())

	handleErr := func(err error) (any, error) {
		if isCancellationError(err) {
			if opts.keepFailed {
				return newFailedPendingResult(), nil
			}
			return nil, nil
		}
		code := resolveFunctionErrorCode(err, inAction, inBody)
		if c.dispatchFunctionError(err, name, code) {
			if opts.keepFailed {
				return newFailedPendingResult(), nil
			}
			return nil, nil
		}
		return nil, err
	}

	if argsMap, ok := rawArgs.(map[string]any); ok && len(argsMap) > MaxFunctionCallArgs {
		return handleErr(NewExpressionErrorf("Function call '%s' exceeds maximum allowed arguments count (%d)", name, MaxFunctionCallArgs))
	}

	atLeastV10 := c.AtLeastV10()
	protoVer := c.SurfaceProtocolVersion()

	var localEval FunctionEvaluator
	var fnSpec *FunctionAPI
	var targetCatalog *Catalog

	if atLeastV10 && strings.HasPrefix(name, "@") {
		if namesCatalog {
			return handleErr(NewExpressionErrorf("System function '%s' belongs to no catalog and must not name a catalogId", name))
		}
		if _, err := validateSystemFunction(name, rawArgs, protoVer, nil); err != nil {
			return handleErr(NewExpressionError(err.Error()))
		}
		if name != "@index" {
			return handleErr(NewExpressionErrorf("System function '%s' not found.", name))
		}
		localEval = evaluateSystemIndex
	} else {
		if catalogID != nil {
			targetCatalog = c.lookupScopedCatalog(*catalogID)
		}
		if targetCatalog == nil {
			if c.Surface != nil {
				var err error
				targetCatalog, err = c.Surface.ResolveCatalog(catalogID, fmt.Sprintf("Function call '%s'", name))
				if err != nil {
					return handleErr(err)
				}
			} else if c.ActiveCatalog != nil && (catalogID == nil || *catalogID == c.ActiveCatalogID) {
				targetCatalog = c.ActiveCatalog
			} else {
				catLabel := "default"
				if catalogID != nil {
					catLabel = *catalogID
				}
				return handleErr(NewCatalogErrorf("No surface available to resolve catalog: %s", catLabel))
			}
		}

		if api, exists := targetCatalog.functionByName(name); exists {
			apiCopy := api
			fnSpec = &apiCopy
			localEval = apiCopy.Evaluate
		}

		if fnSpec != nil && fnSpec.AllowedCallers == AllowedCallersAgentOnly {
			return handleErr(NewExpressionErrorf("Function '%s' cannot be called by renderer (allowedCallers is agentOnly).", name))
		}

		routesToAgent := atLeastV10 && c.Surface != nil && c.Surface.AgentFunctionCaller != nil && localEval == nil
		if opts.agentDisabled && (localEval == nil) && atLeastV10 {
			return handleErr(NewExpressionErrorf("Function '%s' is not implemented by the renderer.", name))
		}
		if routesToAgent {
			res, err := c.routeCallToAgent(name, rawArgs, targetCatalog, fnSpec, opts, !canWait)
			if err != nil {
				return handleErr(err)
			}
			return res, nil
		}

		if _, err := NewPayloadValidator(targetCatalog, nil).ValidateFunctionArgs(name, rawArgs); err != nil {
			return handleErr(NewExpressionErrorf("Validation failed for function '%s': %v", name, err))
		}
		if fnSpec == nil || localEval == nil {
			return handleErr(NewExpressionErrorf("Function '%s' not found in catalog '%s'.", name, targetCatalog.CatalogID()))
		}
	}

	if inAction && !userAct && ((fnSpec != nil && fnSpec.RequiresUserActivation) || name == "openUrl") {
		return handleErr(NewExpressionErrorf("Function '%s' requires user activation.", name))
	}

	inBody = true
	scopedCtx := c
	if targetCatalog != nil {
		scopedCtx = c.WithActiveCatalog(targetCatalog.CatalogID(), targetCatalog)
	} else if scopedCtx != nil {
		cp := *scopedCtx
		scopedCtx = &cp
	}
	if scopedCtx != nil {
		scopedCtx.IsUserActivated = userAct
		scopedCtx.InAction = inAction
	}

	var resolvedFnSchema map[string]any
	if targetCatalog != nil && fnSpec != nil {
		resolvedFnSchema = targetCatalog.ResolvedFunctionSchema(name)
	}

	runLocal := func(settledArgs any) (any, error) {
		argsMap, _ := settledArgs.(map[string]any)
		if argsMap == nil {
			argsMap = map[string]any{}
		} else if resolvedFnSchema != nil {
			argsMap = coerceValidationResults(resolvedFnSchema, argsMap)
		}
		return executeFunctionRecover(localEval, argsMap, scopedCtx)
	}

	argsAbort := childAbortController(opts.abort)
	argOpts := opts
	argOpts.peek = false
	argOpts.keepFailed = true
	argOpts.abort = argsAbort

	resolvedArgs, argErr := c.resolveValueWithOpts(rawArgs, argOpts)
	if argErr != nil {
		return handleErr(argErr)
	}

	val, runErr := c.runWhenArgsSettled(name, resolvedArgs, runLocal, opts.abort, argsAbort, inAction, true)
	if runErr != nil {
		return handleErr(runErr)
	}
	return val, nil
}

func (c *DataContext) runWhenArgsSettled(
	name string,
	resolvedArgs any,
	run func(any) (any, error),
	abort *abortController,
	argsAbort *abortController,
	inAction bool,
	inBody bool,
) (any, error) {
	var pending []*PendingResult
	collectPendingResults(resolvedArgs, &pending)
	if hasFailedPendingResult(resolvedArgs) {
		if len(pending) > 0 && argsAbort != nil {
			argsAbort.Abort()
		}
		return newFailedPendingResult(), nil
	}
	if len(pending) == 0 {
		return run(unwrapPendingResults(resolvedArgs))
	}

	deferred := newPendingResult()
	var mu sync.Mutex
	rem := len(pending)
	for _, p := range pending {
		p.whenSettled(func() {
			mu.Lock()
			if done, _ := deferred.State(); done {
				mu.Unlock()
				return
			}
			if hasFailedPendingResult(resolvedArgs) {
				mu.Unlock()
				if argsAbort != nil {
					argsAbort.Abort()
				}
				deferred.fail()
				return
			}
			rem--
			ready := rem == 0
			mu.Unlock()
			if !ready {
				return
			}
			if (abort != nil && abort.Aborted()) || (c.Surface != nil && c.Surface.Disposed()) {
				return
			}
			if hasFailedPendingResult(resolvedArgs) {
				deferred.fail()
				return
			}
			res, err := run(unwrapPendingResults(resolvedArgs))
			if err != nil {
				if !isCancellationError(err) {
					code := resolveFunctionErrorCode(err, inAction, inBody)
					c.dispatchFunctionError(err, name, code)
				}
				deferred.fail()
				return
			}
			if subPR, ok := res.(*PendingResult); ok {
				subPR.whenSettled(func() {
					_, subFailed := subPR.State()
					if subFailed {
						deferred.fail()
					} else {
						deferred.settle(subPR.Peek())
					}
				})
				return
			}
			deferred.settle(res)
		})
	}
	return deferred, nil
}

func fillObjectSchemaDefaults(props map[string]any, val map[string]any, defs map[string]any) map[string]any {
	filled := make(map[string]any, len(val)+len(props))
	for k, v := range val {
		filled[k] = v
	}
	for key, rawProp := range props {
		prop := derefLocalDef(rawProp, defs)
		pm, ok := prop.(map[string]any)
		if !ok {
			continue
		}
		if !hasKey(filled, key) && hasKey(pm, "default") {
			filled[key] = CloneJSONValue(pm["default"])
		}
		if nestedProps, ok := pm["properties"].(map[string]any); ok {
			if subMap, isMap := filled[key].(map[string]any); isMap {
				filled[key] = fillObjectSchemaDefaults(nestedProps, subMap, defs)
			}
		}
	}
	return filled
}

func derefLocalDef(schema any, defs map[string]any) any {
	seen := map[string]bool{}
	cur := schema
	for {
		sm, ok := cur.(map[string]any)
		if !ok {
			return cur
		}
		ref, ok := sm["$ref"].(string)
		if !ok || !strings.HasPrefix(ref, "#/$defs/") || seen[ref] {
			return cur
		}
		seen[ref] = true
		name := strings.TrimPrefix(ref, "#/$defs/")
		if target, exists := defs[name]; exists {
			cur = target
		} else {
			return cur
		}
	}
}

func applyFunctionSchemaDefaults(fnSchema map[string]any, args map[string]any) map[string]any {
	if fnSchema == nil {
		return args
	}
	props := functionArgsProperties(fnSchema)
	if props == nil {
		return args
	}
	defs, _ := fnSchema["$defs"].(map[string]any)
	return fillObjectSchemaDefaults(props, args, defs)
}

func (c *DataContext) routeCallToAgent(
	name string,
	rawArgs any,
	targetCatalog *Catalog,
	fnSpec *FunctionAPI,
	opts evalOptions,
	settledOnly bool,
) (any, error) {
	catID := targetCatalog.CatalogID()
	inAction := opts.inAction || (c != nil && c.InAction)
	userAct := opts.userActivated || (c != nil && c.EffectiveUserActivated())

	var argsSchema map[string]any
	if fnSpec == nil {
		relaxed := ValidationConfig{AllowUnknownElements: true}
		if _, err := NewPayloadValidator(targetCatalog, &relaxed).ValidateFunctionArgs(name, rawArgs); err != nil {
			return nil, NewExpressionErrorf("Validation failed for function '%s': %v", name, err)
		}
	} else {
		if fnSpec.RequiresUserActivation && !userAct {
			return nil, NewExpressionErrorf("Function '%s' requires user activation and cannot be evaluated without an active user gesture.", name)
		}
		if err := NewPayloadValidator(targetCatalog, nil).validateFunctionIdentifiers(name, rawArgs); err != nil {
			return nil, NewExpressionErrorf("Validation failed for function '%s': %v", name, err)
		}
		argsSchema = targetCatalog.ResolvedFunctionSchema(name)
	}

	prepareCall := func(settledArgs any) (CallFunctionPayload, error) {
		argsMap := map[string]any{}
		if m, ok := settledArgs.(map[string]any); ok {
			for k, v := range m {
				argsMap[k] = v
			}
		}
		if fnSpec != nil {
			argsMap = coerceValidationResults(argsSchema, argsMap)
			argsMap = applyFunctionSchemaDefaults(argsSchema, argsMap)
			validated, err := NewPayloadValidator(targetCatalog, nil).ValidateFunctionArgs(name, argsMap)
			if err != nil {
				return CallFunctionPayload{}, NewExpressionErrorf("Validation failed for function '%s': %v", name, err)
			}
			if validated != nil {
				argsMap = validated
			}
		}
		return CallFunctionPayload{
			Call:      name,
			CatalogID: catID,
			Args:      argsMap,
		}, nil
	}

	if settledOnly {
		syncOpts := opts
		syncOpts.peek = true
		syncOpts.keepFailed = false
		resolved, err := c.resolveValueWithOpts(rawArgs, syncOpts)
		if err != nil {
			return nil, err
		}
		callPayload, err := prepareCall(resolved)
		if err != nil {
			return nil, err
		}
		key, ok := canonicalAgentCallKey(callPayload)
		if ok && c.Surface != nil {
			if cached, hit := c.Surface.getCachedAgentCall(key); hit {
				return cached, nil
			}
		}
		return nil, NewExpressionErrorf("Function '%s' is not implemented locally, and its result can't be awaited here, so it was not sent to the agent.", name)
	}

	bypassCache := inAction
	mem := opts.memory

	sendFn := func(settledArgs any) (any, error) {
		if opts.abort != nil && opts.abort.Aborted() {
			return newPendingResult(), nil
		}
		callPayload, err := prepareCall(settledArgs)
		if err != nil {
			return nil, err
		}
		var key string
		if !bypassCache && mem != nil {
			if k, ok := canonicalAgentCallKey(callPayload); ok {
				key = k
				if mem.makeCall(key) {
					return newFailedPendingResult(), nil
				}
			}
		}
		fut, err := c.Surface.CallSurfaceAgentFunction(callPayload, bypassCache)
		if err != nil {
			return nil, err
		}
		pr := newPendingResult()
		recordMem := func(failed bool) {
			if key != "" && mem != nil {
				mem.record(key, failed)
			}
		}
		if val, done, fErr := fut.Result(); done && fErr == nil {
			recordMem(false)
			pr.settle(val)
			return pr, nil
		}
		fut.then(func(val any, fErr error) {
			if (opts.abort != nil && opts.abort.Aborted()) || (c.Surface != nil && c.Surface.Disposed()) {
				return
			}
			if isCancellationError(fErr) {
				pr.fail()
				return
			}
			if fErr == nil {
				recordMem(false)
				pr.settle(val)
				return
			}
			recordMem(true)
			c.dispatchFunctionError(fErr, name, "EXPRESSION_ERROR")
			pr.fail()
		})
		return pr, nil
	}

	argsAbort := childAbortController(opts.abort)
	argOpts := opts
	argOpts.peek = false
	argOpts.keepFailed = true
	argOpts.abort = argsAbort

	resolvedArgs, argErr := c.resolveValueWithOpts(rawArgs, argOpts)
	if argErr != nil {
		return nil, argErr
	}
	return c.runWhenArgsSettled(name, resolvedArgs, sendFn, opts.abort, argsAbort, inAction, false)
}

// SubscribeDynamicValue subscribes to reactive updates of val (paths and/or nested function calls).
func (c *DataContext) SubscribeDynamicValue(val any, onChange func(any)) *DynamicSubscription {
	sub := c.SubscribeDynamicState(val, func(st DynamicValueState, valueChanged bool) {
		if valueChanged && onChange != nil {
			onChange(st.Value)
		}
	})
	return sub
}

// SubscribeDynamicState subscribes to reactive updates of val along with pending state transitions.
func (c *DataContext) SubscribeDynamicState(val any, onState func(st DynamicValueState, valueChanged bool)) *DynamicSubscription {
	atLeastV10 := c.AtLeastV10()
	pathSet := map[string]bool{}
	var extractPaths func(v any)
	extractPaths = func(v any) {
		switch typed := v.(type) {
		case map[string]any:
			if !hasKey(typed, "componentId") {
				var p string
				hasP := false
				if atLeastV10 {
					p, hasP = typed["@path"].(string)
				} else {
					p, hasP = typed["path"].(string)
				}
				if hasP {
					if abs, err := c.ResolvePath(p); err == nil {
						pathSet[abs] = true
					}
					return
				}
			}
			for _, sub := range typed {
				extractPaths(sub)
			}
		case []any:
			for _, item := range typed {
				extractPaths(item)
			}
		}
	}
	extractPaths(val)

	var pathUnsubs []func()
	var currentAbort *abortController
	mem := newAgentCallMemory()
	var currentRaw any
	var curState DynamicValueState
	hasValue := false
	isSync := true

	publish := func(newVal any, valueChanged bool) {
		var pending []*PendingResult
		collectPendingResults(currentRaw, &pending)
		nextState := DynamicValueState{
			Value:   newVal,
			Pending: len(pending) > 0,
		}
		if hasValue && !valueChanged && nextState.Pending == curState.Pending {
			return
		}
		curState = nextState
		hasValue = true
		if !isSync && onState != nil {
			onState(nextState, valueChanged)
		}
	}

	var runEval func()
	runEval = func() {
		if currentAbort != nil {
			currentAbort.Abort()
		}
		sig := newAbortController()
		currentAbort = sig
		mem.startEvaluation()

		rawRes, err := c.resolveValueWithOpts(val, evalOptions{
			peek:          false,
			keepFailed:    false,
			inAction:      c != nil && c.InAction,
			userActivated: c != nil && c.EffectiveUserActivated(),
			abort:         sig,
			memory:        mem,
		})
		if err != nil {
			rawRes = nil
		}
		currentRaw = rawRes

		var pending []*PendingResult
		collectPendingResults(rawRes, &pending)
		unwrapped := unwrapPendingResults(rawRes)
		changed := !hasValue || !reflect.DeepEqual(curState.Value, unwrapped)
		publish(unwrapped, changed)

		for _, pr := range pending {
			pr.whenSettled(func() {
				if sig.Aborted() {
					return
				}
				// Re-evaluate full expression when a nested pending call settles so outer functions (like formatString) run with the settled value!
				if _, isTopPR := rawRes.(*PendingResult); isTopPR {
					nextVal := unwrapPendingResults(rawRes)
					valChanged := !reflect.DeepEqual(curState.Value, nextVal)
					publish(nextVal, valChanged)
				} else {
					runEval()
				}
			})
		}
	}

	if c != nil && c.Model != nil && len(pathSet) > 0 {
		paths := make([]string, 0, len(pathSet))
		for p := range pathSet {
			paths = append(paths, p)
		}
		sort.Strings(paths)
		for _, p := range paths {
			if unsub, err := c.Model.Watch(p, func(_ any) { runEval() }); err == nil {
				pathUnsubs = append(pathUnsubs, unsub)
			}
		}
	}

	runEval()
	isSync = false

	return &DynamicSubscription{
		InitialState: curState,
		Unsubscribe: func() {
			if currentAbort != nil {
				currentAbort.Abort()
				currentAbort = nil
			}
			for _, u := range pathUnsubs {
				u()
			}
			pathUnsubs = nil
		},
	}
}
