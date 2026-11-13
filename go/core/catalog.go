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
	"maps"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
)

const (
	jsonSchemaDraft202012  = "https://json-schema.org/draft/2020-12/schema"
	defaultCatalogProtoVer = "0.9"
	v08BasicCatalogID      = "https://a2ui.org/specification/v0_8/standard_catalog_definition.json"
	defaultCommonTypesDoc  = "common_types.json"
)

// AllowedCallers specifies which side of the protocol may invoke a function.
type AllowedCallers string

const (
	AllowedCallersRendererOnly    AllowedCallers = "rendererOnly"
	AllowedCallersAgentOnly       AllowedCallers = "agentOnly"
	AllowedCallersRendererOrAgent AllowedCallers = "rendererOrAgent"
)

// FunctionReturnType identifies the declared return type of an A2UI function.
type FunctionReturnType string

const (
	ReturnTypeString           FunctionReturnType = "string"
	ReturnTypeNumber           FunctionReturnType = "number"
	ReturnTypeBoolean          FunctionReturnType = "boolean"
	ReturnTypeArray            FunctionReturnType = "array"
	ReturnTypeObject           FunctionReturnType = "object"
	ReturnTypeAny              FunctionReturnType = "any"
	ReturnTypeVoid             FunctionReturnType = "void"
	ReturnTypeValidationResult FunctionReturnType = "validationResult"
)

// ComponentRefSpec identifies structural child reference slots on a component schema.
type ComponentRefSpec struct {
	SingleRefs       []string
	ListRefs         []string
	NestedSingleRefs map[string][]string
}

// ComponentAPI describes a component declared in a Catalog.
type ComponentAPI struct {
	Name            string
	Schema          map[string]any
	AllowedParents  []string
	AllowedChildren []string
	Metadata        map[string]any
}

// FunctionEvaluator executes a local renderer/basic-catalog function.
type FunctionEvaluator func(args map[string]any, evalCtx *DataContext) (any, error)

// FunctionAPI describes a function declared in a Catalog.
type FunctionAPI struct {
	Name                   string
	Description            string
	ReturnType             FunctionReturnType
	Schema                 map[string]any
	AllowedCallers         AllowedCallers
	RequiresUserActivation bool
	Evaluate               FunctionEvaluator

	defaultedAllowedCallers bool
	hasRequiresActivation   bool
}

// AgentFunctionContext provides invocation metadata to an AgentFunctionHandler.
type AgentFunctionContext struct {
	CatalogID      string
	SurfaceID      string
	FunctionCallID string
}

// AgentFunctionHandler executes an agent-side function invoked via callAgentFunction.
type AgentFunctionHandler func(ctx context.Context, args map[string]any, callCtx AgentFunctionContext) (any, error)

// AgentFunction defines a server-side function registered on an agent's Catalog copy.
type AgentFunction struct {
	Name                   string
	Description            string
	ReturnType             FunctionReturnType
	ArgsSchema             map[string]any
	AllowedCallers         AllowedCallers
	RequiresUserActivation bool
	Handler                AgentFunctionHandler

	fromDeclaration *FunctionAPI
}

// AgentFunctionFromAPI constructs an AgentFunction inheriting metadata from an existing FunctionAPI declaration.
func AgentFunctionFromAPI(api FunctionAPI, handler AgentFunctionHandler) (*AgentFunction, error) {
	if api.AllowedCallers == AllowedCallersAgentOnly {
		return nil, NewCatalogErrorf("function %q is agentOnly and cannot be implemented as an agent function", api.Name)
	}
	if api.RequiresUserActivation && api.AllowedCallers != "" && api.AllowedCallers != AllowedCallersRendererOnly {
		return nil, NewCatalogErrorf("function %q requiresUserActivation must be rendererOnly", api.Name)
	}
	declCopy := api
	declCopy.Schema, _ = CloneJSONValue(api.Schema).(map[string]any)
	return &AgentFunction{
		Name:                   api.Name,
		Description:            api.Description,
		ReturnType:             api.ReturnType,
		ArgsSchema:             extractFunctionArgsSchema(api.Schema),
		AllowedCallers:         api.AllowedCallers,
		RequiresUserActivation: api.RequiresUserActivation,
		Handler:                handler,
		fromDeclaration:        &declCopy,
	}, nil
}

func extractFunctionArgsSchema(schema map[string]any) map[string]any {
	if schema == nil {
		return map[string]any{"type": "object"}
	}
	if props, ok := schema["properties"].(map[string]any); ok {
		if argsObj, ok := props["args"].(map[string]any); ok {
			copied, _ := CloneJSONValue(argsObj).(map[string]any)
			return copied
		}
	}
	if paramsObj, ok := schema["parameters"].(map[string]any); ok {
		if isShorthandParamMap(paramsObj) {
			wrapped := map[string]any{
				"type":       "object",
				"properties": CloneJSONValue(paramsObj),
			}
			if req, ok := schema["required"]; ok {
				wrapped["required"] = CloneJSONValue(req)
			}
			return wrapped
		}
		copied, _ := CloneJSONValue(paramsObj).(map[string]any)
		return copied
	}
	return map[string]any{"type": "object"}
}

// CatalogLoadOptions customizes CatalogFromJSON and CatalogFromJSONBytes loading and validation.
type CatalogLoadOptions struct {
	CatalogID       string
	ProtocolVersion ProtocolVersion
	KeyOrder        map[string][]string
}

// CopyWithOptions configures Catalog.CopyWith when pruning or attaching agent functions.
// Non-empty Components, Functions, or Defs maps replace the catalog's existing entries;
// set ClearComponents, ClearFunctions, or ClearDefs to prune an entry set to empty.
type CopyWithOptions struct {
	CatalogID       string
	Components      map[string]ComponentAPI
	ComponentOrder  []string
	ClearComponents bool
	Functions       map[string]FunctionAPI
	FunctionOrder   []string
	ClearFunctions  bool
	Defs            map[string]any
	ClearDefs       bool
	AgentFunctions  []*AgentFunction
}

// DeriveOptions configures Catalog.Derive when creating a derived catalog document.
type DeriveOptions struct {
	CatalogID       string
	ProtocolVersion ProtocolVersion
	Instructions    *string
	Theme           map[string]any
	Components      []any
	Functions       []any
}

