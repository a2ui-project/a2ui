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
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	surfaceStatement       = "surface"
	deleteSurfaceStatement = "deleteSurface"

	idKey             = "id"
	functionCallIDKey = "functionCallId"
	sendDataModelKey  = "sendDataModel"
	updateKey         = "update"
	extensionsKey     = "extensions"

	opCreate           = "createSurface"
	opUpdateComponents = "updateComponents"
	opUpdateData       = "updateDataModel"
	opDelete           = "deleteSurface"

	maxArrayIndex = 10000
)

var (
	arrayIndexRe  = regexp.MustCompile(`^(?:0|[1-9][0-9]*)$`)
	eventKeywords = []string{"userMessage", "context"}
)

type valueSlot struct {
	schema map[string]any
	helper *schemahelper.CatalogSchemaHelper
}

func itemSlot(slot *valueSlot) *valueSlot {
	if slot == nil || slot.helper == nil {
		return nil
	}
	s := slot.helper.ResolveItemSchema(slot.schema)
	if s == nil {
		return nil
	}
	return &valueSlot{schema: s, helper: slot.helper}
}

func propertySlot(slot *valueSlot, name string) *valueSlot {
	if slot == nil || slot.helper == nil {
		return nil
	}
	s := slot.helper.ResolvePropertySchema(slot.schema, name)
	if s == nil {
		return nil
	}
	return &valueSlot{schema: s, helper: slot.helper}
}

type compileContext struct {
	version         string
	atLeastV10      bool
	pathKey         string
	callKey         string
	extraComponents []map[string]any
	inlineCounter   int
	callCounter     int
	activeValuePath map[string]any
	resolving       map[string]bool
	allowPending    bool
	referencedVars  map[string]bool
	usedIDs         map[string]bool
}

func newCompileContext(version string, allowPending bool) *compileContext {
	atLeastV10 := core.IsAtLeastVersion(version, core.Version1_0)
	pathKey := "path"
	callKey := "call"
	if atLeastV10 {
		pathKey = "@path"
		callKey = "@call"
	}
	return &compileContext{
		version:        version,
		atLeastV10:     atLeastV10,
		pathKey:        pathKey,
		callKey:        callKey,
		allowPending:   allowPending,
		resolving:      make(map[string]bool),
		referencedVars: make(map[string]bool),
		usedIDs:        make(map[string]bool),
	}
}

func (ctx *compileContext) checkCatalogOverride(target string) error {
	if !ctx.atLeastV10 {
		return NewValidationError(
			fmt.Sprintf(
				"%s sets catalogId, but A2UI %s only allows catalogId on the surface. Per-component and per-function catalogId overrides need A2UI v1.0 or later.",
				target, ctx.version,
			),
			"",
		)
	}
	return nil
}

type surfaceScope struct {
	surfaceID           string
	hasSurfaceDirective bool
	sendDataModel       *bool
	isUpdate            bool
	hasExtensions       bool
	extensions          any

	rawSymbolOrder      []string
	rawSymbols          map[string]any
	dataPathOrder       []string
	dataPathAssignments map[string]any
}

func newSurfaceScope(surfaceID string) *surfaceScope {
	return &surfaceScope{
		surfaceID:           surfaceID,
		rawSymbols:          make(map[string]any),
		dataPathAssignments: make(map[string]any),
	}
}

func (s *surfaceScope) setSymbol(name string, val any) {
	if _, exists := s.rawSymbols[name]; !exists {
		s.rawSymbolOrder = append(s.rawSymbolOrder, name)
	}
	s.rawSymbols[name] = val
}

func (s *surfaceScope) setDataPath(path string, val any) {
	if _, exists := s.dataPathAssignments[path]; exists {
		s.dataPathOrder = slices.DeleteFunc(s.dataPathOrder, func(p string) bool { return p == path })
	}
	s.dataPathOrder = append(s.dataPathOrder, path)
	s.dataPathAssignments[path] = val
}

type deleteSurfaceUnit struct {
	surfaceID string
}

