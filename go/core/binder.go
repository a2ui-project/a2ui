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
	"strconv"
	"strings"
	"time"
)

// ResolveAction evaluates an A2UI action map (event or functionCall) with optional keyOrder for deterministic sequential context resolution.
func (c *DataContext) ResolveAction(action map[string]any, isUserActivated bool) any {
	return c.ResolveActionWithKeyOrder(action, isUserActivated, nil)
}

// ResolveActionWithKeyOrder evaluates action, using keyOrder (path -> ordered keys, e.g. "event.context" or "context") when provided.
func (c *DataContext) ResolveActionWithKeyOrder(action map[string]any, isUserActivated bool, keyOrder map[string][]string) any {
	if action == nil {
		return nil
	}
	opts := evalOptions{
		peek:          true,
		keepFailed:    true,
		inAction:      true,
		userActivated: isUserActivated,
		keyOrder:      keyOrder,
	}

	if evt, ok := action["event"].(map[string]any); ok {
		return c.resolveEventAction(action, evt, "event", opts)
	}
	if _, hasName := action["name"]; hasName {
		return c.resolveDirectEventAction(action, opts)
	}
	if fc, ok := action["functionCall"].(map[string]any); ok {
		return c.resolveFunctionCallAction(action, fc, opts)
	}
	if hasKey(action, "functionCall") {
		v, _ := c.ResolveDynamicValue(action["functionCall"])
		return v
	}
	if _, ok := action["@call"].(string); ok {
		return c.resolveFunctionCallAction(action, action, opts)
	}
	if _, ok := action["call"].(string); ok {
		return c.resolveFunctionCallAction(action, action, opts)
	}
	return action
}