// Catalog represents a validated A2UI component and function catalog.
type Catalog struct {
	catalogID               string
	protocolVersion         ProtocolVersion
	rawProtocolVersion      string
	declaresProtocolVersion bool
	declaresCatalogID       bool
	declaresComponents      bool
	declaresDefs            bool
	schemaDialect           *string
	schemaID                *string
	title                   string
	hasTitle                bool
	description             string
	hasDescription          bool
	instructions            string
	hasInstructions         bool
	themeSchema             map[string]any
	themeLocation           string // "", "theme", "styles", "$defs"
	functionsForm           string // "", "map", "list"
	unionDefs               map[string]any
	nullUnions              map[string]bool
	defs                    map[string]any
	extras                  map[string]any
	keyOrder                map[string][]string

	components      map[string]ComponentAPI
	componentOrder  []string
	funcMu          sync.RWMutex
	functions       map[string]FunctionAPI
	functionOrder   []string
	agentFunctions  map[string]*AgentFunction
	componentRefMap map[string]ComponentRefSpec
	rawDoc          map[string]any

	valSchemaOnce sync.Once
	valSchema     map[string]any
	refMapOnce    sync.Once

	// compiled caches the JSON Schemas compiled by PayloadValidator for this catalog; it lives
	// on the catalog so that it is garbage collected together with it.
	compiledOnce sync.Once
	compiled     *catalogCompiledCache
}

// CatalogID returns the unique catalog identifier URI/string.
func (c *Catalog) CatalogID() string { return c.catalogID }

// ProtocolVersion returns the normalized protocol version targeted by this catalog.
func (c *Catalog) ProtocolVersion() ProtocolVersion { return c.protocolVersion }

// RawProtocolVersion returns the protocol version string as authored in the catalog document.
func (c *Catalog) RawProtocolVersion() string { return c.rawProtocolVersion }

// Title returns the catalog's optional title.
func (c *Catalog) Title() string { return c.title }

// Description returns the catalog's optional description.
func (c *Catalog) Description() string { return c.description }

// Instructions returns the catalog's optional markdown LLM instructions.
func (c *Catalog) Instructions() string { return c.instructions }

// ThemeSchema returns a copy of the catalog's theme schema, or nil if absent.
func (c *Catalog) ThemeSchema() map[string]any {
	if len(c.themeSchema) == 0 {
		return nil
	}
	copied, _ := CloneJSONValue(c.themeSchema).(map[string]any)
	return copied
}

// KeyOrder returns a copy of the RFC 6901 JSON Pointer -> ordered object keys map for the catalog document.
func (c *Catalog) KeyOrder() map[string][]string {
	if c == nil || len(c.keyOrder) == 0 {
		return nil
	}
	out := make(map[string][]string, len(c.keyOrder))
	for k, v := range c.keyOrder {
		out[k] = append([]string(nil), v...)
	}
	return out
}

func cloneComponentAPI(api ComponentAPI) ComponentAPI {
	cp := api
	if api.Schema != nil {
		cp.Schema, _ = CloneJSONValue(api.Schema).(map[string]any)
	}
	if api.AllowedParents != nil {
		cp.AllowedParents = slices.Clone(api.AllowedParents)
	}
	if api.AllowedChildren != nil {
		cp.AllowedChildren = slices.Clone(api.AllowedChildren)
	}
	if api.Metadata != nil {
		cp.Metadata, _ = CloneJSONValue(api.Metadata).(map[string]any)
	}
	return cp
}

func cloneFunctionAPI(api FunctionAPI) FunctionAPI {
	cp := api
	if api.Schema != nil {
		cp.Schema, _ = CloneJSONValue(api.Schema).(map[string]any)
	}
	return cp
}

func cloneAgentFunction(af *AgentFunction) *AgentFunction {
	if af == nil {
		return nil
	}
	cp := *af
	if af.ArgsSchema != nil {
		cp.ArgsSchema, _ = CloneJSONValue(af.ArgsSchema).(map[string]any)
	}
	if af.fromDeclaration != nil {
		decl := cloneFunctionAPI(*af.fromDeclaration)
		cp.fromDeclaration = &decl
	}
	return &cp
}

func cloneComponentRefSpec(spec ComponentRefSpec) ComponentRefSpec {
	cp := ComponentRefSpec{}
	if spec.SingleRefs != nil {
		cp.SingleRefs = slices.Clone(spec.SingleRefs)
	}
	if spec.ListRefs != nil {
		cp.ListRefs = slices.Clone(spec.ListRefs)
	}
	if spec.NestedSingleRefs != nil {
		cp.NestedSingleRefs = make(map[string][]string, len(spec.NestedSingleRefs))
		for k, v := range spec.NestedSingleRefs {
			cp.NestedSingleRefs[k] = slices.Clone(v)
		}
	}
	return cp
}

func (c *Catalog) functionByName(name string) (FunctionAPI, bool) {
	if c == nil {
		return FunctionAPI{}, false
	}
	c.funcMu.RLock()
	fn, ok := c.functions[name]
	c.funcMu.RUnlock()
	return fn, ok
}

func (c *Catalog) snapshotFunctions() map[string]FunctionAPI {
	if c == nil {
		return nil
	}
	c.funcMu.RLock()
	defer c.funcMu.RUnlock()
	return maps.Clone(c.functions)
}

// Components returns a deep copy of the components defined by this catalog.
func (c *Catalog) Components() map[string]ComponentAPI {
	if c == nil || c.components == nil {
		return nil
	}
	out := make(map[string]ComponentAPI, len(c.components))
	for k, v := range c.components {
		out[k] = cloneComponentAPI(v)
	}
	return out
}

// ComponentNames returns the ordered component names defined in this catalog.
func (c *Catalog) ComponentNames() []string { return append([]string(nil), c.componentOrder...) }

// Functions returns a deep copy of all functions (renderer and agent) declared on this catalog.
func (c *Catalog) Functions() map[string]FunctionAPI {
	if c == nil {
		return nil
	}
	c.funcMu.RLock()
	defer c.funcMu.RUnlock()
	if c.functions == nil {
		return nil
	}
	out := make(map[string]FunctionAPI, len(c.functions))
	for k, v := range c.functions {
		out[k] = cloneFunctionAPI(v)
	}
	return out
}

// SetFunctionEvaluator attaches or replaces the local FunctionEvaluator for a declared function.
func (c *Catalog) SetFunctionEvaluator(name string, eval FunctionEvaluator) bool {
	if c == nil {
		return false
	}
	c.funcMu.Lock()
	if c.functions == nil {
		c.funcMu.Unlock()
		return false
	}
	fn, ok := c.functions[name]
	if !ok {
		c.funcMu.Unlock()
		return false
	}
	fn.Evaluate = eval
	c.functions[name] = fn
	c.funcMu.Unlock()

	cache := getCompiledCache(c)
	cache.mu.Lock()
	delete(cache.functions, name)
	cache.mu.Unlock()
	return true
}