type standaloneCallUnit struct {
	node  *CallNode
	scope *surfaceScope
}

func normalizeTargetVersion(version string, fallback string) string {
	v := version
	if v == "" {
		v = fallback
	}
	if pv, err := core.ToProtocolVersion(v); err == nil {
		if w := pv.WireVersion(); w != "" {
			return w
		}
	}
	return v
}

func componentIDOf(varName string, ast any, atLeastV10 bool) (string, error) {
	call, ok := ast.(*CallNode)
	if !ok || call == nil {
		return varName, nil
	}
	rawID, hasID := call.Kwarg(idKey)
	if !hasID {
		return varName, nil
	}
	explicitID, ok := rawID.(string)
	if !ok || explicitID == "" {
		return "", NewValidationError(fmt.Sprintf("Component id must be a non-empty string, got: %v", rawID), "")
	}
	if atLeastV10 && !core.IsValidUAX31Identifier(explicitID) {
		return "", NewValidationError(fmt.Sprintf("Component id %q is not a valid UAX 31 identifier.", explicitID), "")
	}
	return explicitID, nil
}

// Compiler compiles A2UI Express DSL source into A2UI protocol wire messages.
type Compiler struct {
	catalogs          []*core.Catalog
	Version           string
	CatalogOrder      []string
	Helpers           map[string]*schemahelper.CatalogSchemaHelper
	sysFuncMu         sync.RWMutex
	sysFuncHelperByVr map[string]*schemahelper.CatalogSchemaHelper
}

// NewCompiler constructs an Express Compiler for one or more catalogs and an optional target version.
func NewCompiler(catalogs []*core.Catalog, version string) (*Compiler, error) {
	checked, err := schemahelper.CheckMixedCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	catVer, err := schemahelper.CatalogsProtocolVersion(checked)
	if err != nil {
		return nil, err
	}
	targetVer := normalizeTargetVersion(version, catVer)
	order, helpers, err := schemahelper.BuildCatalogHelpers(checked, targetVer)
	if err != nil {
		return nil, err
	}
	return &Compiler{
		catalogs:          checked,
		Version:           targetVer,
		CatalogOrder:      order,
		Helpers:           helpers,
		sysFuncHelperByVr: make(map[string]*schemahelper.CatalogSchemaHelper),
	}, nil
}

// Catalogs returns a copy of the active catalogs in priority order.
func (c *Compiler) Catalogs() []*core.Catalog {
	return append([]*core.Catalog(nil), c.catalogs...)
}

func (c *Compiler) isMultiCatalog() bool {
	return len(c.catalogs) > 1
}

func (c *Compiler) helperFor(catalogID string) (*schemahelper.CatalogSchemaHelper, error) {
	h := c.Helpers[catalogID]
	if h == nil {
		return nil, NewValidationError(
			fmt.Sprintf("Unknown catalog '%s'. Available catalogs: %v", catalogID, c.CatalogOrder),
			"",
		)
	}
	return h, nil
}

func (c *Compiler) definesComponent(name string, catalogID any) bool {
	if cid, ok := catalogID.(string); ok {
		if h, exists := c.Helpers[cid]; exists {
			_, defined := h.Components[name]
			return defined
		}
	}
	return len(schemahelper.CatalogsDefining(c.CatalogOrder, c.Helpers, "component", name)) > 0
}

func (c *Compiler) definesFunction(name string, catalogID any) bool {
	if strings.HasPrefix(name, "@") {
		return true
	}
	if catalogID != nil {
		if cid, ok := catalogID.(string); ok {
			if h, exists := c.Helpers[cid]; exists {
				_, defined := h.Functions[name]
				return defined
			}
		}
		return false
	}
	return len(schemahelper.CatalogsDefining(c.CatalogOrder, c.Helpers, "function", name)) > 0
}

