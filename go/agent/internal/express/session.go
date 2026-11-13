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

package express

import (
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

// SupersededComponent identifies a provisional component ID replaced by a later explicit id="..." kwarg.
type SupersededComponent struct {
	SurfaceID   string
	ComponentID string
}

type depSnap struct {
	ast    any
	compID *string
}

type compiledVarCacheEntry struct {
	ast             any
	varComps        []map[string]any
	deps            map[string]depSnap
	prevInline      int
	inlineDelta     int
	newGeneratedIDs []string
}

type compiledDataCacheEntry struct {
	astVal any
	val    any
	deps   map[string]depSnap
}

type scopeStreamState struct {
	surfaceID         string
	surfaceCreated    bool
	emittedComponents map[string]map[string]any
	emittedDataPaths  map[string]any
	varIDs            map[string]string
	compiledCache     map[string]compiledVarCacheEntry
	dataCache         map[string]compiledDataCacheEntry
}

func newScopeStreamState(surfaceID string) *scopeStreamState {
	return &scopeStreamState{
		surfaceID:         surfaceID,
		emittedComponents: make(map[string]map[string]any),
		emittedDataPaths:  make(map[string]any),
		varIDs:            make(map[string]string),
		compiledCache:     make(map[string]compiledVarCacheEntry),
		dataCache:         make(map[string]compiledDataCacheEntry),
	}
}

func (s *scopeStreamState) clone() *scopeStreamState {
	return &scopeStreamState{
		surfaceID:         s.surfaceID,
		surfaceCreated:    s.surfaceCreated,
		emittedComponents: maps.Clone(s.emittedComponents),
		emittedDataPaths:  maps.Clone(s.emittedDataPaths),
		varIDs:            maps.Clone(s.varIDs),
		compiledCache:     maps.Clone(s.compiledCache),
		dataCache:         maps.Clone(s.dataCache),
	}
}

// SessionSnapshot captures ScopeSession state for atomic rollback on speculative progressive heals.
type SessionSnapshot struct {
	scopeStates          map[int]*scopeStreamState
	scopeStateOrder      []int
	emittedUnits         map[int]bool
	hasEmitted           bool
	cachedPrefix         string
	cachedStatements     []Statement
	supersededComponents []SupersededComponent
}

// ScopeSession tracks incremental statement compilation across chunks of a single <a2ui> block.
type ScopeSession struct {
	Compiler             *Compiler
	SurfaceID            string
	Version              string
	HasEmitted           bool
	SupersededComponents []SupersededComponent

	scopeStates      map[int]*scopeStreamState
	scopeStateOrder  []int
	emittedUnits     map[int]bool
	cachedPrefix     string
	cachedStatements []Statement
}

// NewScopeSession creates an incremental compilation session for a single <a2ui> block.
func NewScopeSession(compiler *Compiler, surfaceID, version string) *ScopeSession {
	if surfaceID == "" {
		surfaceID = "default_surface"
	}
	targetVer := normalizeTargetVersion(version, compiler.Version)
	return &ScopeSession{
		Compiler:     compiler,
		SurfaceID:    surfaceID,
		Version:      targetVer,
		scopeStates:  make(map[int]*scopeStreamState),
		emittedUnits: make(map[int]bool),
	}
}

// Snapshot returns a copy of the session state for rollback.
func (s *ScopeSession) Snapshot() SessionSnapshot {
	clonedScopes := make(map[int]*scopeStreamState, len(s.scopeStates))
	for k, v := range s.scopeStates {
		clonedScopes[k] = v.clone()
	}
	return SessionSnapshot{
		scopeStates:          clonedScopes,
		scopeStateOrder:      slices.Clone(s.scopeStateOrder),
		emittedUnits:         maps.Clone(s.emittedUnits),
		hasEmitted:           s.HasEmitted,
		cachedPrefix:         s.cachedPrefix,
		cachedStatements:     slices.Clone(s.cachedStatements),
		supersededComponents: slices.Clone(s.SupersededComponents),
	}
}

// Restore reverts the session state to snap.
func (s *ScopeSession) Restore(snap SessionSnapshot) {
	s.scopeStates = snap.scopeStates
	s.scopeStateOrder = snap.scopeStateOrder
	s.emittedUnits = snap.emittedUnits
	s.HasEmitted = snap.hasEmitted
	s.cachedPrefix = snap.cachedPrefix
	s.cachedStatements = snap.cachedStatements
	s.SupersededComponents = snap.supersededComponents
}

func isValidPrefixBoundary(dslText string, prefixLen int) bool {
	if len(dslText) == prefixLen {
		return true
	}
	if prefixLen > 0 && (dslText[prefixLen-1] == '\n' || dslText[prefixLen-1] == ';') {
		return true
	}
	switch dslText[prefixLen] {
	case ' ', '\t', '\r', '\n', ';':
		return true
	default:
		return false
	}
}

func (s *ScopeSession) parseIncrementalStatements(dslText string, cachePrefix bool) ([]Statement, error) {
	var statements []Statement
	if s.cachedPrefix != "" &&
		strings.HasPrefix(dslText, s.cachedPrefix) &&
		isValidPrefixBoundary(dslText, len(s.cachedPrefix)) {
		delta := dslText[len(s.cachedPrefix):]
		if strings.TrimSpace(delta) == "" {
			statements = slices.Clone(s.cachedStatements)
		} else {
			deltaStmts, err := ParseStatements(delta, true, false)
			if err != nil {
				return nil, err
			}
			statements = make([]Statement, 0, len(s.cachedStatements)+len(deltaStmts))
			statements = append(statements, s.cachedStatements...)
			statements = append(statements, deltaStmts...)
		}
	} else {
		parsed, err := ParseStatements(dslText, true, false)
		if err != nil {
			return nil, err
		}
		statements = parsed
	}
	if cachePrefix {
		s.cachedPrefix = dslText
		s.cachedStatements = slices.Clone(statements)
	}
	return statements, nil
}

// CompileStep compiles newly completed statements from dslText into delta A2UI wire messages.
func (s *ScopeSession) CompileStep(
	dslText string,
	isFinal bool,
	existingSurfaces map[string]bool,
	cachePrefix bool,
) ([]core.AgentToRendererMessage, error) {
	s.SupersededComponents = nil
	ctx := newCompileContext(s.Version, !isFinal)
	if s.Compiler.isMultiCatalog() && !ctx.atLeastV10 {
		return nil, core.NewCatalogErrorf(
			"Several catalogs need A2UI v1.0 or later, but the target version is %s.",
			s.Version,
		)
	}

	statements, err := s.parseIncrementalStatements(dslText, cachePrefix)
	if err != nil {
		return nil, err
	}
	units, err := s.Compiler.buildUnits(statements, s.SurfaceID, ctx)
	if err != nil {
		return nil, err
	}
	if len(units) == 0 {
		if isFinal {
			return nil, NewUndefinedRootError("root")
		}
		return nil, nil
	}

	activeSurfaces := make(map[string]bool, len(existingSurfaces))
	for k, v := range existingSurfaces {
		if v {
			activeSurfaces[k] = true
		}
	}

	var result []core.AgentToRendererMessage
	for idx, unit := range units {
		msgs, uErr := s.compileUnit(idx, unit, ctx, isFinal, activeSurfaces)
		if uErr != nil {
			return nil, uErr
		}
		for _, m := range msgs {
			result = append(result, core.AgentToRendererMessage(m))
		}
	}
	return result, nil
}

func (s *ScopeSession) compileUnit(
	idx int,
	unit any,
	ctx *compileContext,
	isFinal bool,
	activeSurfaces map[string]bool,
) ([]map[string]any, error) {
	switch u := unit.(type) {
	case deleteSurfaceUnit:
		delete(activeSurfaces, u.surfaceID)
		if s.emittedUnits[idx] {
			return nil, nil
		}
		s.emittedUnits[idx] = true
		s.HasEmitted = true
		return []map[string]any{{
			"version": s.Version,
			opDelete:  map[string]any{"surfaceId": u.surfaceID},
		}}, nil

	case standaloneCallUnit:
		if s.emittedUnits[idx] {
			return nil, nil
		}
		msg, err := s.Compiler.compileStandaloneCall(u, ctx)
		if err != nil {
			var pend *pendingVariableError
			if errors.As(err, &pend) {
				return nil, nil
			}
			return nil, err
		}
		s.emittedUnits[idx] = true
		s.HasEmitted = true
		return []map[string]any{msg}, nil

	case *surfaceScope:
		st, exists := s.scopeStates[idx]
		if !exists {
			st = newScopeStreamState(u.surfaceID)
			s.scopeStates[idx] = st
			s.scopeStateOrder = append(s.scopeStateOrder, idx)
		}
		st.surfaceID = u.surfaceID
		surfaceExists := activeSurfaces[u.surfaceID]
		msgs, err := s.compileScopeDelta(u, st, ctx, isFinal, surfaceExists)
		if err != nil {
			return nil, err
		}
		if st.surfaceCreated || surfaceExists {
			activeSurfaces[u.surfaceID] = true
		}
		return msgs, nil
	}
	return nil, nil
}

func (s *ScopeSession) compileScopeDelta(
	scope *surfaceScope,
	state *scopeStreamState,
	ctx *compileContext,
	isFinal bool,
	surfaceExists bool,
) ([]map[string]any, error) {
	compiledComponents, hasPending, err := s.collectReadyComponents(scope, state, ctx)
	if err != nil {
		return nil, err
	}
	compiledData, dataOrder, err := s.collectReadyData(scope, state, ctx)
	if err != nil {
		return nil, err
	}
	hasRoot := false
	for _, c := range compiledComponents {
		if c["id"] == "root" {
			hasRoot = true
			break
		}
	}
	needsCreate := !scope.isUpdate && !state.surfaceCreated && (!surfaceExists || hasRoot || scope.hasExtensions)
	if needsCreate {
		return s.compileInitialCreate(scope, state, compiledComponents, compiledData, dataOrder, ctx, isFinal)
	}
	return s.compileIncrementalUpdates(scope, state, compiledComponents, compiledData, dataOrder, ctx, isFinal, hasPending, surfaceExists)
}

func (s *ScopeSession) compileInitialCreate(
	scope *surfaceScope,
	state *scopeStreamState,
	compiledComponents []map[string]any,
	compiledData map[string]any,
	dataOrder []string,
	ctx *compileContext,
	isFinal bool,
) ([]map[string]any, error) {
	hasRoot := false
	for _, c := range compiledComponents {
		if c["id"] == "root" {
			hasRoot = true
			break
		}
	}
	if !hasRoot {
		if !isFinal {
			return nil, nil
		}
		if scope.hasExtensions {
			return nil, NewValidationError(
				"surface() extensions require a surface-creating scope with a root component.",
				"",
			)
		}
		if len(compiledComponents) > 0 || len(compiledData) > 0 {
			return s.compileIncrementalUpdates(scope, state, compiledComponents, compiledData, dataOrder, ctx, true, false, false)
		}
		return nil, NewUndefinedRootError("root")
	}

	dataModel := make(map[string]any)
	for _, pathName := range dataOrder {
		if err := setNestedPath(dataModel, pathName, compiledData[pathName]); err != nil {
			return nil, err
		}
	}
	messages, err := s.Compiler.buildCreateMessages(scope, compiledComponents, dataModel, ctx)
	if err != nil {
		var pend *pendingVariableError
		if !isFinal && errors.As(err, &pend) {
			return nil, nil
		}
		return nil, err
	}
	for _, pathName := range dataOrder {
		state.emittedDataPaths[pathName] = compiledData[pathName]
	}
	for _, comp := range compiledComponents {
		if cid, ok := comp["id"].(string); ok {
			state.emittedComponents[cid] = comp
		}
	}
	state.surfaceCreated = true
	s.HasEmitted = true
	return messages, nil
}

func (s *ScopeSession) compileIncrementalUpdates(
	scope *surfaceScope,
	state *scopeStreamState,
	compiledComponents []map[string]any,
	compiledData map[string]any,
	dataOrder []string,
	ctx *compileContext,
	isFinal bool,
	hasPending bool,
	surfaceExists bool,
) ([]map[string]any, error) {
	var deltaComponents []any
	for _, comp := range compiledComponents {
		cid, _ := comp["id"].(string)
		if prev, had := state.emittedComponents[cid]; !had || !reflect.DeepEqual(prev, comp) {
			deltaComponents = append(deltaComponents, comp)
			state.emittedComponents[cid] = comp
		}
	}

	dataUpdates, err := s.buildDataUpdates(scope, state, compiledData, dataOrder, ctx)
	if err != nil {
		return nil, err
	}
	if isFinal && len(state.emittedComponents) == 0 && len(state.emittedDataPaths) == 0 && !hasPending {
		return nil, NewUndefinedRootError("root")
	}

	var messages []map[string]any
	if len(deltaComponents) > 0 {
		if !isFinal && !scope.hasSurfaceDirective && !state.surfaceCreated && !surfaceExists {
			return nil, NewUndefinedRootError("root")
		}
		messages = append(messages, map[string]any{
			"version": ctx.version,
			opUpdateComponents: map[string]any{
				"surfaceId":  scope.surfaceID,
				"components": deltaComponents,
			},
		})
	}
	messages = append(messages, dataUpdates...)
	if len(messages) > 0 {
		s.HasEmitted = true
	}
	return messages, nil
}

func (s *ScopeSession) depSnapshot(scope *surfaceScope, dep string, ctx *compileContext) (depSnap, error) {
	depAST, ok := scope.rawSymbols[dep]
	if !ok {
		return depSnap{}, nil
	}
	if call, isCall := depAST.(*CallNode); isCall && call != nil {
		catID, _ := call.Kwarg("catalogId")
		if s.Compiler.definesComponent(call.Name, catID) {
			cid, err := componentIDOf(dep, call, ctx.atLeastV10)
			if err != nil {
				return depSnap{}, err
			}
			return depSnap{ast: depAST, compID: &cid}, nil
		}
	}
	return depSnap{ast: depAST}, nil
}

func depSnapEqual(a, b depSnap) bool {
	if !reflect.DeepEqual(a.ast, b.ast) {
		return false
	}
	if (a.compID == nil) != (b.compID == nil) {
		return false
	}
	if a.compID != nil && *a.compID != *b.compID {
		return false
	}
	return true
}

func (s *ScopeSession) earlierScopeComponent(currentState *scopeStreamState, surfaceID, compID string) map[string]any {
	var found map[string]any
	for _, idx := range s.scopeStateOrder {
		st := s.scopeStates[idx]
		if st == currentState {
			break
		}
		if st.surfaceID == surfaceID {
			if c, ok := st.emittedComponents[compID]; ok {
				found = c
			}
		}
	}
	return found
}

func (s *ScopeSession) collectReadyComponents(
	scope *surfaceScope,
	state *scopeStreamState,
	ctx *compileContext,
) ([]map[string]any, bool, error) {
	if err := s.Compiler.seedScopeComponentIDs(scope, ctx); err != nil {
		return nil, false, err
	}
	var compiled []map[string]any
	hasPending := false
	var superseded []string

	for _, varName := range scope.rawSymbolOrder {
		ast := scope.rawSymbols[varName]
		cached, hasCached := state.compiledCache[varName]
		canReuse := false
		if hasCached &&
			reflect.DeepEqual(cached.ast, ast) &&
			(cached.inlineDelta == 0 || cached.prevInline == ctx.inlineCounter) {
			noIDCollision := true
			for _, gid := range cached.newGeneratedIDs {
				if ctx.usedIDs[gid] {
					noIDCollision = false
					break
				}
			}
			if noIDCollision {
				depsMatch := true
				for dep, wantSnap := range cached.deps {
					gotSnap, dErr := s.depSnapshot(scope, dep, ctx)
					if dErr != nil || !depSnapEqual(gotSnap, wantSnap) {
						depsMatch = false
						break
					}
				}
				canReuse = depsMatch
			}
		}

		var varComps []map[string]any
		if canReuse {
			varComps = cached.varComps
			ctx.inlineCounter += cached.inlineDelta
			for _, gid := range cached.newGeneratedIDs {
				ctx.usedIDs[gid] = true
			}
		} else {
			prevInline := ctx.inlineCounter
			prevUsedIDs := maps.Clone(ctx.usedIDs)
			clear(ctx.referencedVars)

			compDict, err := s.Compiler.compileASTNode(varName, ast, scope.rawSymbols, ctx)
			if err != nil {
				var pend *pendingVariableError
				if errors.As(err, &pend) {
					ctx.extraComponents = nil
					ctx.inlineCounter = prevInline
					ctx.usedIDs = prevUsedIDs
					hasPending = true
					continue
				}
				return nil, false, err
			}
			if compDict != nil {
				varComps = make([]map[string]any, 0, 1+len(ctx.extraComponents))
				varComps = append(varComps, compDict)
				varComps = append(varComps, ctx.extraComponents...)
			}
			ctx.extraComponents = nil

			deps := make(map[string]depSnap, len(ctx.referencedVars))
			for dep := range ctx.referencedVars {
				snap, dErr := s.depSnapshot(scope, dep, ctx)
				if dErr != nil {
					return nil, false, dErr
				}
				deps[dep] = snap
			}
			var newGenIDs []string
			for gid := range ctx.usedIDs {
				if !prevUsedIDs[gid] {
					newGenIDs = append(newGenIDs, gid)
				}
			}
			slices.Sort(newGenIDs)
			state.compiledCache[varName] = compiledVarCacheEntry{
				ast:             ast,
				varComps:        varComps,
				deps:            deps,
				prevInline:      prevInline,
				inlineDelta:     ctx.inlineCounter - prevInline,
				newGeneratedIDs: newGenIDs,
			}
		}

		if len(varComps) > 0 {
			newID, _ := varComps[0]["id"].(string)
			oldID, hadOld := state.varIDs[varName]
			state.varIDs[varName] = newID
			if hadOld && oldID != newID {
				superseded = append(superseded, oldID)
			}
			compiled = append(compiled, varComps...)
		}
	}

	if len(superseded) > 0 {
		activeIDs := make(map[string]bool, len(compiled))
		for _, c := range compiled {
			if cid, ok := c["id"].(string); ok {
				activeIDs[cid] = true
			}
		}
		for _, oldID := range superseded {
			if !activeIDs[oldID] {
				delete(state.emittedComponents, oldID)
				if earlier := s.earlierScopeComponent(state, scope.surfaceID, oldID); earlier != nil {
					compiled = append(compiled, earlier)
				} else {
					s.SupersededComponents = append(s.SupersededComponents, SupersededComponent{
						SurfaceID:   scope.surfaceID,
						ComponentID: oldID,
					})
				}
			}
		}
	}
	return compiled, hasPending, nil
}

func (s *ScopeSession) collectReadyData(
	scope *surfaceScope,
	state *scopeStreamState,
	ctx *compileContext,
) (map[string]any, []string, error) {
	compiled := make(map[string]any)
	var readyOrder []string

	for _, pathName := range scope.dataPathOrder {
		astVal := scope.dataPathAssignments[pathName]
		cached, hasCached := state.dataCache[pathName]
		canReuse := false
		if hasCached && reflect.DeepEqual(cached.astVal, astVal) {
			depsMatch := true
			for dep, wantSnap := range cached.deps {
				gotSnap, dErr := s.depSnapshot(scope, dep, ctx)
				if dErr != nil || !depSnapEqual(gotSnap, wantSnap) {
					depsMatch = false
					break
				}
			}
			canReuse = depsMatch
		}
		if canReuse {
			compiled[pathName] = cached.val
			readyOrder = append(readyOrder, pathName)
			continue
		}

		clear(ctx.referencedVars)
		val, err := s.Compiler.compileDataValue(scope, astVal, ctx)
		if err != nil {
			var pend *pendingVariableError
			if errors.As(err, &pend) {
				continue
			}
			return nil, nil, err
		}
		deps := make(map[string]depSnap, len(ctx.referencedVars))
		for dep := range ctx.referencedVars {
			snap, dErr := s.depSnapshot(scope, dep, ctx)
			if dErr != nil {
				return nil, nil, dErr
			}
			deps[dep] = snap
		}
		state.dataCache[pathName] = compiledDataCacheEntry{
			astVal: astVal,
			val:    val,
			deps:   deps,
		}
		compiled[pathName] = val
		readyOrder = append(readyOrder, pathName)
	}
	return compiled, readyOrder, nil
}

func (s *ScopeSession) buildDataUpdates(
	scope *surfaceScope,
	state *scopeStreamState,
	compiledData map[string]any,
	dataOrder []string,
	ctx *compileContext,
) ([]map[string]any, error) {
	var updates []map[string]any
	for _, pathName := range dataOrder {
		val := compiledData[pathName]
		if prev, exists := state.emittedDataPaths[pathName]; exists && reflect.DeepEqual(prev, val) {
			continue
		}
		pointer := toJSONPointer(pathName)
		if pointer == "/" {
			if _, isMap := val.(map[string]any); !isMap {
				return nil, NewValidationError(
					fmt.Sprintf("Cannot assign a non-map value to the root data path '$/' (got %T).", val),
					"",
				)
			}
		}
		state.emittedDataPaths[pathName] = val
		updates = append(updates, map[string]any{
			"version": ctx.version,
			opUpdateData: map[string]any{
				"surfaceId": scope.surfaceID,
				"path":      pointer,
				"value":     val,
			},
		})
	}
	return updates, nil
}