// FunctionNames returns the ordered function names defined in this catalog.
func (c *Catalog) FunctionNames() []string { return append([]string(nil), c.functionOrder...) }

// RendererFunctions returns only functions declared in the catalog (excluding added AgentFunctions).
func (c *Catalog) RendererFunctions() map[string]FunctionAPI {
	if c == nil {
		return nil
	}
	c.funcMu.RLock()
	defer c.funcMu.RUnlock()
	out := make(map[string]FunctionAPI, len(c.functions))
	for k, fn := range c.functions {
		if _, isAgent := c.agentFunctions[k]; !isAgent {
			out[k] = cloneFunctionAPI(fn)
		}
	}
	return out
}

// AgentFunctions returns a deep copy of the server-side AgentFunction handlers registered on this catalog.
func (c *Catalog) AgentFunctions() map[string]*AgentFunction {
	if c == nil || c.agentFunctions == nil {
		return nil
	}
	out := make(map[string]*AgentFunction, len(c.agentFunctions))
	for k, af := range c.agentFunctions {
		out[k] = cloneAgentFunction(af)
	}
	return out
}

// ComponentRefMap returns structural child reference metadata per component name.
func (c *Catalog) ComponentRefMap() map[string]ComponentRefSpec {
	if c == nil {
		return nil
	}
	src := c.refMap()
	out := make(map[string]ComponentRefSpec, len(src))
	for k, spec := range src {
		out[k] = cloneComponentRefSpec(spec)
	}
	return out
}

func (c *Catalog) refMap() map[string]ComponentRefSpec {
	c.refMapOnce.Do(func() {
		c.componentRefMap = buildCatalogRefMap(c)
	})
	return c.componentRefMap
}

func (c *Catalog) clone() *Catalog {
	comps := make(map[string]ComponentAPI, len(c.components))
	for k, v := range c.components {
		comps[k] = cloneComponentAPI(v)
	}
	c.funcMu.RLock()
	fns := make(map[string]FunctionAPI, len(c.functions))
	for k, v := range c.functions {
		fns[k] = cloneFunctionAPI(v)
	}
	c.funcMu.RUnlock()

	agentFns := make(map[string]*AgentFunction, len(c.agentFunctions))
	for k, af := range c.agentFunctions {
		agentFns[k] = cloneAgentFunction(af)
	}
	var themeCopy map[string]any
	if c.themeSchema != nil {
		themeCopy, _ = CloneJSONValue(c.themeSchema).(map[string]any)
	}
	var unionCopy map[string]any
	if c.unionDefs != nil {
		unionCopy = make(map[string]any, len(c.unionDefs))
		for k, v := range c.unionDefs {
			unionCopy[k] = CloneJSONValue(v)
		}
	}
	var defsCopy map[string]any
	if c.defs != nil {
		defsCopy, _ = CloneJSONValue(c.defs).(map[string]any)
	}
	var extrasCopy map[string]any
	if c.extras != nil {
		extrasCopy, _ = CloneJSONValue(c.extras).(map[string]any)
	}
	var rawDocCopy map[string]any
	if c.rawDoc != nil {
		rawDocCopy, _ = CloneJSONValue(c.rawDoc).(map[string]any)
	}
	var dialectCopy, idCopy *string
	if c.schemaDialect != nil {
		s := *c.schemaDialect
		dialectCopy = &s
	}
	if c.schemaID != nil {
		s := *c.schemaID
		idCopy = &s
	}
	return &Catalog{
		catalogID:               c.catalogID,
		protocolVersion:         c.protocolVersion,
		rawProtocolVersion:      c.rawProtocolVersion,
		declaresProtocolVersion: c.declaresProtocolVersion,
		declaresCatalogID:       c.declaresCatalogID,
		declaresComponents:      c.declaresComponents,
		declaresDefs:            c.declaresDefs,
		schemaDialect:           dialectCopy,
		schemaID:                idCopy,
		title:                   c.title,
		hasTitle:                c.hasTitle,
		description:             c.description,
		hasDescription:          c.hasDescription,
		instructions:            c.instructions,
		hasInstructions:         c.hasInstructions,
		themeSchema:             themeCopy,
		themeLocation:           c.themeLocation,
		functionsForm:           c.functionsForm,
		unionDefs:               unionCopy,
		nullUnions:              maps.Clone(c.nullUnions),
		defs:                    defsCopy,
		extras:                  extrasCopy,
		keyOrder:                c.KeyOrder(),
		components:              comps,
		componentOrder:          append([]string(nil), c.componentOrder...),
		functions:               fns,
		functionOrder:           append([]string(nil), c.functionOrder...),
		agentFunctions:          agentFns,
		rawDoc:                  rawDocCopy,
	}
}

// ToJSON serializes the unbundled catalog document as a JSON-compatible map.
func (c *Catalog) ToJSON() map[string]any {
	if c == nil {
		return map[string]any{}
	}
	if c.rawDoc != nil {
		copied, _ := CloneJSONValue(c.rawDoc).(map[string]any)
		return copied
	}
	copied, _ := CloneJSONValue(c.buildDocument()).(map[string]any)
	return copied
}

// ValidationSchema returns the self-contained JSON Schema document used for payload validation.
func (c *Catalog) ValidationSchema() map[string]any {
	copied, _ := CloneJSONValue(c.validationSchema()).(map[string]any)
	return copied
}

// validationSchema returns the cached validation schema without copying. Callers inside package
// core must treat the returned map and all nested values as read-only.
func (c *Catalog) validationSchema() map[string]any {
	c.valSchemaOnce.Do(func() {
		c.valSchema = buildCatalogValidationSchema(c)
	})
	return c.valSchema
}

// ResolvedComponentSchema returns the schema for component name with local $defs resolved and cross-document refs localized.
func (c *Catalog) ResolvedComponentSchema(name string) map[string]any {
	api, ok := c.components[name]
	if !ok {
		return nil
	}
	root := c.normalizedLocalRoot()
	norm := normalizeExternalSchemaRefs(CloneJSONValue(api.Schema))
	resolved, _ := inlineLocalRefs(norm, root, true).(map[string]any)
	return resolved
}

// ResolvedFunctionSchema returns the schema for function name with local $defs resolved and cross-document refs localized.
func (c *Catalog) ResolvedFunctionSchema(name string) map[string]any {
	api, ok := c.functionByName(name)
	if !ok {
		return nil
	}
	if api.Schema == nil {
		return map[string]any{}
	}
	root := c.normalizedLocalRoot()
	norm := normalizeExternalSchemaRefs(CloneJSONValue(api.Schema))
	resolved, _ := inlineLocalRefs(norm, root, true).(map[string]any)
	return resolved
}

