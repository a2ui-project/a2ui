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
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

type nestedCallHomeKind int

const (
	homeCatalog nestedCallHomeKind = iota
	homeNoDefaultCatalog
	homeUnknownAssumed
)

type nestedCallHome struct {
	kind      nestedCallHomeKind
	catalog   *core.Catalog
	surfaceID string
}

func (s *RendererState) checkRendererFunctionCall(payload []core.AgentToRendererMessage, index int) error {
	msg := payload[index]
	body, ok := msg["callRendererFunction"].(map[string]any)
	if !ok {
		return core.NewValidationError("callRendererFunction must be a JSON object")
	}
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if k != "functionCallId" && k != "callFunction" && k != "surfaceId" {
			return core.NewValidationErrorf("unrecognized field %q in callRendererFunction", k)
		}
	}
	callID, ok := body["functionCallId"].(string)
	if !ok || callID == "" {
		return core.NewValidationError("callRendererFunction requires a non-empty string 'functionCallId'")
	}
	callFn, ok := body["callFunction"].(map[string]any)
	if !ok {
		return core.NewValidationErrorf("Function call %q requires an object 'callFunction'", callID)
	}

	var surfaceID string
	hasSurfaceID := false
	if rawSID, present := body["surfaceId"]; present {
		sid, isStr := rawSID.(string)
		if !isStr || sid == "" {
			return core.NewValidationErrorf("Function call %q 'surfaceId' must be a non-empty string", callID)
		}
		surfaceID = sid
		hasSurfaceID = true
	}

	wrapCallErr := func(err error) error {
		if err == nil {
			return nil
		}
		var valErr *core.ValidationError
		var details []core.ErrorDetail
		var pathStr string
		if errors.As(err, &valErr) && valErr.A2UIError != nil {
			details = valErr.Details
			pathStr = valErr.Path
		}
		out := core.NewValidationError(err.Error(), details...)
		out.Code = string(core.RPCCodeInvalidFunctionCall)
		out.Path = pathStr
		out.SurfaceID = surfaceID
		out.FunctionCallID = callID
		return out
	}

	var home *nestedCallHome
	if hasSurfaceID {
		surf := s.processor.Model.Surface(surfaceID)
		if surf == nil && !(s.assumesUnknownSurfaces && s.shouldAssume(surfaceID, payload, index)) {
			return wrapCallErr(core.NewValidationErrorf("Function call '%s' names surface '%s', which does not exist.", callID, surfaceID))
		}
		h, err := s.resolveSurfaceHome(surfaceID, surf)
		if err != nil {
			return wrapCallErr(err)
		}
		home = &h
	}

	if err := checkStandaloneFunctionCall(s.catalogs, callID, callFn, home); err != nil {
		return wrapCallErr(err)
	}
	return nil
}

func (s *RendererState) resolveSurfaceHome(surfaceID string, surf *core.SurfaceModel) (nestedCallHome, error) {
	if surf != nil && !s.assumed[surfaceID] {
		if surf.Catalog == nil {
			return nestedCallHome{kind: homeNoDefaultCatalog, surfaceID: surfaceID}, nil
		}
		for _, c := range s.catalogs {
			if c.CatalogID() == surf.Catalog.CatalogID() {
				return nestedCallHome{kind: homeCatalog, catalog: c}, nil
			}
		}
		return nestedCallHome{kind: homeCatalog, catalog: surf.Catalog}, nil
	}
	if s.surfaceCatalogIDs != nil {
		if forcedID, ok := s.surfaceCatalogIDs[surfaceID]; ok {
			for _, c := range s.catalogs {
				if c.CatalogID() == forcedID {
					return nestedCallHome{kind: homeCatalog, catalog: c}, nil
				}
			}
			return nestedCallHome{}, core.NewValidationErrorf("Surface '%s' uses catalog '%s', which isn't one of the active catalogs.", surfaceID, forcedID)
		}
	}
	return nestedCallHome{kind: homeUnknownAssumed}, nil
}