func orderedContextKeys(ctxMap map[string]any, keyOrder map[string][]string, orderPaths ...string) []string {
	for _, op := range orderPaths {
		if keyOrder != nil {
			if ord, ok := keyOrder[op]; ok && len(ord) > 0 {
				var out []string
				seen := map[string]bool{}
				for _, k := range ord {
					if hasKey(ctxMap, k) && !seen[k] {
						out = append(out, k)
						seen[k] = true
					}
				}
				for k := range ctxMap {
					if !seen[k] {
						out = append(out, k)
					}
				}
				return out
			}
		}
	}
	keys := make([]string, 0, len(ctxMap))
	for k := range ctxMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (c *DataContext) emitInvalidActionError(msg string) {
	if c != nil && c.Surface != nil {
		c.Surface.DispatchError(map[string]any{
			"code":    "INVALID_ACTION",
			"message": msg,
		})
	}
}

func (c *DataContext) resolveEventAction(outer map[string]any, evt map[string]any, prefix string, opts evalOptions) any {
	name, ok := evt["name"].(string)
	if !ok || name == "" {
		c.emitInvalidActionError("Action event is missing required string 'name'.")
		return nil
	}
	ctxMap, hasCtxMap := evt["context"].(map[string]any)
	var keys []string
	var items []any
	var labels []string
	if hasCtxMap {
		keys = orderedContextKeys(ctxMap, opts.keyOrder, "/"+prefix+"/context", prefix+".context", "/context", "context")
		for _, k := range keys {
			items = append(items, ctxMap[k])
			labels = append(labels, prefix+".context."+k)
		}
	}
	hasUM := hasKey(evt, "userMessage") && evt["userMessage"] != nil
	if hasUM {
		items = append(items, evt["userMessage"])
		labels = append(labels, prefix+".userMessage")
	}

	values, okVals := c.resolveActionValues(items, labels, opts)
	if !okVals {
		return nil
	}
	evtCopy := make(map[string]any, len(evt))
	for k, v := range evt {
		evtCopy[k] = v
	}
	if hasKey(evt, "context") {
		resolvedCtx := make(map[string]any, len(keys))
		for i, k := range keys {
			resolvedCtx[k] = values[i]
		}
		evtCopy["context"] = resolvedCtx
	}
	if hasUM {
		umVal := values[len(values)-1]
		if umVal != nil {
			_, isStr := umVal.(string)
			_, isPR := umVal.(*PendingResult)
			if !isStr && !isPR {
				c.emitInvalidActionError("Action event 'userMessage' must resolve to a string.")
				return nil
			}
		}
		evtCopy["userMessage"] = umVal
	}
	out := make(map[string]any, len(outer))
	for k, v := range outer {
		out[k] = v
	}
	out["event"] = evtCopy
	return out
}

func (c *DataContext) resolveDirectEventAction(action map[string]any, opts evalOptions) any {
	name, ok := action["name"].(string)
	if !ok || name == "" {
		c.emitInvalidActionError("Action event is missing required string 'name'.")
		return nil
	}
	ctxMap, hasCtxMap := action["context"].(map[string]any)
	var keys []string
	var items []any
	var labels []string
	if hasCtxMap {
		keys = orderedContextKeys(ctxMap, opts.keyOrder, "/context", "context")
		for _, k := range keys {
			items = append(items, ctxMap[k])
			labels = append(labels, "context."+k)
		}
	}
	hasUM := hasKey(action, "userMessage") && action["userMessage"] != nil
	if hasUM {
		items = append(items, action["userMessage"])
		labels = append(labels, "userMessage")
	}
	values, okVals := c.resolveActionValues(items, labels, opts)
	if !okVals {
		return nil
	}
	out := make(map[string]any, len(action))
	for k, v := range action {
		out[k] = v
	}
	if hasKey(action, "context") {
		resolvedCtx := make(map[string]any, len(keys))
		for i, k := range keys {
			resolvedCtx[k] = values[i]
		}
		out["context"] = resolvedCtx
	}
	if hasUM {
		umVal := values[len(values)-1]
		if umVal != nil {
			_, isStr := umVal.(string)
			_, isPR := umVal.(*PendingResult)
			if !isStr && !isPR {
				c.emitInvalidActionError("Action event 'userMessage' must resolve to a string.")
				return nil
			}
		}
		out["userMessage"] = umVal
	}
	return out
}

func (c *DataContext) resolveActionValues(items []any, labels []string, opts evalOptions) ([]any, bool) {
	if !c.AtLeastV10() {
		out := make([]any, len(items))
		for i, item := range items {
			v, _ := c.ResolveDynamicValue(item)
			out[i] = v
		}
		return out, true
	}
	return c.resolveItemsInOrder(items, labels, opts)
}

func (c *DataContext) resolveItemsInOrder(items []any, labels []string, opts evalOptions) ([]any, bool) {
	results := make([]any, 0, len(items))
	for idx, item := range items {
		val, err := c.resolveValueWithOpts(item, opts)
		if err != nil {
			label := labels[idx]
			subject := "Action event userMessage"
			if strings.Contains(label, "context.") {
				parts := strings.Split(label, ".")
				subject = fmt.Sprintf("Action event context entry '%s'", parts[len(parts)-1])
			}
			invErr := NewExpressionErrorf("%s is invalid: %v", subject, err)
			if c.dispatchFunctionError(invErr, label, "EXPRESSION_ERROR") {
				return nil, false
			}
			return nil, false
		}
		if hasFailedPendingResult(val) {
			return nil, false
		}
		results = append(results, val)
		var pending []*PendingResult
		collectPendingResults(val, &pending)
		restItems := items[idx+1:]
		if len(pending) > 0 && len(restItems) > 0 {
			placeholders := make([]*PendingResult, len(restItems))
			for i := range placeholders {
				placeholders[i] = newPendingResult()
				results = append(results, placeholders[i])
			}
			restLabels := labels[idx+1:]
			settledVal := val
			whenAllSettled(pending, func() {
				if (c.Surface != nil && c.Surface.Disposed()) || hasFailedPendingResult(settledVal) {
					for _, ph := range placeholders {
						ph.fail()
					}
					return
				}
				nextVals, ok := c.resolveItemsInOrder(restItems, restLabels, opts)
				if !ok {
					for _, ph := range placeholders {
						ph.fail()
					}
					return
				}
				for i, ph := range placeholders {
					nv := nextVals[i]
					var subPending []*PendingResult
					collectPendingResults(nv, &subPending)
					targetPH := ph
					whenAllSettled(subPending, func() {
						if hasFailedPendingResult(nv) {
							targetPH.fail()
						} else {
							targetPH.settle(unwrapPendingResults(nv))
						}
					})
				}
			})
			return results, true
		}
	}
	return results, true
}

func (c *DataContext) resolveFunctionCallAction(outer map[string]any, fc map[string]any, opts evalOptions) any {
	fnName, ok := fc["@call"].(string)
	if !ok {
		fnName, ok = fc["call"].(string)
	}
	if ok && fnName != "" {
		var catIDPtr *string
		namesCat := false
		if c.AtLeastV10() {
			if hasKey(fc, "catalogId") {
				namesCat = true
				if s, isStr := fc["catalogId"].(string); isStr {
					catIDPtr = &s
				} else {
					empty := ""
					catIDPtr = &empty
				}
			} else if hasKey(fc, "catalog_id") {
				namesCat = true
				if s, isStr := fc["catalog_id"].(string); isStr {
					catIDPtr = &s
				}
			}
		}
		rawArgs := fc["args"]
		if rawArgs == nil {
			rawArgs = map[string]any{}
		}
		res, _ := c.executeFunction(fnName, rawArgs, catIDPtr, namesCat, opts, true)
		if pr, isPR := res.(*PendingResult); isPR {
			if _, failed := pr.State(); failed {
				return nil
			}
		}
		return res
	}
	if hasKey(outer, "functionCall") {
		v, _ := c.ResolveDynamicValue(outer["functionCall"])
		return v
	}
	return outer
}

// DispatchResolvedAction validates metadata, waits for any pending results in payload, and emits an action event on s.
func (s *SurfaceModel) DispatchResolvedAction(payload any, sourceComponentID string, metadata map[string]any) error {
	if s == nil || s.Disposed() {
		return nil
	}
	pm, ok := payload.(map[string]any)
	if !ok || pm == nil {
		return nil
	}

	var eventDict map[string]any
	catID, _ := pm["catalogId"].(string)
	if evt, isMap := pm["event"].(map[string]any); isMap {
		eventDict = evt
	} else if hasKey(pm, "name") {
		eventDict = pm
	} else {
		return nil
	}

	name, okName := eventDict["name"].(string)
	if !okName || name == "" {
		s.DispatchError(map[string]any{
			"code":    "INVALID_ACTION",
			"message": "Action event is missing required string 'name'.",
		})
		return nil
	}
	if catID == "" {
		catID, _ = eventDict["catalogId"].(string)
	}

	rawCtx := eventDict["context"]
	rawUM := eventDict["userMessage"]
	hasUM := hasKey(eventDict, "userMessage") && rawUM != nil

	var payloadMeta map[string]any
	if hasKey(eventDict, "metadata") {
		payloadMeta, _ = eventDict["metadata"].(map[string]any)
	} else if hasKey(pm, "metadata") {
		payloadMeta, _ = pm["metadata"].(map[string]any)
	}

	var effectiveMeta map[string]any
	if payloadMeta != nil && metadata != nil {
		if err := ValidateMetadata(payloadMeta, Version1_0); err != nil {
			return err
		}
		if err := ValidateMetadata(metadata, Version1_0); err != nil {
			return err
		}
		mergedExt := map[string]any{}
		if e1, ok := payloadMeta["extensions"].(map[string]any); ok {
			for k, v := range e1 {
				mergedExt[k] = CloneJSONValue(v)
			}
		}
		if e2, ok := metadata["extensions"].(map[string]any); ok {
			for k, v := range e2 {
				mergedExt[k] = CloneJSONValue(v)
			}
		}
		if len(mergedExt) > 0 {
			effectiveMeta = map[string]any{"extensions": mergedExt}
		}
	} else if metadata != nil {
		if err := ValidateMetadata(metadata, Version1_0); err != nil {
			return err
		}
		effectiveMeta = normalizeComponentMetadata(metadata)
	} else if payloadMeta != nil {
		if err := ValidateMetadata(payloadMeta, Version1_0); err != nil {
			return err
		}
		effectiveMeta = normalizeComponentMetadata(payloadMeta)
	}

	var pending []*PendingResult
	collectPendingResults(rawCtx, &pending)
	umHadSignal := false
	if hasUM {
		before := len(pending)
		collectPendingResults(rawUM, &pending)
		_, isTopPR := rawUM.(*PendingResult)
		umHadSignal = len(pending) > before || isTopPR
	}

	finish := func() {
		if s.Disposed() {
			return
		}
		if hasFailedPendingResult(rawCtx) || (hasUM && hasFailedPendingResult(rawUM)) {
			return
		}
		unwrappedCtx := unwrapPendingResults(rawCtx)
		ctxOut, ok := unwrappedCtx.(map[string]any)
		if !ok || ctxOut == nil {
			ctxOut = map[string]any{}
		}

		var resolvedUM any
		if hasUM {
			resolvedUM = unwrapPendingResults(rawUM)
			if resolvedUM != nil {
				if _, isStr := resolvedUM.(string); !isStr {
					if umHadSignal || true {
						s.DispatchError(map[string]any{
							"code":    "INVALID_ACTION",
							"message": "Action event 'userMessage' must resolve to a string.",
						})
						return
					}
				}
			}
		}

		actionEvt := map[string]any{
			"name":              name,
			"surfaceId":         s.ID,
			"sourceComponentId": sourceComponentID,
			"timestamp":         time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
			"context":           ctxOut,
		}
		if catID != "" {
			actionEvt["catalogId"] = catID
		}
		if umStr, isStr := resolvedUM.(string); isStr && umStr != "" {
			actionEvt["userMessage"] = umStr
		}
		if effectiveMeta != nil {
			actionEvt["metadata"] = CloneJSONValue(effectiveMeta)
		}
		s.DispatchAction(actionEvt)
	}

	if len(pending) == 0 {
		finish()
		return nil
	}
	whenAllSettled(pending, finish)
	return nil
}

// ComponentContext binds a ComponentModel to a SurfaceModel and scoped DataContext.
type ComponentContext struct {
	Surface        *SurfaceModel
	ComponentModel *ComponentModel
	DataContext    *DataContext
}

// NewComponentContext constructs a ComponentContext for compID on surf at dataBasePath.
func NewComponentContext(surf *SurfaceModel, compID string, dataBasePath string) (*ComponentContext, error) {
	if surf == nil {
		return nil, NewStateError("surface is nil")
	}
	comp := surf.ComponentsModel.Get(compID)
	if comp == nil {
		return nil, NewIntegrityErrorf("component %q not found on surface %q", compID, surf.ID)
	}
	dctx := NewDataContext(surf, dataBasePath)
	return &ComponentContext{
		Surface:        surf,
		ComponentModel: comp,
		DataContext:    dctx,
	}, nil
}

// DispatchAction dispatches a resolved action payload from this component.
func (cc *ComponentContext) DispatchAction(resolvedPayload any, metadata map[string]any) error {
	if cc == nil || cc.Surface == nil || cc.ComponentModel == nil {
		return nil
	}
	return cc.Surface.DispatchResolvedAction(resolvedPayload, cc.ComponentModel.ID, metadata)
}

// behaviorType classifies runtime component property binding semantics.
type behaviorType string

const (
	behaviorDynamic    behaviorType = "DYNAMIC"
	behaviorAction     behaviorType = "ACTION"
	behaviorStructural behaviorType = "STRUCTURAL"
	behaviorCheckable  behaviorType = "CHECKABLE"
	behaviorStatic     behaviorType = "STATIC"
	behaviorObject     behaviorType = "OBJECT"
	behaviorArray      behaviorType = "ARRAY"
)

// behaviorNode represents a node in the schema-derived property classification tree.
type behaviorNode struct {
	Type      behaviorType
	Shape     map[string]*behaviorNode
	Element   *behaviorNode
	IsBoolean bool
}

var (
	staticBehavior    = &behaviorNode{Type: behaviorStatic}
	dynamicBehavior   = &behaviorNode{Type: behaviorDynamic}
	dynamicBoolBehav  = &behaviorNode{Type: behaviorDynamic, IsBoolean: true}
	actionBehavior    = &behaviorNode{Type: behaviorAction}
	structuralBehav   = &behaviorNode{Type: behaviorStructural}
	checkableBehavior = &behaviorNode{Type: behaviorCheckable}

	accessibilityBehavior = &behaviorNode{
		Type: behaviorObject,
		Shape: map[string]*behaviorNode{
			"label":       dynamicBehavior,
			"description": dynamicBehavior,
			"live":        staticBehavior,
			"hidden":      dynamicBoolBehav,
		},
	}

	knownDynamicRefNames = map[string]bool{
		"DataBinding":       true,
		"DynamicValue":      true,
		"DynamicString":     true,
		"DynamicNumber":     true,
		"DynamicBoolean":    true,
		"DynamicStringList": true,
	}
)

func extractSchemaRefName(ref string) string {
	if ref == "" {
		return ""
	}
	target := ref
	if idx := strings.LastIndexByte(ref, '#'); idx >= 0 {
		target = ref[idx+1:]
	}
	parts := strings.Split(strings.Trim(target, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func isDynamicUnionDef(defSchema any) bool {
	dm, ok := defSchema.(map[string]any)
	if !ok {
		return false
	}
	branches, ok := dm["oneOf"].([]any)
	if !ok {
		branches, ok = dm["anyOf"].([]any)
	}
	if !ok || len(branches) == 0 {
		return false
	}
	hasDataBinding := false
	for _, b := range branches {
		if bm, ok := b.(map[string]any); ok {
			if r, ok := bm["$ref"].(string); ok && extractSchemaRefName(r) == "DataBinding" {
				hasDataBinding = true
				break
			}
		}
	}
	return hasDataBinding
}

func isSpecialBehavior(t behaviorType) bool {
	return t == behaviorCheckable || t == behaviorAction || t == behaviorStructural || t == behaviorDynamic
}

// classifySchemaBehavior derives a behaviorNode tree from a component JSON schema and its $defs.
func classifySchemaBehavior(schema any, defs map[string]any) *behaviorNode {
	sm, ok := schema.(map[string]any)
	if !ok || sm == nil {
		return staticBehavior
	}
	if defs == nil {
		defs, _ = sm["$defs"].(map[string]any)
	}

	if ref, ok := sm["$ref"].(string); ok && ref != "" {
		refName := extractSchemaRefName(ref)
		switch refName {
		case "Checkable", "CheckRule":
			return checkableBehavior
		case "Action":
			return actionBehavior
		case "ChildList", "ComponentId", "Child", "TemplateChildList":
			return structuralBehav
		}
		if knownDynamicRefNames[refName] || (strings.Contains(ref, "$defs/") && defs != nil && isDynamicUnionDef(defs[refName])) {
			if refName == "DynamicBoolean" {
				return dynamicBoolBehav
			}
			return dynamicBehavior
		}
	}

	// Combiners: oneOf / anyOf / allOf
	var unionBranches []any
	if oo, ok := sm["oneOf"].([]any); ok {
		unionBranches = append(unionBranches, oo...)
	}
	if ao, ok := sm["anyOf"].([]any); ok {
		unionBranches = append(unionBranches, ao...)
	}
	if len(unionBranches) > 0 {
		hasLiteral := false
		allBoolLiterals := true
		for _, b := range unionBranches {
			bm, ok := b.(map[string]any)
			if !ok {
				continue
			}
			if r, ok := bm["$ref"].(string); ok {
				rn := extractSchemaRefName(r)
				if rn == "DataBinding" || rn == "FunctionCall" {
					continue
				}
			}
			if bm["type"] == "null" {
				continue
			}
			hasLiteral = true
			if bm["type"] != "boolean" {
				allBoolLiterals = false
			}
		}
		isBoolUnion := hasLiteral && allBoolLiterals
		for _, b := range unionBranches {
			node := classifySchemaBehavior(b, defs)
			if isSpecialBehavior(node.Type) {
				if node.Type == behaviorDynamic && isBoolUnion && !node.IsBoolean {
					return dynamicBoolBehav
				}
				return node
			}
		}
	}

	if allOf, ok := sm["allOf"].([]any); ok {
		mergedShape := map[string]*behaviorNode{}
		var firstSpecial *behaviorNode
		foundObj := false
		for _, b := range allOf {
			bm, ok := b.(map[string]any)
			if !ok {
				continue
			}
			if r, ok := bm["$ref"].(string); ok && extractSchemaRefName(r) == "Checkable" {
				mergedShape["checks"] = checkableBehavior
				mergedShape["@checks"] = checkableBehavior
				if firstSpecial == nil {
					firstSpecial = checkableBehavior
				}
				continue
			}
			node := classifySchemaBehavior(bm, defs)
			if node.Type == behaviorObject && node.Shape != nil {
				foundObj = true
				for k, v := range node.Shape {
					mergedShape[k] = v
				}
			} else if isSpecialBehavior(node.Type) && firstSpecial == nil {
				firstSpecial = node
			}
		}
		if ownProps, ok := sm["properties"].(map[string]any); ok {
			foundObj = true
			for k, v := range ownProps {
				mergedShape[k] = classifySchemaBehavior(v, defs)
			}
		}
		if ch, ok := mergedShape["checks"]; ok && ch.Type == behaviorCheckable {
			if _, hasAt := mergedShape["@checks"]; !hasAt {
				mergedShape["@checks"] = checkableBehavior
			}
		}
		if foundObj || len(mergedShape) > 0 {
			return &behaviorNode{Type: behaviorObject, Shape: mergedShape}
		}
		if firstSpecial != nil {
			return firstSpecial
		}
	}

	sType, _ := sm["type"].(string)
	if sType == "array" || hasKey(sm, "items") {
		elem := staticBehavior
		if itemsMap, ok := sm["items"].(map[string]any); ok {
			elem = classifySchemaBehavior(itemsMap, defs)
		}
		if elem.Type == behaviorCheckable {
			return checkableBehavior
		}
		return &behaviorNode{Type: behaviorArray, Element: elem}
	}

	if sType == "object" || hasKey(sm, "properties") {
		if props, ok := sm["properties"].(map[string]any); ok {
			if hasKey(props, "componentId") && (hasKey(props, "path") || hasKey(props, "dataBinding")) {
				return structuralBehav
			}
			if hasKey(props, "explicitList") || hasKey(props, "template") {
				return structuralBehav
			}
			if hasKey(props, "condition") {
				return checkableBehavior
			}
			shape := make(map[string]*behaviorNode, len(props))
			for k, v := range props {
				shape[k] = classifySchemaBehavior(v, defs)
			}
			if ch, ok := shape["checks"]; ok && ch.Type == behaviorCheckable {
				if _, hasAt := shape["@checks"]; !hasAt {
					shape["@checks"] = checkableBehavior
				}
			}
			return &behaviorNode{Type: behaviorObject, Shape: shape}
		}
	}

	return staticBehavior
}

func classifyValueFallback(key string, val any, atLeastV10 bool) *behaviorNode {
	val = CloneJSONValue(val)
	if key == "checks" || key == "@checks" {
		if arr, ok := val.([]any); ok {
			if key == "@checks" || len(arr) == 0 {
				return checkableBehavior
			}
			if first, ok := arr[0].(map[string]any); ok && hasKey(first, "condition") {
				return checkableBehavior
			}
		}
	}
	switch typed := val.(type) {
	case map[string]any:
		if hasKey(typed, "condition") {
			return checkableBehavior
		}
		if hasKey(typed, "componentId") && (hasKey(typed, "path") || hasKey(typed, "dataBinding") || hasKey(typed, "@path")) {
			return structuralBehav
		}
		if atLeastV10 {
			if hasKey(typed, "@path") || hasKey(typed, "@call") {
				return dynamicBehavior
			}
		} else {
			if hasKey(typed, "path") || hasKey(typed, "call") {
				return dynamicBehavior
			}
		}
		if len(typed) == 1 && (hasKey(typed, "event") || hasKey(typed, "functionCall")) {
			return actionBehavior
		}
		shape := make(map[string]*behaviorNode, len(typed))
		for k, v := range typed {
			shape[k] = classifyValueFallback(k, v, atLeastV10)
		}
		if (key == "@accessibility" || key == "accessibility") && shape["hidden"] != nil && shape["hidden"].Type == behaviorDynamic {
			shape["hidden"] = dynamicBoolBehav
		}
		return &behaviorNode{Type: behaviorObject, Shape: shape}

	case []any:
		elem := staticBehavior
		if len(typed) > 0 {
			elem = classifyValueFallback("", typed[0], atLeastV10)
		}
		return &behaviorNode{Type: behaviorArray, Element: elem}

	case string:
		if strings.Contains(typed, "${") {
			return dynamicBehavior
		}
	}
	return staticBehavior
}

// ResolvedAction represents a callable UI action bound to a component property.
type ResolvedAction struct {
	Invoke func(metadata map[string]any) (any, error)
}

type cachedActionEntry struct {
	raw    any
	action *ResolvedAction
}

type binderListener struct {
	id     int
	active bool
	fn     func(map[string]any)
}

// GenericBinder reactively binds a ComponentContext's properties against its SurfaceModel's DataModel.
type GenericBinder struct {
	Context         *ComponentContext
	ExpandTemplates bool
	behaviorTree    *behaviorNode
	CurrentProps    map[string]any

	disposed       bool
	dataUnsubs     []func()
	compUnsub      func()
	nextSubID      int
	listeners      []*binderListener
	actionClosures map[string]cachedActionEntry
}

// NewGenericBinder constructs a reactive GenericBinder for ctx.
func NewGenericBinder(ctx *ComponentContext, expandTemplates bool) *GenericBinder {
	var resolvedSchema map[string]any
	var defs map[string]any
	cat := ctx.ComponentModel.Catalog
	if cat != nil {
		resolvedSchema = cat.ResolvedComponentSchema(ctx.ComponentModel.Type)
		defs = map[string]any{}
		for k, v := range cat.defs {
			defs[k] = v
		}
		if ownDefs, ok := resolvedSchema["$defs"].(map[string]any); ok {
			for k, v := range ownDefs {
				defs[k] = v
			}
		}
	}

	bt := classifySchemaBehavior(resolvedSchema, defs)
	if bt == nil || bt.Type != behaviorObject {
		bt = &behaviorNode{Type: behaviorObject, Shape: map[string]*behaviorNode{}}
	}
	shapeCopy := make(map[string]*behaviorNode, len(bt.Shape)+3)
	for k, v := range bt.Shape {
		shapeCopy[k] = v
	}
	if _, ok := shapeCopy["accessibility"]; !ok {
		shapeCopy["accessibility"] = accessibilityBehavior
	}
	if _, ok := shapeCopy["@accessibility"]; !ok {
		shapeCopy["@accessibility"] = accessibilityBehavior
	}
	if _, ok := shapeCopy["@checks"]; !ok {
		shapeCopy["@checks"] = checkableBehavior
	}
	bt = &behaviorNode{Type: behaviorObject, Shape: shapeCopy}

	b := &GenericBinder{
		Context:         ctx,
		ExpandTemplates: expandTemplates,
		behaviorTree:    bt,
		CurrentProps:    map[string]any{},
		actionClosures:  map[string]cachedActionEntry{},
	}
	b.compUnsub = ctx.ComponentModel.SubscribeUpdated(func(_ *ComponentModel) {
		b.rebuildAllBindings()
	})
	b.rebuildAllBindings()
	return b
}

// Subscribe registers fn to receive the initial and all subsequent resolved property maps.
func (b *GenericBinder) Subscribe(fn func(map[string]any)) func() {
	if b.disposed {
		return func() {}
	}
	b.nextSubID++
	id := b.nextSubID
	entry := &binderListener{id: id, active: true, fn: fn}
	b.listeners = append(b.listeners, entry)
	if fn != nil {
		fn(b.CurrentProps)
	}
	return func() {
		entry.active = false
		for i, sub := range b.listeners {
			if sub.id == id {
				b.listeners = append(b.listeners[:i], b.listeners[i+1:]...)
				break
			}
		}
	}
}

// Dispose unsubscribes all DataModel and ComponentModel listeners held by this binder.
func (b *GenericBinder) Dispose() {
	b.disposed = true
	if b.compUnsub != nil {
		b.compUnsub()
		b.compUnsub = nil
	}
	for _, u := range b.dataUnsubs {
		u()
	}
	b.dataUnsubs = nil
	for _, sub := range b.listeners {
		sub.active = false
	}
	b.listeners = nil
}

func (b *GenericBinder) notify() {
	if b.disposed {
		return
	}
	subs := append([]*binderListener(nil), b.listeners...)
	for _, sub := range subs {
		if b.disposed {
			break
		}
		if sub.active && sub.fn != nil {
			sub.fn(b.CurrentProps)
		}
	}
}

func (b *GenericBinder) rebuildAllBindings() {
	for _, u := range b.dataUnsubs {
		u()
	}
	b.dataUnsubs = nil
	rawProps := b.Context.ComponentModel.Properties
	if rawProps == nil {
		rawProps = map[string]any{}
	}
	b.CurrentProps = b.bindObject(rawProps, b.behaviorTree.Shape, nil)
	b.notify()
}

func (b *GenericBinder) bindObject(valObj map[string]any, shape map[string]*behaviorNode, path []string) map[string]any {
	res := map[string]any{}
	keys := make([]string, 0, len(valObj))
	for k := range valObj {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		ci := keys[i] == "checks" || keys[i] == "@checks"
		cj := keys[j] == "checks" || keys[j] == "@checks"
		if ci != cj {
			return ci
		}
		return keys[i] < keys[j]
	})

	atLeastV10 := b.Context.DataContext.AtLeastV10()
	for _, k := range keys {
		v := valObj[k]
		var cb *behaviorNode
		if shape != nil {
			cb = shape[k]
		}
		if cb == nil {
			cb = classifyValueFallback(k, v, atLeastV10)
		}
		childPath := append(append([]string(nil), path...), k)
		res[k] = b.resolveAndBind(v, cb, res, k, childPath)
	}
	return res
}

func (b *GenericBinder) resolveAndBind(val any, beh *behaviorNode, parentDict map[string]any, key string, path []string) any {
	if beh == nil {
		beh = staticBehavior
	}
	if val == nil && !(beh.Type == behaviorDynamic && beh.IsBoolean) {
		return nil
	}
	switch beh.Type {
	case behaviorDynamic:
		return b.bindDynamicValue(val, path, beh.IsBoolean)
	case behaviorAction:
		return b.bindAction(val, path)
	case behaviorStructural:
		normVal := CloneJSONValue(val)
		if b.ExpandTemplates {
			if m, ok := normVal.(map[string]any); ok {
				return b.bindStructuralTemplate(m, path)
			}
		}
		return normVal
	case behaviorCheckable:
		return b.bindCheckable(val, parentDict, path)
	case behaviorArray:
		normVal := CloneJSONValue(val)
		arr, ok := normVal.([]any)
		if !ok {
			return normVal
		}
		elemBeh := beh.Element
		if elemBeh == nil {
			elemBeh = staticBehavior
		}
		out := make([]any, len(arr))
		for i, item := range arr {
			idxStr := strconv.Itoa(i)
			childPath := append(append([]string(nil), path...), idxStr)
			out[i] = b.resolveAndBind(item, elemBeh, map[string]any{}, idxStr, childPath)
		}
		return out
	case behaviorObject:
		normVal := CloneJSONValue(val)
		if m, ok := normVal.(map[string]any); ok {
			return b.bindObject(m, beh.Shape, path)
		}
		return normVal
	default:
		return CloneJSONValue(val)
	}
}

func (b *GenericBinder) updateDeepValue(path []string, newVal any) {
	if len(path) == 0 {
		return
	}
	var cur any = b.CurrentProps
	for _, seg := range path[:len(path)-1] {
		switch typed := cur.(type) {
		case []any:
			idx, ok := parseCanonicalArrayIndex(seg)
			if !ok || idx >= len(typed) {
				return
			}
			cur = typed[idx]
		case map[string]any:
			next, exists := typed[seg]
			if !exists {
				return
			}
			cur = next
		default:
			return
		}
	}
	last := path[len(path)-1]
	switch typed := cur.(type) {
	case []any:
		if idx, ok := parseCanonicalArrayIndex(last); ok && idx < len(typed) {
			typed[idx] = newVal
		}
	case map[string]any:
		typed[last] = newVal
	}
}

func (b *GenericBinder) bindDynamicValue(val any, path []string, isBool bool) any {
	coerce := func(v any) any {
		if isBool {
			return coerceDynamicBoolean(v)
		}
		return v
	}
	pathCopy := append([]string(nil), path...)
	sub := b.Context.DataContext.SubscribeDynamicValue(val, func(newVal any) {
		b.updateDeepValue(pathCopy, coerce(newVal))
		b.notify()
	})
	b.dataUnsubs = append(b.dataUnsubs, sub.Unsubscribe)
	return coerce(sub.InitialState.Value)
}

func (b *GenericBinder) bindStructuralTemplate(val map[string]any, path []string) any {
	tplObj := val
	if inner, ok := val["template"].(map[string]any); ok {
		tplObj = inner
	}
	compID, okID := tplObj["componentId"].(string)
	if !okID || compID == "" {
		return CloneJSONValue(val)
	}
	atLeastV10 := b.Context.DataContext.AtLeastV10()
	var tplPath string
	if atLeastV10 {
		tplPath, _ = tplObj["@path"].(string)
		if tplPath == "" {
			tplPath, _ = tplObj["path"].(string)
		}
	} else {
		tplPath, _ = tplObj["path"].(string)
		if tplPath == "" {
			tplPath, _ = tplObj["dataBinding"].(string)
		}
	}
	if tplPath == "" {
		return CloneJSONValue(val)
	}

	var bindExpr map[string]any
	if atLeastV10 {
		bindExpr = map[string]any{"@path": tplPath}
	} else {
		bindExpr = map[string]any{"path": tplPath}
	}

	mapItems := func(arr any) []any {
		slice, ok := CloneJSONValue(arr).([]any)
		if !ok {
			return []any{}
		}
		listCtx := b.Context.DataContext.Nested(tplPath, nil)
		out := make([]any, len(slice))
		for i := range slice {
			idx := i
			itemCtx := listCtx.Nested(strconv.Itoa(i), &idx)
			bp := strings.TrimRight(itemCtx.ContextPath, "/")
			if bp == "" {
				bp = "/"
			}
			out[i] = map[string]any{
				"id":       compID,
				"basePath": bp,
			}
		}
		return out
	}

	pathCopy := append([]string(nil), path...)
	sub := b.Context.DataContext.SubscribeDynamicValue(bindExpr, func(newVal any) {
		b.updateDeepValue(pathCopy, mapItems(newVal))
		b.notify()
	})
	b.dataUnsubs = append(b.dataUnsubs, sub.Unsubscribe)
	return mapItems(sub.InitialState.Value)
}

func (b *GenericBinder) bindAction(val any, path []string) *ResolvedAction {
	cacheKey := strings.Join(path, "/")
	if cached, ok := b.actionClosures[cacheKey]; ok && reflect.DeepEqual(cached.raw, val) {
		return cached.action
	}
	rawCopy := CloneJSONValue(val)
	act := &ResolvedAction{
		Invoke: func(metadata map[string]any) (any, error) {
			vm, ok := rawCopy.(map[string]any)
			if !ok {
				return nil, nil
			}
			fc := vm
			if subFC, isMap := vm["functionCall"].(map[string]any); isMap {
				fc = subFC
			}
			_, hasAtCall := fc["@call"].(string)
			_, hasBareCall := fc["call"].(string)
			if hasAtCall || hasBareCall {
				res := b.Context.DataContext.ResolveAction(vm, true)
				if pr, isPR := res.(*PendingResult); isPR {
					return pr.Peek(), nil
				}
				return res, nil
			}
			resolved := b.Context.DataContext.ResolveAction(vm, true)
			if resolved == nil {
				return nil, nil
			}
			if err := b.Context.DispatchAction(resolved, metadata); err != nil {
				return nil, err
			}
			return nil, nil
		},
	}
	b.actionClosures[cacheKey] = cachedActionEntry{raw: rawCopy, action: act}
	return act
}

func processCheckRuleVal(val any, explicitRuleMsg *string, fallbackMsg string) map[string]any {
	isObj := false
	var raw map[string]any
	if m, ok := val.(map[string]any); ok {
		isObj = hasKey(m, "severity") || hasKey(m, "code")
		raw = make(map[string]any, len(m))
		for k, v := range m {
			raw[k] = CloneJSONValue(v)
		}
	} else {
		raw = map[string]any{"valid": coerceDynamicBoolean(val)}
	}

	validBool, okValid := raw["valid"].(bool)
	if !okValid {
		msg := fallbackMsg
		if explicitRuleMsg != nil {
			msg = *explicitRuleMsg
		}
		if msg == "" {
			msg = "Validation failed"
		}
		return map[string]any{
			"valid":    false,
			"message":  msg,
			"severity": "error",
			"_is_obj":  isObj,
		}
	}

	dumped := map[string]any{"valid": validBool}
	if code, ok := raw["code"].(string); ok && code != "" {
		dumped["code"] = code
	}
	var msg string
	if explicitRuleMsg != nil {
		msg = *explicitRuleMsg
	} else if mStr, ok := raw["message"].(string); ok && mStr != "" {
		msg = mStr
	} else {
		msg = fallbackMsg
	}
	if msg != "" {
		dumped["message"] = msg
	}
	if sev, ok := raw["severity"].(string); ok && (sev == "error" || sev == "warning" || sev == "info") {
		dumped["severity"] = sev
	} else if !validBool {
		dumped["severity"] = "error"
	}
	dumped["_is_obj"] = isObj
	return dumped
}

func computeValidationSummary(ruleResults []map[string]any) (bool, []string, []map[string]any, map[string]any) {
	var failedRules []map[string]any
	var errorRules []map[string]any
	for _, r := range ruleResults {
		if r == nil {
			continue // pending agent condition does not fail while awaiting response
		}
		if valid, _ := r["valid"].(bool); !valid {
			failedRules = append(failedRules, r)
			sev, _ := r["severity"].(string)
			if sev == "" || sev == "error" {
				errorRules = append(errorRules, r)
			}
		}
	}
	isValid := len(errorRules) == 0
	validationErrors := []string{}
	for _, r := range errorRules {
		if m, ok := r["message"].(string); ok && m != "" {
			validationErrors = append(validationErrors, m)
		}
	}
	validationResults := []map[string]any{}
	for _, r := range failedRules {
		clean := map[string]any{}
		for k, v := range r {
			if k != "_is_obj" {
				clean[k] = v
			}
		}
		validationResults = append(validationResults, clean)
	}
	if len(failedRules) == 0 {
		return isValid, validationErrors, validationResults, map[string]any{"valid": true}
	}
	firstRes := map[string]any{}
	for k, v := range failedRules[0] {
		if k != "_is_obj" {
			firstRes[k] = v
		}
	}
	if isObj, _ := failedRules[0]["_is_obj"].(bool); !isObj {
		delete(firstRes, "severity")
	}
	return isValid, validationErrors, validationResults, firstRes
}

func toAnyStringSlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

func toAnyMapSlice(ms []map[string]any) []any {
	out := make([]any, len(ms))
	for i, m := range ms {
		out[i] = m
	}
	return out
}

func (b *GenericBinder) bindCheckable(val any, parentDict map[string]any, path []string) any {
	normVal := CloneJSONValue(val)
	rules, _ := normVal.([]any)
	ruleResults := make([]map[string]any, len(rules))
	for i := range ruleResults {
		ruleResults[i] = map[string]any{"valid": true, "message": "", "severity": "error"}
	}
	var parentPath []string
	if len(path) > 0 {
		parentPath = append([]string(nil), path[:len(path)-1]...)
	}

	applyState := func(reactive bool) {
		isValid, valErrs, valResults, valResult := computeValidationSummary(ruleResults)
		errAny := toAnyStringSlice(valErrs)
		resAny := toAnyMapSlice(valResults)
		parentDict["isValid"] = isValid
		parentDict["validationErrors"] = errAny
		parentDict["validationResults"] = resAny
		parentDict["validationResult"] = valResult
		if reactive {
			b.updateDeepValue(append(append([]string(nil), parentPath...), "isValid"), isValid)
			b.updateDeepValue(append(append([]string(nil), parentPath...), "validationErrors"), errAny)
			b.updateDeepValue(append(append([]string(nil), parentPath...), "validationResults"), resAny)
			b.updateDeepValue(append(append([]string(nil), parentPath...), "validationResult"), valResult)
			b.notify()
		}
	}

	atLeastV10 := b.Context.DataContext.AtLeastV10()
	for idx, rawRule := range rules {
		condition := rawRule
		var ruleMsgPtr *string
		if rm, ok := rawRule.(map[string]any); ok {
			if cond, hasCond := rm["condition"]; hasCond {
				condition = cond
			}
			if mStr, okM := rm["message"].(string); okM {
				s := mStr
				ruleMsgPtr = &s
			}
		}

		isPathBound := false
		if cm, ok := condition.(map[string]any); ok {
			if atLeastV10 {
				_, hasP := cm["@path"].(string)
				isPathBound = hasP && !hasKey(cm, "@call")
			} else {
				_, hasP := cm["path"].(string)
				isPathBound = hasP && !hasKey(cm, "call")
			}
		}
		var explicitMsg *string
		if !isPathBound {
			explicitMsg = ruleMsgPtr
		}
		fbMsg := "Validation failed"
		if ruleMsgPtr != nil && *ruleMsgPtr != "" {
			fbMsg = *ruleMsgPtr
		}

		evalRule := func(st DynamicValueState) map[string]any {
			if st.Pending {
				return nil
			}
			return processCheckRuleVal(st.Value, explicitMsg, fbMsg)
		}

		ruleIdx := idx
		sub := b.Context.DataContext.SubscribeDynamicState(condition, func(st DynamicValueState, _ bool) {
			ruleResults[ruleIdx] = evalRule(st)
			applyState(true)
		})
		b.dataUnsubs = append(b.dataUnsubs, sub.Unsubscribe)
		ruleResults[ruleIdx] = evalRule(sub.InitialState)
	}

	applyState(false)
	return CloneJSONValue(val)
}
