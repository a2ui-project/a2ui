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
	"math"
	"sort"
	"strings"
)

// ValidateRecursionAndPaths checks nesting depth (MaxComponentGraphDepth, MaxFunctionCallDepth) and JSON Pointer path syntax.
func ValidateRecursionAndPaths(data any) error {
	var traverse func(item any, globalDepth, funcDepth int) error
	traverse = func(item any, globalDepth, funcDepth int) error {
		if globalDepth > MaxComponentGraphDepth {
			return NewRecursionError(fmt.Sprintf("Global recursion limit exceeded: Depth > %d", MaxComponentGraphDepth))
		}
		switch typed := item.(type) {
		case []any:
			for _, elem := range typed {
				if err := traverse(elem, globalDepth+1, funcDepth); err != nil {
					return err
				}
			}
		case map[string]any:
			for _, pk := range []string{"path", "@path"} {
				if p, ok := typed[pk].(string); ok && !relaxedPathPattern.MatchString(p) {
					msg := fmt.Sprintf("Invalid path syntax: '%s'", p)
					ve := NewValidationError(msg, ErrorDetail{
						Path:    pk,
						Code:    "invalid_pointer",
						Message: msg,
					})
					ve.Path = "/" + pk
					return ve
				}
			}
			_, isFC08 := typed["functionCall"].(map[string]any)
			isFC09 := (hasKey(typed, "call") || hasKey(typed, "@call")) && hasKey(typed, "args")
			if isFC08 {
				if funcDepth >= MaxFunctionCallDepth {
					return NewRecursionError(fmt.Sprintf("Recursion limit exceeded: functionCall depth > %d", MaxFunctionCallDepth))
				}
				return traverse(typed["functionCall"], globalDepth+1, funcDepth+1)
			}
			if isFC09 {
				if funcDepth >= MaxFunctionCallDepth {
					return NewRecursionError(fmt.Sprintf("Recursion limit exceeded: functionCall depth > %d", MaxFunctionCallDepth))
				}
				for k, v := range typed {
					nextFD := funcDepth
					if k == "args" {
						nextFD = funcDepth + 1
					}
					if err := traverse(v, globalDepth+1, nextFD); err != nil {
						return err
					}
				}
				return nil
			}
			for _, v := range typed {
				if err := traverse(v, globalDepth+1, funcDepth); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return traverse(data, 0, 0)
}

// ValidateComponentIntegrity verifies root presence and non-dangling child references.
func ValidateComponentIntegrity(components map[string]*ComponentModel, rootID string, cfg ValidationConfig) error {
	if rootID == "" {
		rootID = "root"
	}
	if !cfg.AllowMissingRoot {
		if _, ok := components[rootID]; !ok {
			return NewIntegrityErrorf("Missing root component: No component has id='%s'", rootID)
		}
	}
	if cfg.AllowDanglingReferences {
		return nil
	}
	ids := make([]string, 0, len(components))
	for id := range components {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		comp := components[id]
		if id == "" || comp == nil {
			return NewIntegrityError("Component must have a valid string 'id'")
		}
		for _, ref := range comp.ChildReferences() {
			if _, exists := components[ref.ID]; !exists {
				return NewIntegrityErrorf(
					"Dangling reference: Component '%s' references non-existent component '%s' in field '%s'",
					id, ref.ID, ref.Path,
				)
			}
		}
	}
	return nil
}

// AnalyzeTopology walks the component graph from rootID, checking for self-references, cycles, depth bounds, and orphans.
func AnalyzeTopology(components map[string]*ComponentModel, rootID string, cfg ValidationConfig) (map[string]bool, error) {
	if rootID == "" {
		rootID = "root"
	}
	maxDepth := MaxComponentGraphDepth
	if cfg.MaxDepth > 0 {
		maxDepth = cfg.MaxDepth
	}

	allIDs := make([]string, 0, len(components))
	for id := range components {
		allIDs = append(allIDs, id)
	}
	sort.Strings(allIDs)

	adj := make(map[string][]string, len(components))
	for _, compID := range allIDs {
		comp := components[compID]
		if comp == nil {
			continue
		}
		for _, ref := range comp.ChildReferences() {
			if ref.ID == compID {
				return nil, NewRecursionError(fmt.Sprintf(
					"Self-reference detected: Component '%s' references itself in field '%s'",
					compID, ref.Path,
				))
			}
			adj[compID] = append(adj[compID], ref.ID)
		}
	}

	visited := map[string]bool{}
	onStack := map[string]bool{}

	var dfs func(nodeID string, depth int) error
	dfs = func(nodeID string, depth int) error {
		if depth > maxDepth {
			return NewRecursionError(fmt.Sprintf("Global recursion limit exceeded: logical depth > %d", maxDepth))
		}
		visited[nodeID] = true
		onStack[nodeID] = true
		for _, neighbor := range adj[nodeID] {
			if _, exists := components[neighbor]; !exists {
				continue
			}
			if !visited[neighbor] {
				if err := dfs(neighbor, depth+1); err != nil {
					return err
				}
			} else if onStack[neighbor] {
				return NewRecursionError(fmt.Sprintf("Circular reference detected involving component '%s'", neighbor))
			}
		}
		delete(onStack, nodeID)
		return nil
	}

	if cfg.AllowMissingRoot {
		for _, nodeID := range allIDs {
			if !visited[nodeID] {
				if err := dfs(nodeID, 0); err != nil {
					return nil, err
				}
			}
		}
	} else {
		if _, hasRoot := components[rootID]; hasRoot {
			if err := dfs(rootID, 0); err != nil {
				return nil, err
			}
		}
		if !cfg.AllowOrphanComponents {
			for _, id := range allIDs {
				if !visited[id] {
					return nil, NewIntegrityErrorf("Component '%s' is not reachable from '%s'", id, rootID)
				}
			}
		}
	}

	return visited, nil
}

// ValidateCompositionConstraints checks allowedParents and allowedChildren across components (treating rootID's parent as "Surface").
func ValidateCompositionConstraints(
	components map[string]*ComponentModel,
	rootID string,
	batchIndexMap map[string]int,
	surfaceID string,
) error {
	if rootID == "" {
		rootID = "root"
	}
	ids := make([]string, 0, len(components))
	for id := range components {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	// Order by batchIndexMap first when present so errors report the earliest component in the batch.
	if len(batchIndexMap) > 0 {
		sort.SliceStable(ids, func(i, j int) bool {
			bi, oki := batchIndexMap[ids[i]]
			bj, okj := batchIndexMap[ids[j]]
			if oki && okj {
				return bi < bj
			}
			if oki != okj {
				return oki
			}
			return ids[i] < ids[j]
		})
	}

	type parentPair struct {
		id       string
		compType string
	}
	childRefsMap := make(map[string][]ChildReference, len(components))
	parentMap := make(map[string][]parentPair)
	for _, id := range ids {
		model := components[id]
		if model == nil {
			continue
		}
		refs := model.ChildReferences()
		if len(refs) > 0 {
			childRefsMap[id] = refs
			pType := model.Type
			if pType == "" {
				pType = "Unknown"
			}
			for _, r := range refs {
				parentMap[r.ID] = append(parentMap[r.ID], parentPair{id: id, compType: pType})
			}
		}
	}

	for _, compID := range ids {
		model := components[compID]
		if model == nil || model.Catalog == nil {
			continue
		}
		api, ok := model.Catalog.components[model.Type]
		if !ok {
			continue
		}
		if len(api.AllowedParents) > 0 {
			var toCheck []parentPair
			if compID == rootID {
				toCheck = append(toCheck, parentPair{id: "Surface", compType: "Surface"})
			}
			toCheck = append(toCheck, parentMap[compID]...)
			for _, p := range toCheck {
				if !containsString(api.AllowedParents, p.compType) {
					jsonPtr := toJSONPointer("components." + compID)
					if idx, ok := batchIndexMap[compID]; ok {
						jsonPtr = fmt.Sprintf("/components/%d", idx)
					}
					msg := fmt.Sprintf(
						"Component '%s' (%s) cannot be placed under parent '%s' (%s). Allowed parents: %s.",
						compID, model.Type, p.id, p.compType, formatSingleQuotedList(api.AllowedParents),
					)
					ve := NewValidationError(msg, ErrorDetail{
						Path:      jsonPtr,
						Code:      "UNALLOWED_PARENT",
						Message:   msg,
						SurfaceID: surfaceID,
					})
					ve.Code = "UNALLOWED_PARENT"
					ve.Path = jsonPtr
					ve.SurfaceID = surfaceID
					return ve
				}
			}
		}
		if len(api.AllowedChildren) > 0 {
			for _, ref := range childRefsMap[compID] {
				childModel := components[ref.ID]
				if childModel == nil || childModel.Type == "" {
					continue
				}
				if !containsString(api.AllowedChildren, childModel.Type) {
					baseSeg := compID
					if idx, ok := batchIndexMap[compID]; ok {
						baseSeg = fmt.Sprintf("%d", idx)
					}
					dotPath := "components." + baseSeg
					if ref.Path != "" {
						dotPath += "." + ref.Path
					}
					jsonPtr := toJSONPointer(dotPath)
					msg := fmt.Sprintf(
						"Container '%s' (%s) cannot contain child '%s' (%s). Allowed children: %s.",
						compID, model.Type, ref.ID, childModel.Type, formatSingleQuotedList(api.AllowedChildren),
					)
					ve := NewValidationError(msg, ErrorDetail{
						Path:      jsonPtr,
						Code:      "UNALLOWED_CHILD",
						Message:   msg,
						SurfaceID: surfaceID,
					})
					ve.Code = "UNALLOWED_CHILD"
					ve.Path = jsonPtr
					ve.SurfaceID = surfaceID
					return ve
				}
			}
		}
	}
	return nil
}

func formatSingleQuotedList(items []string) string {
	parts := make([]string, len(items))
	for i, s := range items {
		parts[i] = fmt.Sprintf("'%s'", s)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// ValidateComponentsUpdate validates a batch of ComponentModels before applying them to m, using O(delta) graph bounds when deferred.
func (m *SurfaceComponentsModel) ValidateComponentsUpdate(
	newComponents []*ComponentModel,
	rootID string,
	cfg *ValidationConfig,
	surfaceID string,
) error {
	if rootID == "" {
		rootID = "root"
	}
	if cfg != nil && cfg.RootID != "" && cfg.RootID != "root" {
		rootID = cfg.RootID
	}

	batchIndexMap := make(map[string]int, len(newComponents))
	for idx, comp := range newComponents {
		if _, dup := batchIndexMap[comp.ID]; dup {
			msg := fmt.Sprintf("Duplicate component ID '%s' in update payload.", comp.ID)
			ie := NewIntegrityError(msg)
			ie.Details = []ErrorDetail{{
				Path:      "components." + comp.ID,
				Code:      "duplicate_id",
				Message:   msg,
				SurfaceID: surfaceID,
			}}
			ie.Path = fmt.Sprintf("/components/%d/id", idx)
			ie.SurfaceID = surfaceID
			return ie
		}
		batchIndexMap[comp.ID] = idx
	}

	if cfg == nil {
		if m.mayHaveCompositionRules(newComponents) {
			prospective := m.All()
			for _, comp := range newComponents {
				prospective[comp.ID] = comp
			}
			return ValidateCompositionConstraints(prospective, rootID, batchIndexMap, surfaceID)
		}
		return nil
	}

	// Validate each component against its catalog schema.
	var allErrors []ErrorDetail
	var summaries []string
	var firstErrPath string
	for idx, comp := range newComponents {
		compDict := comp.ComponentTree()
		if comp.Catalog != nil && comp.Catalog != m.DefaultCatalog && IsAtLeastVersion(string(comp.Catalog.ProtocolVersion()), Version1_0) {
			compDict["@catalogId"] = comp.Catalog.CatalogID()
		}
		idxCopy := idx
		vErr := NewPayloadValidator(comp.Catalog, cfg).ValidateComponentAtIndex(compDict, &idxCopy, surfaceID)
		if vErr != nil {
			if ve, ok := vErr.(*ValidationError); ok {
				if firstErrPath == "" {
					firstErrPath = ve.Path
				}
				allErrors = append(allErrors, ve.Details...)
				compStr := fmt.Sprintf("'%s'", comp.Type)
				if comp.Type == "" {
					compStr = fmt.Sprintf("id '%s'", comp.ID)
				}
				var lines []string
				for _, d := range ve.Details {
					lines = append(lines, fmt.Sprintf("%s: %s", d.Path, d.Message))
				}
				summaries = append(summaries, fmt.Sprintf("%s: %s", compStr, strings.Join(lines, "\n")))
			} else {
				return vErr
			}
		}
	}
	if len(allErrors) > 0 {
		ve := NewValidationError("Validation failed for component "+strings.Join(summaries, "\n"), allErrors...)
		ve.Path = firstErrPath
		ve.SurfaceID = surfaceID
		return ve
	}

	batch := make(map[string]*ComponentModel, len(newComponents))
	for _, c := range newComponents {
		batch[c.ID] = c
	}

	var bound *componentGraphBound
	if m.bound != nil && m.boundAt == m.changes {
		bound = m.bound
	}
	m.bound = nil
	m.boundAt = -1
	m.pendingBound = nil
	m.pendingBoundAt = -1

	deferred := cfg.AllowDanglingReferences && (cfg.AllowOrphanComponents || cfg.AllowMissingRoot)
	if deferred && bound != nil {
		if !bound.compositionHolds(batch, m.byID, rootID) {
			prospective := m.All()
			for k, v := range batch {
				prospective[k] = v
			}
			if err := ValidateCompositionConstraints(prospective, rootID, batchIndexMap, surfaceID); err != nil {
				return attachSurfaceID(err, surfaceID)
			}
		}
		if !cfg.AllowMissingRoot {
			_, inBatch := batch[rootID]
			_, inHeld := m.byID[rootID]
			if !inBatch && !inHeld {
				ie := NewIntegrityErrorf("Missing root component: No component has id='%s'", rootID)
				ie.SurfaceID = surfaceID
				return ie
			}
		}
		limit := MaxComponentGraphDepth
		if cfg.MaxDepth > 0 {
			limit = cfg.MaxDepth
		}
		if bound.admits(batch, limit, func(id string) bool {
			_, ok1 := batch[id]
			_, ok2 := m.byID[id]
			return ok1 || ok2
		}) {
			bound.recordBatch(batch)
			m.pendingBound = bound
			m.pendingBoundAt = m.changes + len(newComponents)
			return nil
		}
		prospective := m.All()
		for k, v := range batch {
			prospective[k] = v
		}
		if _, err := AnalyzeTopology(prospective, rootID, *cfg); err != nil {
			return attachSurfaceID(err, surfaceID)
		}
		return nil
	}

	prospective := m.All()
	for k, v := range batch {
		prospective[k] = v
	}
	if err := ValidateCompositionConstraints(prospective, rootID, batchIndexMap, surfaceID); err != nil {
		return attachSurfaceID(err, surfaceID)
	}
	if err := ValidateComponentIntegrity(prospective, rootID, *cfg); err != nil {
		return attachSurfaceID(err, surfaceID)
	}
	if _, err := AnalyzeTopology(prospective, rootID, *cfg); err != nil {
		return attachSurfaceID(err, surfaceID)
	}
	if deferred {
		m.pendingBound = buildGraphBound(prospective)
		m.pendingBoundAt = m.changes + len(newComponents)
	}
	return nil
}

func (m *SurfaceComponentsModel) mayHaveCompositionRules(batch []*ComponentModel) bool {
	seen := map[*Catalog]bool{}
	for _, comp := range batch {
		if comp.Catalog != nil && !seen[comp.Catalog] {
			seen[comp.Catalog] = true
			if catalogDeclaresCompositionRules(comp.Catalog) {
				return true
			}
		}
	}
	if m.DefaultCatalog != nil && !seen[m.DefaultCatalog] && catalogDeclaresCompositionRules(m.DefaultCatalog) {
		return true
	}
	for _, comp := range m.byID {
		if comp.Catalog != nil && !seen[comp.Catalog] {
			seen[comp.Catalog] = true
			if catalogDeclaresCompositionRules(comp.Catalog) {
				return true
			}
		}
	}
	return false
}

func catalogDeclaresCompositionRules(cat *Catalog) bool {
	if cat == nil {
		return false
	}
	for _, api := range cat.components {
		if len(api.AllowedParents) > 0 || len(api.AllowedChildren) > 0 {
			return true
		}
	}
	return false
}

func attachSurfaceID(err error, surfaceID string) error {
	if surfaceID == "" || err == nil {
		return err
	}
	switch e := err.(type) {
	case *IntegrityError:
		if e.SurfaceID == "" {
			e.SurfaceID = surfaceID
		}
	case *RecursionError:
		if e.SurfaceID == "" {
			e.SurfaceID = surfaceID
		}
	case *ValidationError:
		if e.SurfaceID == "" {
			e.SurfaceID = surfaceID
		}
	case *CatalogError:
		if e.SurfaceID == "" {
			e.SurfaceID = surfaceID
		}
	}
	return err
}

// componentGraphBound maintains incremental DAG heights & parent edges for O(delta) validation under relaxed streaming.
type componentGraphBound struct {
	children map[string][]string
	parents  map[string]map[string]bool
	heights  map[string]int
	maxH     float64
}

func buildGraphBound(components map[string]*ComponentModel) *componentGraphBound {
	b := &componentGraphBound{
		children: make(map[string][]string, len(components)),
		parents:  map[string]map[string]bool{},
		heights:  make(map[string]int, len(components)),
	}
	for id, comp := range components {
		b.setChildren(id, extractIDs(comp.ChildReferences()))
	}
	b.computeHeights()
	return b
}

func extractIDs(refs []ChildReference) []string {
	out := make([]string, len(refs))
	for i, r := range refs {
		out[i] = r.ID
	}
	return out
}

func (b *componentGraphBound) setChildren(compID string, kids []string) {
	for _, old := range b.children[compID] {
		if ps := b.parents[old]; ps != nil {
			delete(ps, compID)
			if len(ps) == 0 {
				delete(b.parents, old)
			}
		}
	}
	for _, k := range kids {
		if b.parents[k] == nil {
			b.parents[k] = map[string]bool{}
		}
		b.parents[k][compID] = true
	}
	b.children[compID] = kids
}

func (b *componentGraphBound) computeHeights() {
	visited := map[string]int{} // 0=unseen, 1=visiting, 2=done
	var dfs func(id string) int
	dfs = func(id string) int {
		if st := visited[id]; st == 2 {
			return b.heights[id]
		} else if st == 1 {
			b.maxH = math.Inf(1)
			return 0
		}
		visited[id] = 1
		h := 0
		for _, child := range b.children[id] {
			if _, held := b.children[child]; !held {
				continue
			}
			ch := dfs(child)
			if math.IsInf(b.maxH, 1) {
				return 0
			}
			if ch+1 > h {
				h = ch + 1
			}
		}
		visited[id] = 2
		b.heights[id] = h
		if float64(h) > b.maxH {
			b.maxH = float64(h)
		}
		return h
	}
	for id := range b.children {
		if visited[id] == 0 {
			dfs(id)
			if math.IsInf(b.maxH, 1) {
				return
			}
		}
	}
}

// compositionHolds reports whether applying batch keeps every allowedParents and allowedChildren rule
// satisfied, given that the held components already satisfy them. Only parent-child edges with an endpoint
// in the batch can change, so only those are checked: the cost grows with the batch, not with the surface.
// It must run before admits, which records the batch's edges in the bound.
func (b *componentGraphBound) compositionHolds(batch, held map[string]*ComponentModel, rootID string) bool {
	lookup := func(id string) *ComponentModel {
		if m, ok := batch[id]; ok {
			return m
		}
		return held[id]
	}
	for id, model := range batch {
		if model == nil {
			continue
		}
		if id == rootID {
			if api, ok := componentAPIOf(model); ok && len(api.AllowedParents) > 0 && !containsString(api.AllowedParents, "Surface") {
				return false
			}
		}
		for _, ref := range model.ChildReferences() {
			if child := lookup(ref.ID); child != nil && !compositionEdgeAllowed(model, child) {
				return false
			}
		}
		// Edges from batch parents are checked as their outgoing edges above.
		for parentID := range b.parents[id] {
			if _, inBatch := batch[parentID]; inBatch {
				continue
			}
			if parent := held[parentID]; parent != nil && !compositionEdgeAllowed(parent, model) {
				return false
			}
		}
	}
	return true
}

func componentAPIOf(model *ComponentModel) (ComponentAPI, bool) {
	if model == nil || model.Catalog == nil {
		return ComponentAPI{}, false
	}
	api, ok := model.Catalog.components[model.Type]
	return api, ok
}

// compositionEdgeAllowed applies the rules ValidateCompositionConstraints enforces to one parent-child edge.
func compositionEdgeAllowed(parent, child *ComponentModel) bool {
	if api, ok := componentAPIOf(parent); ok && len(api.AllowedChildren) > 0 && child.Type != "" && !containsString(api.AllowedChildren, child.Type) {
		return false
	}
	if api, ok := componentAPIOf(child); ok && len(api.AllowedParents) > 0 {
		parentType := parent.Type
		if parentType == "" {
			parentType = "Unknown"
		}
		if !containsString(api.AllowedParents, parentType) {
			return false
		}
	}
	return true
}

func (b *componentGraphBound) admits(batch map[string]*ComponentModel, limit int, held func(string) bool) bool {
	if b.maxH > float64(limit) {
		return false
	}
	for id, model := range batch {
		kids := extractIDs(model.ChildReferences())
		if containsString(kids, id) {
			return false
		}
		b.setChildren(id, kids)
	}
	var queue []string
	for id := range batch {
		h := 0
		for _, child := range b.children[id] {
			if held(child) && b.heights[child] >= h {
				h = b.heights[child] + 1
			}
		}
		b.heights[id] = h
		queue = append(queue, id)
	}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		h := b.heights[cur]
		if h > limit {
			return false
		}
		if float64(h) > b.maxH {
			b.maxH = float64(h)
		}
		for parent := range b.parents[cur] {
			if b.heights[parent] <= h {
				b.heights[parent] = h + 1
				queue = append(queue, parent)
			}
		}
	}
	return true
}

func (b *componentGraphBound) recordBatch(_ map[string]*ComponentModel) {}