func checkStandaloneFunctionCall(
	catalogs []*core.Catalog,
	callID string,
	callFn map[string]any,
	home *nestedCallHome,
) error {
	subject := fmt.Sprintf("Function call '%s'", callID)
	name, ok := callFn["@call"].(string)
	if !ok || name == "" {
		return core.NewValidationErrorf("%s is missing a non-empty string '@call' field.", subject)
	}
	for _, k := range slices.Sorted(maps.Keys(callFn)) {
		if k != "@call" && k != "catalogId" && k != "args" {
			return core.NewValidationErrorf("%s has unrecognized field '%s' on callFunction.", subject, k)
		}
	}
	rawCatID, hasCatID := callFn["catalogId"]
	if !hasCatID {
		return core.NewValidationErrorf("%s is missing required 'catalogId' on callFunction.", subject)
	}
	catID, ok := rawCatID.(string)
	if !ok || catID == "" {
		return core.NewValidationErrorf("%s 'catalogId' must be a non-empty string.", subject)
	}

	var argsMap map[string]any
	hasArgs := false
	if rawArgs, present := callFn["args"]; present {
		m, isMap := rawArgs.(map[string]any)
		if !isMap {
			return core.NewValidationErrorf("%s must pass an object for 'args'.", subject)
		}
		argsMap = m
		hasArgs = true
	}

	cat, err := findHeldCatalog(catalogs, catID, subject)
	if err != nil {
		return err
	}
	fnAPI, declared := cat.Functions()[name]
	if !declared {
		return core.NewValidationErrorf("%s names '%s', which catalog '%s' does not declare.", subject, name, cat.CatalogID())
	}
	allowed := fnAPI.AllowedCallers
	if allowed == "" {
		allowed = core.AllowedCallersRendererOnly
	}
	if allowed != core.AllowedCallersAgentOnly && allowed != core.AllowedCallersRendererOrAgent {
		return core.NewValidationErrorf("%s names '%s', which only the renderer may call (allowedCallers is %s).", subject, name, allowed)
	}
	if fnAPI.RequiresUserActivation {
		return core.NewValidationErrorf("%s names '%s', which requires a user activation, and a call from the agent has none.", subject, name)
	}

	if err := checkFunctionArgsSchema(cat, name, argsMap, hasArgs, subject); err != nil {
		return err
	}

	effectiveHome := nestedCallHome{kind: homeCatalog, catalog: cat}
	if home != nil {
		effectiveHome = *home
	}
	if hasArgs {
		if err := checkNestedFunctionCalls(catalogs, effectiveHome, cat, argsMap, subject, 1); err != nil {
			return err
		}
	}
	return nil
}

func findHeldCatalog(catalogs []*core.Catalog, catalogID, subject string) (*core.Catalog, error) {
	for _, c := range catalogs {
		if c.CatalogID() == catalogID {
			return c, nil
		}
	}
	ids := make([]string, len(catalogs))
	for i, c := range catalogs {
		ids[i] = c.CatalogID()
	}
	return nil, core.NewValidationErrorf(
		"%s names catalog '%s', which isn't one of the active catalogs: %s.",
		subject, catalogID, strings.Join(ids, ", "),
	)
}

func checkFunctionArgsSchema(cat *core.Catalog, name string, args map[string]any, hasArgs bool, subject string) error {
	strict := core.StrictValidation()
	validator := core.NewPayloadValidator(cat, &strict)
	fnObj := map[string]any{"@call": name}
	if hasArgs {
		fnObj["args"] = args
	}
	if err := validator.ValidateFunction(fnObj); err != nil {
		var valErr *core.ValidationError
		var details []core.ErrorDetail
		if errors.As(err, &valErr) && valErr.A2UIError != nil {
			details = valErr.Details
		}
		return core.NewValidationError(
			fmt.Sprintf("%s does not match the arguments of '%s': %v", subject, name, err),
			details...,
		)
	}
	return nil
}