func (c *Compiler) resolve(
	kind string,
	name string,
	catalogID any,
	hasCatalogID bool,
	ctx *compileContext,
	target string,
	label string,
) (*schemahelper.CatalogSchemaHelper, *string, error) {
	if hasCatalogID && catalogID != nil {
		cid, ok := catalogID.(string)
		if !ok {
			return nil, nil, NewValidationError(
				fmt.Sprintf("%s catalogId must be a string, got: %v", target, catalogID),
				"",
			)
		}
		if err := ctx.checkCatalogOverride(target); err != nil {
			return nil, nil, err
		}
		h, err := c.helperFor(cid)
		if err != nil {
			return nil, nil, err
		}
		var isDefined bool
		if kind == "component" {
			_, isDefined = h.Components[name]
		} else {
			_, isDefined = h.Functions[name]
		}
		if !isDefined {
			return nil, nil, NewValidationError(
				fmt.Sprintf("Unknown %s '%s' not defined in catalog '%s'.", label, name, cid),
				"",
			)
		}
		return h, &cid, nil
	}

	matches := schemahelper.CatalogsDefining(c.CatalogOrder, c.Helpers, kind, name)
	if len(matches) > 1 {
		return nil, nil, NewValidationError(
			fmt.Sprintf("%s '%s' is defined in several catalogs: %v. Name the catalog to use with a catalogId argument.",
				capitalizeCheckName(label), name, matches),
			"",
		)
	}
	if len(matches) == 0 {
		if c.isMultiCatalog() {
			return nil, nil, NewValidationError(
				fmt.Sprintf("Unknown %s '%s' not defined in any catalog: %v.", label, name, c.CatalogOrder),
				"",
			)
		}
		return nil, nil, NewValidationError(
			fmt.Sprintf("Unknown %s '%s' not defined in catalog '%s'.", label, name, c.catalogs[0].CatalogID()),
			"",
		)
	}
	resolvedID := matches[0]
	var writeCat *string
	if c.isMultiCatalog() {
		writeCat = &resolvedID
	}
	return c.Helpers[resolvedID], writeCat, nil
}

// Compile compiles an Express DSL block into A2UI wire messages.
func (c *Compiler) Compile(dslText, surfaceID string, isFinal bool, versionOverride string) ([]core.AgentToRendererMessage, error) {
	if surfaceID == "" {
		surfaceID = "default_surface"
	}
	targetVer := normalizeTargetVersion(versionOverride, c.Version)
	ctx := newCompileContext(targetVer, false)
	if c.isMultiCatalog() && !ctx.atLeastV10 {
		return nil, core.NewCatalogErrorf(
			"Several catalogs need A2UI v1.0 or later, but the target version is %s.",
			targetVer,
		)
	}

	statements, err := ParseStatements(dslText, isFinal, true)
	if err != nil {
		return nil, err
	}
	units, err := c.buildUnits(statements, surfaceID, ctx)
	if err != nil {
		return nil, err
	}
	if len(units) == 0 {
		return nil, NewUndefinedRootError("root")
	}

	var result []core.AgentToRendererMessage
	for _, unit := range units {
		switch u := unit.(type) {
		case deleteSurfaceUnit:
			result = append(result, core.AgentToRendererMessage{
				"version": targetVer,
				opDelete:  map[string]any{"surfaceId": u.surfaceID},
			})
		case standaloneCallUnit:
			msg, sErr := c.compileStandaloneCall(u, ctx)
			if sErr != nil {
				return nil, sErr
			}
			result = append(result, core.AgentToRendererMessage(msg))
		case *surfaceScope:
			msgs, sErr := c.compileCreateScope(u, ctx)
			if sErr != nil {
				return nil, sErr
			}
			for _, m := range msgs {
				result = append(result, core.AgentToRendererMessage(m))
			}
		}
	}
	return result, nil
}