func (c *Catalog) normalizedLocalRoot() map[string]any {
	ownDefs := make(map[string]any, len(c.defs)+1)
	for k, v := range c.defs {
		if k != "anyComponent" && k != "anyFunction" {
			ownDefs[k] = v
		}
	}
	if c.themeLocation == "$defs" && len(c.themeSchema) > 0 {
		ownDefs["theme"] = c.themeSchema
	}
	comps := make(map[string]any, len(c.components))
	for k, comp := range c.components {
		comps[k] = comp.Schema
	}
	fnSnap := c.snapshotFunctions()
	fns := make(map[string]any, len(fnSnap))
	for k, fn := range fnSnap {
		if fn.Schema != nil {
			fns[k] = fn.Schema
		}
	}
	rawRoot := map[string]any{
		"$defs":      ownDefs,
		"components": comps,
		"functions":  fns,
	}
	norm, _ := normalizeExternalSchemaRefs(rawRoot).(map[string]any)
	return norm
}

func (c *Catalog) buildDocument() map[string]any {
	doc := map[string]any{}
	if c.schemaDialect != nil {
		doc["$schema"] = *c.schemaDialect
	}
	if c.schemaID != nil {
		doc["$id"] = *c.schemaID
	}
	if c.declaresProtocolVersion {
		doc["protocolVersion"] = c.rawProtocolVersion
	}
	if c.hasTitle {
		doc["title"] = c.title
	}
	if c.hasDescription {
		doc["description"] = c.description
	}
	if c.declaresCatalogID {
		doc["catalogId"] = c.catalogID
	}
	if c.hasInstructions {
		doc["instructions"] = c.instructions
	}
	for k, v := range c.extras {
		doc[k] = CloneJSONValue(v)
	}

	if len(c.componentOrder) > 0 || c.declaresComponents {
		comps := make(map[string]any, len(c.componentOrder))
		for _, name := range c.componentOrder {
			comp := c.components[name]
			entry, _ := CloneJSONValue(comp.Schema).(map[string]any)
			if entry == nil {
				entry = map[string]any{"type": "object"}
			}
			if comp.AllowedParents != nil {
				entry["allowedParents"] = stringsToAnySlice(comp.AllowedParents)
			}
			if comp.AllowedChildren != nil {
				entry["allowedChildren"] = stringsToAnySlice(comp.AllowedChildren)
			}
			if comp.Metadata != nil {
				entry["metadata"] = CloneJSONValue(comp.Metadata)
			}
			comps[name] = entry
		}
		doc["components"] = comps
	}

	fnSnap := c.snapshotFunctions()
	var docFnNames []string
	for _, name := range c.functionOrder {
		fn := fnSnap[name]
		if fn.Schema != nil || !strings.HasPrefix(name, "@") {
			docFnNames = append(docFnNames, name)
		}
	}
	if len(docFnNames) > 0 || c.functionsForm != "" {
		if c.functionsForm == "list" {
			list := make([]any, 0, len(docFnNames))
			for _, name := range docFnNames {
				fn := fnSnap[name]
				entry := buildFunctionDocEntry(name, fn, IsAtLeastVersion(string(c.protocolVersion), Version1_0), true)
				list = append(list, entry)
			}
			doc["functions"] = list
		} else {
			fnMap := make(map[string]any, len(docFnNames))
			for _, name := range docFnNames {
				fn := fnSnap[name]
				fnMap[name] = buildFunctionDocEntry(name, fn, IsAtLeastVersion(string(c.protocolVersion), Version1_0), false)
			}
			doc["functions"] = fnMap
		}
	}

	if len(c.themeSchema) > 0 || c.themeLocation == "theme" {
		switch c.themeLocation {
		case "theme":
			doc["theme"] = CloneJSONValue(c.themeSchema)
		case "styles":
			if props, ok := c.themeSchema["properties"].(map[string]any); ok {
				doc["styles"] = CloneJSONValue(props)
			} else {
				doc["styles"] = CloneJSONValue(c.themeSchema)
			}
		}
	}

	defs := map[string]any{}
	for k, v := range c.defs {
		if k != "anyComponent" && k != "anyFunction" {
			defs[k] = CloneJSONValue(v)
		}
	}
	if c.themeLocation == "$defs" && len(c.themeSchema) > 0 {
		defs["theme"] = CloneJSONValue(c.themeSchema)
	}
	for k, v := range c.buildUnionDocuments(c.componentOrder, docFnNames) {
		defs[k] = v
	}
	if len(defs) > 0 || c.declaresDefs {
		doc["$defs"] = defs
	}
	return doc
}

func buildFunctionDocEntry(name string, fn FunctionAPI, isV10 bool, asListItem bool) map[string]any {
	if fn.Schema != nil {
		entry, _ := CloneJSONValue(fn.Schema).(map[string]any)
		if asListItem {
			entry["name"] = name
		}
		if fn.Description != "" {
			entry["description"] = fn.Description
		}
		declaredRT := declaredReturnType(entry)
		if declaredRT == "" {
			declaredRT = ReturnTypeAny
		}
		if fn.ReturnType != "" && fn.ReturnType != declaredRT {
			if _, hasTop := entry["returnType"]; !hasTop {
				if props, ok := entry["properties"].(map[string]any); ok {
					if callRT, ok := props["returnType"].(map[string]any); ok && hasKey(callRT, "const") {
						callRT["const"] = string(fn.ReturnType)
					} else {
						entry["returnType"] = string(fn.ReturnType)
					}
				} else {
					entry["returnType"] = string(fn.ReturnType)
				}
			} else {
				entry["returnType"] = string(fn.ReturnType)
			}
		}
		declaredAC, _ := entry["allowedCallers"].(string)
		if declaredAC == "" {
			declaredAC = string(AllowedCallersRendererOnly)
		}
		if fn.AllowedCallers != "" && string(fn.AllowedCallers) != declaredAC {
			entry["allowedCallers"] = string(fn.AllowedCallers)
		}
		declaredRUA, _ := entry["requiresUserActivation"].(bool)
		if fn.RequiresUserActivation != declaredRUA {
			entry["requiresUserActivation"] = fn.RequiresUserActivation
		}
		return entry
	}
	args := map[string]any{"type": "object", "properties": map[string]any{}}
	rt := string(fn.ReturnType)
	if rt == "" {
		rt = string(ReturnTypeAny)
	}
	if asListItem {
		out := map[string]any{
			"name":       name,
			"returnType": rt,
			"parameters": args,
		}
		if fn.Description != "" {
			out["description"] = fn.Description
		}
		if fn.AllowedCallers != "" && !fn.defaultedAllowedCallers {
			out["allowedCallers"] = string(fn.AllowedCallers)
		}
		if fn.hasRequiresActivation || fn.RequiresUserActivation {
			out["requiresUserActivation"] = fn.RequiresUserActivation
		}
		return out
	}
	if isV10 {
		out := map[string]any{
			"type":       "object",
			"returnType": rt,
			"properties": map[string]any{
				"@call": map[string]any{"const": name},
				"args":  args,
			},
			"required": []any{"@call"},
		}
		if fn.Description != "" {
			out["description"] = fn.Description
		}
		if fn.AllowedCallers != "" && !fn.defaultedAllowedCallers {
			out["allowedCallers"] = string(fn.AllowedCallers)
		}
		if fn.hasRequiresActivation || fn.RequiresUserActivation {
			out["requiresUserActivation"] = fn.RequiresUserActivation
		}
		return out
	}
	out := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"call":       map[string]any{"const": name},
			"args":       args,
			"returnType": map[string]any{"const": rt},
		},
		"required":              []any{"call"},
		"unevaluatedProperties": false,
	}
	if fn.Description != "" {
		out["description"] = fn.Description
	}
	return out
}