func checkNestedFunctionCalls(
	catalogs []*core.Catalog,
	home nestedCallHome,
	outerCatalog *core.Catalog,
	value any,
	subject string,
	depth int,
) error {
	if arr, isArr := value.([]any); isArr {
		for _, item := range arr {
			if err := checkNestedFunctionCalls(catalogs, home, outerCatalog, item, subject, depth); err != nil {
				return err
			}
		}
		return nil
	}
	obj, isObj := value.(map[string]any)
	if !isObj {
		return nil
	}
	// Visit keys in sorted order so that the reported error does not depend on map order.
	keys := slices.Sorted(maps.Keys(obj))
	for _, k := range keys {
		if strings.HasPrefix(k, "@") && k != "@path" && k != "@call" {
			return core.NewValidationErrorf("%s holds an argument with unrecognized reserved '@' directive %q.", subject, k)
		}
	}
	if rawPath, hasPath := obj["@path"]; hasPath {
		if _, isStr := rawPath.(string); !isStr {
			return core.NewValidationErrorf("%s holds a data binding whose '@path' must be a string.", subject)
		}
		for _, k := range keys {
			if k != "@path" {
				return core.NewValidationErrorf("%s holds a data binding with unrecognized field '%s'; a binding holds only '@path'.", subject, k)
			}
		}
		return nil
	}
	nextDepth := depth
	if name, isCall := obj["@call"].(string); isCall {
		nextDepth = depth + 1
		if nextDepth > core.MaxFunctionCallDepth {
			return core.NewRecursionError("nested function call depth exceeds maximum limit")
		}
		if err := checkSingleNestedCall(catalogs, home, outerCatalog, obj, name, subject); err != nil {
			return err
		}
	}
	for _, k := range keys {
		if err := checkNestedFunctionCalls(catalogs, home, outerCatalog, obj[k], subject, nextDepth); err != nil {
			return err
		}
	}
	return nil
}

func checkSingleNestedCall(
	catalogs []*core.Catalog,
	home nestedCallHome,
	outerCatalog *core.Catalog,
	callObj map[string]any,
	name string,
	subject string,
) error {
	holds := fmt.Sprintf("%s holds a call to '%s'", subject, name)
	where := holds + " that"
	for _, k := range slices.Sorted(maps.Keys(callObj)) {
		if k != "@call" && k != "catalogId" && k != "args" {
			return core.NewValidationErrorf("%s with unrecognized field '%s'.", holds, k)
		}
	}
	var argsMap map[string]any
	hasArgs := false
	if rawArgs, present := callObj["args"]; present {
		m, isMap := rawArgs.(map[string]any)
		if !isMap {
			return core.NewValidationErrorf("%s whose 'args' must be an object.", holds)
		}
		argsMap = m
		hasArgs = true
	}

	if strings.HasPrefix(name, "@") {
		if _, hasCat := callObj["catalogId"]; hasCat {
			return core.NewValidationErrorf("%s names a catalogId, but system functions belong to no catalog.", where)
		}
		if name == "@index" {
			return core.NewValidationErrorf("%s, but the renderer resolves the arguments outside any list template, where '@index' is unavailable.", holds)
		}
		return checkFunctionArgsSchema(outerCatalog, name, argsMap, hasArgs, where)
	}

	if rawCatID, hasCat := callObj["catalogId"]; hasCat {
		cid, isStr := rawCatID.(string)
		if !isStr || cid == "" {
			return core.NewValidationErrorf("%s whose 'catalogId' must be a string.", holds)
		}
		cat, err := findHeldCatalog(catalogs, cid, where)
		if err != nil {
			return err
		}
		return checkRendererMayMake(cat, name, argsMap, hasArgs, where)
	}

	switch home.kind {
	case homeCatalog:
		return checkRendererMayMake(home.catalog, name, argsMap, hasArgs, where)
	case homeNoDefaultCatalog:
		return core.NewValidationErrorf("%s without a catalogId, and surface '%s' has no default catalog.", holds, home.surfaceID)
	default:
		var candidates []*core.Catalog
		for _, c := range catalogs {
			if _, ok := c.Functions()[name]; ok {
				candidates = append(candidates, c)
			}
		}
		if len(candidates) == 0 {
			candidates = []*core.Catalog{catalogs[0]}
		}
		var firstErr error
		for _, c := range candidates {
			if err := checkRendererMayMake(c, name, argsMap, hasArgs, where); err != nil {
				if firstErr == nil {
					firstErr = err
				}
				continue
			}
			return nil
		}
		return firstErr
	}
}

func checkRendererMayMake(cat *core.Catalog, name string, args map[string]any, hasArgs bool, where string) error {
	if fn, ok := cat.Functions()[name]; ok {
		if fn.AllowedCallers == core.AllowedCallersAgentOnly {
			return core.NewValidationErrorf("%s the renderer can't make: Function '%s' cannot be called by renderer (allowedCallers is agentOnly).", where, name)
		}
		if fn.RequiresUserActivation {
			return core.NewValidationErrorf("%s the renderer can't make: Function '%s' requires a user activation, and a call from the agent has none.", where, name)
		}
	}
	return checkFunctionArgsSchema(cat, name, args, hasArgs, where)
}