func (c *Compiler) buildUnits(statements []Statement, surfaceID string, ctx *compileContext) ([]any, error) {
	var units []any
	var currentScope *surfaceScope

	for _, stmt := range statements {
		switch stmt.Kind {
		case StmtExpr:
			call, ok := stmt.Value.(*CallNode)
			if !ok || call == nil {
				continue
			}
			switch call.Name {
			case surfaceStatement:
				scope, err := c.openScope(call, surfaceID, ctx)
				if err != nil {
					return nil, err
				}
				currentScope = scope
				units = append(units, currentScope)
			case deleteSurfaceStatement:
				target, present, err := stringCallArg(call, 0, "surfaceId", call.Name)
				if err != nil {
					return nil, err
				}
				if !present {
					return nil, NewValidationError("deleteSurface() requires the id of the surface to delete.", "")
				}
				units = append(units, deleteSurfaceUnit{surfaceID: target})
			default:
				units = append(units, standaloneCallUnit{node: call, scope: currentScope})
			}

		case StmtAssign:
			if currentScope == nil {
				currentScope = newSurfaceScope(surfaceID)
				units = append(units, currentScope)
			}
			if strings.HasPrefix(stmt.Target, "$") {
				currentScope.setDataPath(stmt.Target, stmt.Value)
			} else {
				currentScope.setSymbol(stmt.Target, stmt.Value)
			}
		}
	}
	return units, nil
}

func (c *Compiler) checkHeaderCatalog(statement, catalogID string) error {
	if c.isMultiCatalog() {
		return NewValidationError(
			fmt.Sprintf(
				"%s() names catalog '%s', but a surface names no catalog when several catalogs are active. Remove the catalog from the line and add catalogId only to components and function calls whose name several catalogs define.",
				statement, catalogID,
			),
			"",
		)
	}
	_, err := c.helperFor(catalogID)
	return err
}

func (c *Compiler) openScope(node *CallNode, defaultSurfaceID string, ctx *compileContext) (*surfaceScope, error) {
	statement := node.Name
	targetSurf, hasSurf, err := stringCallArg(node, 0, "surfaceId", statement)
	if err != nil {
		return nil, err
	}
	if !hasSurf || targetSurf == "" {
		targetSurf = defaultSurfaceID
	}
	explicitCat, hasCat, err := stringCallArg(node, 1, "catalogId", statement)
	if err != nil {
		return nil, err
	}
	if hasCat {
		if err := c.checkHeaderCatalog(statement, explicitCat); err != nil {
			return nil, err
		}
	}

	var sendDataModelPtr *bool
	if rawSDM, hasSDM := node.Kwarg(sendDataModelKey); hasSDM && rawSDM != nil {
		b, ok := rawSDM.(bool)
		if !ok {
			return nil, NewValidationError(
				fmt.Sprintf("%s must be true or false, got: %s(%s=%v)", sendDataModelKey, statement, sendDataModelKey, rawSDM),
				"",
			)
		}
		sendDataModelPtr = &b
	}

	isUpdate := false
	if rawUpd, hasUpd := node.Kwarg(updateKey); hasUpd && rawUpd != nil {
		b, ok := rawUpd.(bool)
		if !ok {
			return nil, NewValidationError(
				fmt.Sprintf("%s must be true or false, got: %s(%s=%v)", updateKey, statement, updateKey, rawUpd),
				"",
			)
		}
		isUpdate = b
	}

	hasExt := false
	var extVal any
	if rawExt, ok := node.Kwarg(extensionsKey); ok {
		if !ctx.atLeastV10 {
			return nil, NewValidationError(
				fmt.Sprintf("%s() sets extensions, which needs A2UI v1.0 or later (target version is %s).", statement, ctx.version),
				"",
			)
		}
		if isUpdate {
			return nil, NewValidationError(
				fmt.Sprintf("%s() with update=true does not accept extensions.", statement),
				"",
			)
		}
		hasExt = true
		extVal = rawExt
	}

	scope := newSurfaceScope(targetSurf)
	scope.hasSurfaceDirective = true
	scope.sendDataModel = sendDataModelPtr
	scope.isUpdate = isUpdate
	scope.hasExtensions = hasExt
	scope.extensions = extVal
	return scope, nil
}