func (c *Catalog) buildUnionDocuments(compNames, fnNames []string) map[string]any {
	if c.unionDefs == nil {
		v1 := IsAtLeastVersion(string(c.protocolVersion), Version1_0)
		unions := map[string]any{}
		if len(compNames) > 0 || v1 {
			unions["anyComponent"] = makeComponentUnion(compNames)
		}
		if len(fnNames) > 0 || v1 {
			unions["anyFunction"] = makeFunctionUnion(fnNames)
		}
		return unions
	}
	out := map[string]any{}
	for name, authored := range c.unionDefs {
		if authored != nil || c.nullUnions[name] {
			out[name] = CloneJSONValue(authored)
		} else if name == "anyComponent" {
			out[name] = makeComponentUnion(compNames)
		} else if name == "anyFunction" {
			out[name] = makeFunctionUnion(fnNames)
		}
	}
	return out
}

func makeComponentUnion(names []string) map[string]any {
	if len(names) == 0 {
		return map[string]any{"not": map[string]any{}}
	}
	oneOf := make([]any, len(names))
	for i, n := range names {
		oneOf[i] = map[string]any{"$ref": "#/components/" + escapeJSONPointerToken(n)}
	}
	return map[string]any{
		"oneOf":         oneOf,
		"discriminator": map[string]any{"propertyName": "component"},
	}
}

func makeFunctionUnion(names []string) map[string]any {
	if len(names) == 0 {
		return map[string]any{"not": map[string]any{}}
	}
	oneOf := make([]any, len(names))
	for i, n := range names {
		oneOf[i] = map[string]any{"$ref": "#/functions/" + escapeJSONPointerToken(n)}
	}
	return map[string]any{"oneOf": oneOf}
}

// CopyWith returns a modified copy of the catalog with updated components, functions, defs, or agent functions.
func (c *Catalog) CopyWith(opts CopyWithOptions) (*Catalog, error) {
	catID := c.catalogID
	if opts.CatalogID != "" {
		catID = opts.CatalogID
	}
	fnSnap := c.snapshotFunctions()

	var compOrder []string
	comps := make(map[string]ComponentAPI)
	if opts.ClearComponents || len(opts.Components) > 0 {
		for k, v := range opts.Components {
			comps[k] = cloneComponentAPI(v)
		}
		if len(opts.ComponentOrder) > 0 {
			for _, name := range opts.ComponentOrder {
				if _, ok := comps[name]; ok {
					compOrder = append(compOrder, name)
				}
			}
		} else {
			for _, name := range c.componentOrder {
				if _, ok := comps[name]; ok {
					compOrder = append(compOrder, name)
				}
			}
			var extra []string
			for k := range comps {
				if !containsString(compOrder, k) {
					extra = append(extra, k)
				}
			}
			sort.Strings(extra)
			compOrder = append(compOrder, extra...)
		}
	} else {
		compOrder = append([]string(nil), c.componentOrder...)
		for k, v := range c.components {
			comps[k] = cloneComponentAPI(v)
		}
	}

	var fnOrder []string
	fns := make(map[string]FunctionAPI)
	newAgentFns := make(map[string]*AgentFunction)

	if opts.ClearFunctions || len(opts.Functions) > 0 {
		for k, v := range opts.Functions {
			fns[k] = cloneFunctionAPI(v)
			if existingAgent, ok := c.agentFunctions[k]; ok {
				newAgentFns[k] = cloneAgentFunction(existingAgent)
			}
		}
		if len(opts.FunctionOrder) > 0 {
			for _, name := range opts.FunctionOrder {
				if _, ok := fns[name]; ok {
					fnOrder = append(fnOrder, name)
				}
			}
		} else {
			for _, name := range c.functionOrder {
				if _, ok := fns[name]; ok {
					fnOrder = append(fnOrder, name)
				}
			}
			var extra []string
			for k := range fns {
				if !containsString(fnOrder, k) {
					extra = append(extra, k)
				}
			}
			sort.Strings(extra)
			fnOrder = append(fnOrder, extra...)
		}
	} else if opts.AgentFunctions != nil {
		// Restore base functions (reverting previous AgentFunctions back to their declaration if built from API, or dropping pure agent functions).
		for _, name := range c.functionOrder {
			if af, wasAgent := c.agentFunctions[name]; wasAgent {
				if af.fromDeclaration != nil {
					fns[name] = cloneFunctionAPI(*af.fromDeclaration)
					fnOrder = append(fnOrder, name)
				}
			} else if baseFn, ok := fnSnap[name]; ok {
				fns[name] = cloneFunctionAPI(baseFn)
				fnOrder = append(fnOrder, name)
			}
		}
	} else {
		fnOrder = append([]string(nil), c.functionOrder...)
		for k, v := range fnSnap {
			fns[k] = cloneFunctionAPI(v)
		}
		for k, v := range c.agentFunctions {
			newAgentFns[k] = cloneAgentFunction(v)
		}
	}

	mergedDefs := opts.Defs
	hasMergedDefs := opts.ClearDefs || len(opts.Defs) > 0
	if len(opts.AgentFunctions) > 0 {
		if !IsAtLeastVersion(string(c.protocolVersion), Version1_0) {
			return nil, NewCatalogErrorf("catalog %q targets protocol version %s, which does not support agent functions (requires v1.0 or later)", catID, c.protocolVersion)
		}
		if mergedDefs == nil && !opts.ClearDefs {
			mergedDefs = make(map[string]any, len(c.defs))
			for k, v := range c.defs {
				mergedDefs[k] = CloneJSONValue(v)
			}
		} else {
			cp := make(map[string]any, len(mergedDefs))
			for k, v := range mergedDefs {
				cp[k] = CloneJSONValue(v)
			}
			mergedDefs = cp
		}
		seenAgent := map[string]bool{}
		for _, af := range opts.AgentFunctions {
			afClean, hoisted, err := validateAndHoistAgentFunction(catID, c.protocolVersion, af, mergedDefs, nil, seenAgent)
			if err != nil {
				return nil, err
			}
			if hoisted {
				hasMergedDefs = true
			}
			_, exists := fns[afClean.Name]
			if !exists {
				if afClean.fromDeclaration != nil {
					return nil, NewCatalogErrorf("catalog %q has no function named %q for AgentFunctionFromAPI to replace", catID, afClean.Name)
				}
				fns[afClean.Name] = agentFunctionToAPI(afClean, mergedDefs)
				fnOrder = append(fnOrder, afClean.Name)
				newAgentFns[afClean.Name] = afClean
			} else if afClean.fromDeclaration != nil {
				fns[afClean.Name] = agentFunctionToAPI(afClean, mergedDefs)
				newAgentFns[afClean.Name] = afClean
			} else {
				return nil, NewCatalogErrorf("catalog %q already declares a function named %q", catID, afClean.Name)
			}
		}
	}

	return c.rebuild(catID, c.protocolVersion, c.schemaID, c.hasTitle, c.title, c.hasDescription, c.description, c.hasInstructions, c.instructions, c.themeSchema, c.declaresCatalogID, comps, compOrder, fns, fnOrder, newAgentFns, mergedDefs, hasMergedDefs, nil), nil
}