func (c *Compiler) seedScopeComponentIDs(scope *surfaceScope, ctx *compileContext) error {
	clear(ctx.usedIDs)
	for _, varName := range scope.rawSymbolOrder {
		ast := scope.rawSymbols[varName]
		call, ok := ast.(*CallNode)
		if !ok || call == nil {
			continue
		}
		compCatID, _ := call.Kwarg("catalogId")
		if c.definesComponent(call.Name, compCatID) {
			compID, err := componentIDOf(varName, call, ctx.atLeastV10)
			if err != nil {
				return err
			}
			if ctx.usedIDs[compID] {
				return NewValidationError(fmt.Sprintf("Duplicate component ID '%s'.", compID), "")
			}
			ctx.usedIDs[compID] = true
		}
	}
	return nil
}

func (c *Compiler) compileComponents(scope *surfaceScope, ctx *compileContext) ([]map[string]any, error) {
	if err := c.seedScopeComponentIDs(scope, ctx); err != nil {
		return nil, err
	}
	var compiled []map[string]any
	for _, varName := range scope.rawSymbolOrder {
		ast := scope.rawSymbols[varName]
		compDict, err := c.compileASTNode(varName, ast, scope.rawSymbols, ctx)
		if err != nil {
			return nil, err
		}
		if compDict != nil {
			compiled = append(compiled, compDict)
			compiled = append(compiled, ctx.extraComponents...)
			ctx.extraComponents = nil
		}
	}
	return compiled, nil
}

func (c *Compiler) compileDataValue(scope *surfaceScope, astVal any, ctx *compileContext) (any, error) {
	return c.compileValue(astVal, scope.rawSymbols, ctx, valueCompileOpts{})
}

func (c *Compiler) compileCreateScope(scope *surfaceScope, ctx *compileContext) ([]map[string]any, error) {
	compiledComponents, err := c.compileComponents(scope, ctx)
	if err != nil {
		return nil, err
	}
	surfID := scope.surfaceID
	hasRoot := false
	for _, comp := range compiledComponents {
		if comp["id"] == "root" {
			hasRoot = true
			break
		}
	}
	isCreate := !scope.isUpdate && hasRoot

	if !isCreate {
		if scope.hasExtensions {
			return nil, NewValidationError(
				"surface() extensions require a surface-creating scope with a root component.",
				"",
			)
		}
		var dataUpdates []map[string]any
		for _, pathName := range scope.dataPathOrder {
			astVal := scope.dataPathAssignments[pathName]
			pointer := toJSONPointer(pathName)
			compiledVal, dErr := c.compileDataValue(scope, astVal, ctx)
			if dErr != nil {
				return nil, dErr
			}
			if pointer == "/" {
				if _, isMap := compiledVal.(map[string]any); !isMap {
					return nil, NewValidationError(
						fmt.Sprintf("Cannot assign a non-map value to the root data path '$/' (got %T).", compiledVal),
						"",
					)
				}
			}
			dataUpdates = append(dataUpdates, map[string]any{
				"version": ctx.version,
				opUpdateData: map[string]any{
					"surfaceId": surfID,
					"path":      pointer,
					"value":     compiledVal,
				},
			})
		}
		if len(compiledComponents) == 0 {
			if len(dataUpdates) > 0 {
				return dataUpdates, nil
			}
			return nil, NewUndefinedRootError("root")
		}
		compSlice := make([]any, len(compiledComponents))
		for i, cm := range compiledComponents {
			compSlice[i] = cm
		}
		out := make([]map[string]any, 0, 1+len(dataUpdates))
		out = append(out, map[string]any{
			"version": ctx.version,
			opUpdateComponents: map[string]any{
				"surfaceId":  surfID,
				"components": compSlice,
			},
		})
		out = append(out, dataUpdates...)
		return out, nil
	}

	dataModel := make(map[string]any)
	for _, pathName := range scope.dataPathOrder {
		astVal := scope.dataPathAssignments[pathName]
		compiledVal, dErr := c.compileDataValue(scope, astVal, ctx)
		if dErr != nil {
			return nil, dErr
		}
		if err := setNestedPath(dataModel, pathName, compiledVal); err != nil {
			return nil, err
		}
	}
	return c.buildCreateMessages(scope, compiledComponents, dataModel, ctx)
}