func validateAndHoistAgentFunction(
	catID string,
	pVer ProtocolVersion,
	af *AgentFunction,
	mergedDefs map[string]any,
	hoistedOut map[string]any,
	seenAgent map[string]bool,
) (*AgentFunction, bool, error) {
	if !IsAtLeastVersion(string(pVer), Version1_0) {
		return nil, false, NewCatalogErrorf("catalog %q targets protocol version %s, which does not support agent functions (requires v1.0 or later)", catID, pVer)
	}
	if af == nil {
		return nil, false, NewCatalogErrorf("catalog %q was given a nil AgentFunction", catID)
	}
	if !IsValidUAX31Identifier(af.Name) {
		return nil, false, NewCatalogErrorf("invalid UAX #31 function identifier: %q", af.Name)
	}
	hoisted := false
	var effectiveArgsSchema map[string]any
	if af.ArgsSchema != nil {
		effectiveArgsSchema, _ = CloneJSONValue(af.ArgsSchema).(map[string]any)
		if localDefs, ok := effectiveArgsSchema["$defs"].(map[string]any); ok {
			delete(effectiveArgsSchema, "$defs")
			hoisted = true
			defNames := make([]string, 0, len(localDefs))
			for k := range localDefs {
				defNames = append(defNames, k)
			}
			sort.Strings(defNames)
			for _, defName := range defNames {
				defVal := localDefs[defName]
				if existingDef, already := mergedDefs[defName]; already {
					if !reflect.DeepEqual(existingDef, defVal) {
						return nil, false, NewCatalogErrorf("agent function %q local $defs entry %q conflicts with an existing definition of %q", af.Name, defName, defName)
					}
				} else {
					clonedDef := CloneJSONValue(defVal)
					mergedDefs[defName] = clonedDef
				}
				if hoistedOut != nil {
					hoistedOut[defName] = CloneJSONValue(defVal)
				}
			}
		}
	}
	for _, pName := range extractReachableParamNames(effectiveArgsSchema, mergedDefs) {
		if !IsValidUAX31Identifier(pName) {
			return nil, false, NewCatalogErrorf("invalid UAX #31 argument identifier %q in agent function %q", pName, af.Name)
		}
	}
	if seenAgent[af.Name] {
		return nil, false, NewCatalogErrorf("catalog %q was given duplicate agent function %q", catID, af.Name)
	}
	seenAgent[af.Name] = true

	afClean := cloneAgentFunction(af)
	if effectiveArgsSchema != nil {
		afClean.ArgsSchema = effectiveArgsSchema
	}
	return afClean, hoisted, nil
}

func agentFunctionToAPI(af *AgentFunction, defs map[string]any) FunctionAPI {
	argsSchema := af.ArgsSchema
	if argsSchema == nil {
		argsSchema = map[string]any{"type": "object", "properties": map[string]any{}}
	}
	rt := af.ReturnType
	if rt == "" {
		rt = ReturnTypeAny
	}
	hasReq := schemaRequiresArgs(argsSchema, defs, map[string]bool{})
	req := []any{"@call"}
	if hasReq {
		req = []any{"@call", "args"}
	}
	schema := map[string]any{
		"type":       "object",
		"returnType": string(rt),
		"properties": map[string]any{
			"@call": map[string]any{"const": af.Name},
			"args":  CloneJSONValue(argsSchema),
		},
		"required": req,
	}
	if af.Description != "" {
		schema["description"] = af.Description
	}
	if af.AllowedCallers != "" {
		schema["allowedCallers"] = string(af.AllowedCallers)
	}
	if af.RequiresUserActivation {
		schema["requiresUserActivation"] = true
	}
	return FunctionAPI{
		Name:                   af.Name,
		Description:            af.Description,
		ReturnType:             rt,
		Schema:                 schema,
		AllowedCallers:         af.AllowedCallers,
		RequiresUserActivation: af.RequiresUserActivation,
		hasRequiresActivation:  af.RequiresUserActivation,
	}
}