func (c *Compiler) resolveASTVar(node any, rawSymbols map[string]any, ctx *compileContext, seen map[string]bool) (any, error) {
	cur := node
	for {
		vn, ok := cur.(VariableNode)
		if !ok {
			return cur, nil
		}
		ctx.referencedVars[vn.Name] = true
		if seen[vn.Name] {
			return nil, NewValidationError(fmt.Sprintf("Variable '%s' refers to itself.", vn.Name), "")
		}
		val, exists := rawSymbols[vn.Name]
		if !exists {
			if ctx.allowPending {
				return nil, &pendingVariableError{name: vn.Name}
			}
			return nil, NewValidationError(
				fmt.Sprintf("Undefined variable '%s' in %s expression.", vn.Name, ctx.version),
				"",
			)
		}
		seen[vn.Name] = true
		cur = val
	}
}

func (c *Compiler) checkExtensionsAST(node any, rawSymbols map[string]any, target string, ctx *compileContext, seen map[string]bool) error {
	resolved, err := c.resolveASTVar(node, rawSymbols, ctx, maps.Clone(seen))
	if err != nil {
		return err
	}
	switch r := resolved.(type) {
	case map[string]any:
		for _, k := range schemahelper.OrderedKeys(r) {
			if err := c.checkExtensionsAST(r[k], rawSymbols, target, ctx, seen); err != nil {
				return err
			}
		}
	case []any:
		for _, item := range r {
			if err := c.checkExtensionsAST(item, rawSymbols, target, ctx, seen); err != nil {
				return err
			}
		}
	case *CallNode:
		catID, hasCat := r.Kwarg("catalogId")
		if c.definesComponent(r.Name, catID) {
			return NewValidationError(
				fmt.Sprintf("%s extensions cannot contain component '%s'.", target, r.Name),
				"",
			)
		}
		if (!hasCat || catID == nil) &&
			(r.Name == "Event" || r.Name == "_template" || r.Name == surfaceStatement || r.Name == deleteSurfaceStatement) {
			return NewValidationError(
				fmt.Sprintf("%s extensions cannot contain '%s()'.", target, r.Name),
				"",
			)
		}
		for _, arg := range r.Args {
			if err := c.checkExtensionsAST(arg, rawSymbols, target, ctx, seen); err != nil {
				return err
			}
		}
		for _, kw := range r.Kwargs {
			if err := c.checkExtensionsAST(kw.Value, rawSymbols, target, ctx, seen); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *Compiler) compileExtensions(rawExt any, rawSymbols map[string]any, target string, ctx *compileContext) (map[string]any, error) {
	if !ctx.atLeastV10 {
		return nil, NewValidationError(
			fmt.Sprintf("%s sets extensions, which needs A2UI v1.0 or later (target version is %s).", target, ctx.version),
			"",
		)
	}
	top, err := c.resolveASTVar(rawExt, rawSymbols, ctx, make(map[string]bool))
	if err != nil {
		return nil, err
	}
	if _, ok := top.(map[string]any); !ok {
		return nil, NewValidationError(
			fmt.Sprintf("%s extensions must be a map, got: %v", target, top),
			"",
		)
	}
	if err := c.checkExtensionsAST(top, rawSymbols, target, ctx, make(map[string]bool)); err != nil {
		return nil, err
	}
	compiledExt, err := c.compileValue(rawExt, rawSymbols, ctx, valueCompileOpts{})
	if err != nil {
		return nil, err
	}
	return validateExtensionsMap(compiledExt, target, ctx)
}

func (c *Compiler) buildCreateMessages(
	scope *surfaceScope,
	compiledComponents []map[string]any,
	dataModel map[string]any,
	ctx *compileContext,
) ([]map[string]any, error) {
	surfID := scope.surfaceID
	create := map[string]any{"surfaceId": surfID}
	if catID := schemahelper.SurfaceCatalogID(c.catalogs); catID != "" {
		create["catalogId"] = catID
	}
	if scope.sendDataModel != nil {
		create[sendDataModelKey] = *scope.sendDataModel
	}
	if scope.hasExtensions {
		compiledExt, err := c.compileExtensions(scope.extensions, scope.rawSymbols, "surface()", ctx)
		if err != nil {
			return nil, err
		}
		create["metadata"] = map[string]any{"extensions": compiledExt}
	}

	compSlice := make([]any, len(compiledComponents))
	for i, cm := range compiledComponents {
		compSlice[i] = cm
	}

	if ctx.atLeastV10 {
		create["components"] = compSlice
		if len(dataModel) > 0 {
			create["dataModel"] = dataModel
		}
		return []map[string]any{{"version": ctx.version, opCreate: create}}, nil
	}

	messages := []map[string]any{
		{"version": ctx.version, opCreate: create},
		{
			"version": ctx.version,
			opUpdateComponents: map[string]any{
				"surfaceId":  surfID,
				"components": compSlice,
			},
		},
	}
	if len(dataModel) > 0 {
		messages = append(messages, map[string]any{
			"version": ctx.version,
			opUpdateData: map[string]any{
				"surfaceId": surfID,
				"path":      "/",
				"value":     dataModel,
			},
		})
	}
	return messages, nil
}

func (c *Compiler) compileStandaloneCall(unit standaloneCallUnit, ctx *compileContext) (map[string]any, error) {
	if !ctx.atLeastV10 {
		return nil, NewValidationError(
			fmt.Sprintf("Standalone function calls are not supported in A2UI %s", ctx.version),
			"",
		)
	}
	ctx.callCounter++
	node := unit.node
	functionCallID := fmt.Sprintf("call_%d", ctx.callCounter)
	if strippedNode, explicitRaw, hasID := node.WithoutKwarg(functionCallIDKey); hasID {
		explicitID, ok := explicitRaw.(string)
		if !ok || explicitID == "" {
			return nil, NewValidationError(
				fmt.Sprintf("%s must be a non-empty string, got: %v", functionCallIDKey, explicitRaw),
				"",
			)
		}
		functionCallID = explicitID
		node = strippedNode
	}
	if strings.HasPrefix(node.Name, "@") {
		return nil, NewValidationError(
			fmt.Sprintf(
				"System function '%s' cannot be called as a standalone statement, since a renderer function call names a catalog function.",
				node.Name,
			),
			"",
		)
	}

	var rawSyms map[string]any
	if unit.scope != nil {
		rawSyms = unit.scope.rawSymbols
	} else {
		rawSyms = map[string]any{}
	}
	compiledVal, err := c.compileValue(node, rawSyms, ctx, valueCompileOpts{})
	if err != nil {
		return nil, err
	}
	compiledMap, ok := compiledVal.(map[string]any)
	if !ok {
		return nil, NewValidationError(
			fmt.Sprintf("Standalone statement did not compile to a valid function call: %v", compiledVal),
			"",
		)
	}
	callName, hasCall := compiledMap[ctx.callKey]
	if !hasCall {
		return nil, NewValidationError(
			fmt.Sprintf("Standalone statement did not compile to a valid function call: %v", compiledVal),
			"",
		)
	}
	catID, _ := compiledMap["catalogId"].(string)
	if catID == "" {
		catID = c.catalogs[0].CatalogID()
	}
	argsVal, ok := compiledMap["args"].(map[string]any)
	if !ok || argsVal == nil {
		argsVal = map[string]any{}
	}
	return map[string]any{
		"version": ctx.version,
		"callRendererFunction": map[string]any{
			"functionCallId": functionCallID,
			"callFunction": map[string]any{
				"catalogId": catID,
				ctx.callKey: callName,
				"args":      argsVal,
			},
		},
	}, nil
}