// Derive creates a derived catalog from this source catalog under a new CatalogID.
func (c *Catalog) Derive(opts DeriveOptions) (*Catalog, error) {
	if opts.CatalogID == "" {
		return nil, NewCatalogError("Catalog.Derive requires a non-empty CatalogID")
	}
	pVer := c.protocolVersion
	if opts.ProtocolVersion != "" {
		norm, err := ToProtocolVersion(string(opts.ProtocolVersion))
		if err != nil {
			return nil, err
		}
		pVer = norm
	}
	fnSnap := c.snapshotFunctions()

	var compOrder []string
	comps := make(map[string]ComponentAPI)
	if opts.Components == nil {
		compOrder = append([]string(nil), c.componentOrder...)
		for k, v := range c.components {
			comps[k] = cloneComponentAPI(v)
		}
	} else {
		for _, item := range opts.Components {
			switch v := item.(type) {
			case string:
				orig, ok := c.components[v]
				if !ok {
					return nil, NewCatalogErrorf("catalog %q has no component %q to derive catalog %q from", c.catalogID, v, opts.CatalogID)
				}
				if !containsString(compOrder, v) {
					compOrder = append(compOrder, v)
				}
				comps[v] = cloneComponentAPI(orig)
			case ComponentAPI:
				if !containsString(compOrder, v.Name) {
					compOrder = append(compOrder, v.Name)
				}
				comps[v.Name] = cloneComponentAPI(v)
			case map[string]any:
				if len(v) != 1 {
					return nil, NewCatalogErrorf("derived component map entry must have exactly one component name key")
				}
				for name, rawSchema := range v {
					sMap, ok := rawSchema.(map[string]any)
					if !ok {
						return nil, NewCatalogErrorf("derived component %q schema must be an object", name)
					}
					api, err := parseComponentEntry(name, sMap, IsAtLeastVersion(string(pVer), Version1_0))
					if err != nil {
						return nil, err
					}
					if !containsString(compOrder, name) {
						compOrder = append(compOrder, name)
					}
					comps[name] = api
				}
			default:
				return nil, NewCatalogErrorf("unsupported component item %T in Catalog.Derive", item)
			}
		}
	}

	var fnOrder []string
	fns := make(map[string]FunctionAPI)
	newAgentFns := make(map[string]*AgentFunction)
	var hoistedDefs map[string]any
	if opts.Functions == nil {
		fnOrder = append([]string(nil), c.functionOrder...)
		for k, v := range fnSnap {
			fns[k] = cloneFunctionAPI(v)
		}
		for k, v := range c.agentFunctions {
			newAgentFns[k] = cloneAgentFunction(v)
		}
	} else {
		var mergedDefs map[string]any
		seenAgent := map[string]bool{}
		ensureMergedDefs := func() {
			if mergedDefs != nil {
				return
			}
			mergedDefs = make(map[string]any, len(c.defs))
			for k, v := range c.defs {
				mergedDefs[k] = CloneJSONValue(v)
			}
			hoistedDefs = map[string]any{}
		}
		addDerivedAgentFn := func(af *AgentFunction) error {
			ensureMergedDefs()
			afClean, _, err := validateAndHoistAgentFunction(opts.CatalogID, pVer, af, mergedDefs, hoistedDefs, seenAgent)
			if err != nil {
				return err
			}
			_, inDerived := fns[afClean.Name]
			_, inSource := fnSnap[afClean.Name]
			if afClean.fromDeclaration != nil {
				if !inDerived && !inSource {
					return NewCatalogErrorf("catalog %q has no function named %q for AgentFunctionFromAPI to replace", opts.CatalogID, afClean.Name)
				}
				if !containsString(fnOrder, afClean.Name) {
					fnOrder = append(fnOrder, afClean.Name)
				}
				fns[afClean.Name] = agentFunctionToAPI(afClean, mergedDefs)
				newAgentFns[afClean.Name] = afClean
				return nil
			}
			if inDerived {
				return NewCatalogErrorf("catalog %q already declares a function named %q", opts.CatalogID, afClean.Name)
			}
			fnOrder = append(fnOrder, afClean.Name)
			fns[afClean.Name] = agentFunctionToAPI(afClean, mergedDefs)
			newAgentFns[afClean.Name] = afClean
			return nil
		}

		for _, item := range opts.Functions {
			switch v := item.(type) {
			case string:
				if seenAgent[v] {
					return nil, NewCatalogErrorf("catalog %q already declares a function named %q", opts.CatalogID, v)
				}
				orig, ok := fnSnap[v]
				if !ok {
					return nil, NewCatalogErrorf("catalog %q has no function %q to derive catalog %q from", c.catalogID, v, opts.CatalogID)
				}
				if !containsString(fnOrder, v) {
					fnOrder = append(fnOrder, v)
				}
				fns[v] = cloneFunctionAPI(orig)
				if af, isAg := c.agentFunctions[v]; isAg {
					newAgentFns[v] = cloneAgentFunction(af)
				}
			case FunctionAPI:
				if seenAgent[v.Name] {
					return nil, NewCatalogErrorf("catalog %q already declares a function named %q", opts.CatalogID, v.Name)
				}
				if !containsString(fnOrder, v.Name) {
					fnOrder = append(fnOrder, v.Name)
				}
				fns[v.Name] = cloneFunctionAPI(v)
				delete(newAgentFns, v.Name)
			case *AgentFunction:
				if err := addDerivedAgentFn(v); err != nil {
					return nil, err
				}
			case AgentFunction:
				vCopy := v
				if err := addDerivedAgentFn(&vCopy); err != nil {
					return nil, err
				}
			case map[string]any:
				if len(v) != 1 {
					return nil, NewCatalogErrorf("derived function map entry must have exactly one function name key")
				}
				for name, rawSchema := range v {
					if seenAgent[name] {
						return nil, NewCatalogErrorf("catalog %q already declares a function named %q", opts.CatalogID, name)
					}
					sMap, ok := rawSchema.(map[string]any)
					if !ok {
						return nil, NewCatalogErrorf("derived function %q schema must be an object", name)
					}
					api, err := parseFunctionEntry(name, sMap, IsAtLeastVersion(string(pVer), Version1_0))
					if err != nil {
						return nil, err
					}
					if !containsString(fnOrder, name) {
						fnOrder = append(fnOrder, name)
					}
					fns[name] = api
					delete(newAgentFns, name)
				}
			default:
				return nil, NewCatalogErrorf("unsupported function item %T in Catalog.Derive", item)
			}
		}
	}

	theme := c.themeSchema
	if opts.Theme != nil {
		theme = opts.Theme
	}
	hasInstr := opts.Instructions != nil
	instr := ""
	if opts.Instructions != nil {
		instr = *opts.Instructions
	}

	return c.rebuild(opts.CatalogID, pVer, nil, false, "", false, "", hasInstr, instr, theme, true, comps, compOrder, fns, fnOrder, newAgentFns, nil, false, hoistedDefs), nil
}

func (c *Catalog) rebuild(
	catID string,
	pVer ProtocolVersion,
	schemaID *string,
	hasTitle bool,
	title string,
	hasDesc bool,
	desc string,
	hasInstr bool,
	instr string,
	theme map[string]any,
	declaresCatID bool,
	comps map[string]ComponentAPI,
	compOrder []string,
	fns map[string]FunctionAPI,
	fnOrder []string,
	agentFns map[string]*AgentFunction,
	explicitDefs map[string]any,
	hasExplicitDefs bool,
	hoistedDefs map[string]any,
) *Catalog {
	var unionDefs map[string]any
	nullUnions := map[string]bool{}
	if c.unionDefs != nil {
		unionDefs = make(map[string]any, len(c.unionDefs))
		for k, v := range c.unionDefs {
			unionDefs[k] = CloneJSONValue(v)
		}
		for k, v := range c.nullUnions {
			nullUnions[k] = v
		}
		if !reflect.DeepEqual(compOrder, c.componentOrder) {
			if _, ok := unionDefs["anyComponent"]; ok {
				unionDefs["anyComponent"] = nil
				delete(nullUnions, "anyComponent")
			}
		}
		if !reflect.DeepEqual(fnOrder, c.functionOrder) {
			if _, ok := unionDefs["anyFunction"]; ok {
				unionDefs["anyFunction"] = nil
				delete(nullUnions, "anyFunction")
			}
		}
	}

	var newDefs map[string]any
	if hasExplicitDefs {
		newDefs = make(map[string]any, len(explicitDefs))
		for k, v := range explicitDefs {
			newDefs[k] = CloneJSONValue(v)
		}
	} else {
		oldRoots := c.documentRoots()
		oldReachable := reachableLocalDefs(oldRoots, c.defs)
		var newRoots []any
		for _, comp := range comps {
			newRoots = append(newRoots, comp.Schema)
		}
		for _, fn := range fns {
			newRoots = append(newRoots, fn.Schema)
		}
		for _, hDef := range hoistedDefs {
			newRoots = append(newRoots, hDef)
		}
		if len(theme) > 0 {
			newRoots = append(newRoots, theme)
		}
		for _, ex := range c.extras {
			newRoots = append(newRoots, ex)
		}
		for _, u := range unionDefs {
			if u != nil {
				newRoots = append(newRoots, u)
			}
		}
		for name, defSchema := range c.defs {
			if !oldReachable[name] {
				newRoots = append(newRoots, defSchema)
			}
		}
		newReachable := reachableLocalDefs(newRoots, c.defs)
		newDefs = map[string]any{}
		for name, defSchema := range c.defs {
			if !oldReachable[name] || newReachable[name] {
				newDefs[name] = CloneJSONValue(defSchema)
			}
		}
		for name, defSchema := range hoistedDefs {
			newDefs[name] = CloneJSONValue(defSchema)
		}
	}

	rawPVer := c.rawProtocolVersion
	declaresPVer := c.declaresProtocolVersion
	if pVer != c.protocolVersion {
		rawPVer = pVer.WireVersion()
		if pVer == Version1_0 {
			rawPVer = "1.0"
		}
		declaresPVer = true
	}

	var newKeyOrder map[string][]string
	if len(c.keyOrder) > 0 {
		newKeyOrder = make(map[string][]string, len(c.keyOrder))
		for k, v := range c.keyOrder {
			newKeyOrder[k] = append([]string(nil), v...)
		}
		newKeyOrder["/components"] = append([]string(nil), compOrder...)
		newKeyOrder["/functions"] = append([]string(nil), fnOrder...)
	}

	var themeCopy map[string]any
	if len(theme) > 0 {
		themeCopy, _ = CloneJSONValue(theme).(map[string]any)
	}
	extrasCopy, _ := CloneJSONValue(c.extras).(map[string]any)

	out := &Catalog{
		catalogID:               catID,
		protocolVersion:         pVer,
		rawProtocolVersion:      rawPVer,
		declaresProtocolVersion: declaresPVer,
		declaresCatalogID:       declaresCatID,
		declaresComponents:      c.declaresComponents,
		declaresDefs:            c.declaresDefs,
		schemaDialect:           c.schemaDialect,
		schemaID:                schemaID,
		title:                   title,
		hasTitle:                hasTitle,
		description:             desc,
		hasDescription:          hasDesc,
		instructions:            instr,
		hasInstructions:         hasInstr,
		themeSchema:             themeCopy,
		themeLocation:           c.themeLocation,
		functionsForm:           c.functionsForm,
		unionDefs:               unionDefs,
		nullUnions:              nullUnions,
		defs:                    newDefs,
		extras:                  extrasCopy,
		keyOrder:                newKeyOrder,
		components:              comps,
		componentOrder:          compOrder,
		functions:               fns,
		functionOrder:           fnOrder,
		agentFunctions:          agentFns,
	}
	out.rawDoc = out.buildDocument()
	return out
}

func (c *Catalog) documentRoots() []any {
	fnSnap := c.snapshotFunctions()
	var roots []any
	for _, comp := range c.components {
		roots = append(roots, comp.Schema)
	}
	for _, fn := range fnSnap {
		roots = append(roots, fn.Schema)
	}
	if len(c.themeSchema) > 0 {
		roots = append(roots, c.themeSchema)
	}
	for _, v := range c.extras {
		roots = append(roots, v)
	}
	for _, u := range c.unionDefs {
		if u != nil {
			roots = append(roots, u)
		}
	}
	return roots
}

func reachableLocalDefs(roots []any, defs map[string]any) map[string]bool {
	reached := map[string]bool{}
	var queue []string
	for _, r := range roots {
		refs := map[string]bool{}
		collectCatalogLocalDefRefs(r, refs)
		for k := range refs {
			queue = append(queue, k)
		}
	}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if reached[cur] {
			continue
		}
		if defSchema, ok := defs[cur]; ok {
			reached[cur] = true
			refs := map[string]bool{}
			collectCatalogLocalDefRefs(defSchema, refs)
			for k := range refs {
				queue = append(queue, k)
			}
		}
	}
	return reached
}

func collectCatalogLocalDefRefs(node any, out map[string]bool) {
	switch typed := node.(type) {
	case []any:
		for _, item := range typed {
			collectCatalogLocalDefRefs(item, out)
		}
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok {
			ptr := ref
			if !strings.HasPrefix(ptr, "#") {
				parts := strings.SplitN(ptr, "#", 2)
				if len(parts) == 2 && strings.HasSuffix(parts[0], "catalog.json") {
					ptr = "#" + parts[1]
				}
			}
			if strings.HasPrefix(ptr, "#/$defs/") {
				seg := strings.Split(ptr[len("#/$defs/"):], "/")[0]
				out[unescapeJSONPointerToken(seg)] = true
			}
		}
		for _, v := range typed {
			collectCatalogLocalDefRefs(v, out)
		}
	}
}
