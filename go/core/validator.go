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
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/a2ui-project/a2ui/go/core/internal/schemaengine"
)

// MaxComponentGraphDepth is the maximum allowed component nesting depth.
const MaxComponentGraphDepth = 50

// MaxFunctionCallDepth is the maximum allowed nested function call depth.
const MaxFunctionCallDepth = 5

// MaxFunctionCallArgs is the maximum allowed number of arguments in a function call.
const MaxFunctionCallArgs = 1000

var relaxedPathPattern = regexp.MustCompile(`^(?:(?:/(?:[^~/]|~[01])*)*|(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])*)*)$`)

// ValidationConfig controls structural and schema validation strictness.
type ValidationConfig struct {
	RootID                  string
	AllowOrphanComponents   bool
	AllowDanglingReferences bool
	AllowMissingRoot        bool
	AllowUnknownElements    bool
	AllowedMessages         []string
	MaxDepth                int
}

// StrictValidation returns the default strict ValidationConfig.
func StrictValidation() ValidationConfig {
	return ValidationConfig{RootID: "root"}
}

// RelaxedValidation returns a permissive ValidationConfig suitable for progressive buffering.
func RelaxedValidation() ValidationConfig {
	return ValidationConfig{
		RootID:                  "root",
		AllowOrphanComponents:   true,
		AllowDanglingReferences: true,
		AllowMissingRoot:        true,
		AllowUnknownElements:    true,
	}
}

type compiledFunctionArgs struct {
	paramSchema map[string]any
	compiled    *jsonschema.Schema
}

type catalogCompiledCache struct {
	mu         sync.RWMutex
	components map[string]*jsonschema.Schema
	functions  map[string]compiledFunctionArgs
}

func newCatalogCompiledCache() *catalogCompiledCache {
	return &catalogCompiledCache{
		components: map[string]*jsonschema.Schema{},
		functions:  map[string]compiledFunctionArgs{},
	}
}

// getCompiledCache returns the compiled-schema cache stored on cat, so that the cache
// is released together with the catalog instead of being retained by a global map.
func getCompiledCache(cat *Catalog) *catalogCompiledCache {
	if cat == nil {
		return newCatalogCompiledCache()
	}
	cat.compiledOnce.Do(func() {
		cat.compiled = newCatalogCompiledCache()
	})
	return cat.compiled
}

var commonTypesCompilers sync.Map // map[ProtocolVersion]*jsonschema.Compiler

func getCommonTypesCompiler(version ProtocolVersion) (*jsonschema.Compiler, string, error) {
	norm, err := ToProtocolVersion(string(version))
	if err != nil {
		return nil, "", err
	}
	commonMap, err := CommonTypesSchemaMap(norm)
	if err != nil {
		return nil, "", err
	}
	baseURL := "https://a2ui.org/specification/v0_9/common_types.json"
	catURL := "https://a2ui.org/specification/v0_9/catalog.json"
	var placeholder map[string]any
	if norm == Version1_0 {
		baseURL = "https://a2ui.org/specification/v1_0/common_types.json"
		catURL = "https://a2ui.org/specification/v1_0/catalog.json"
		placeholder = map[string]any{
			"$schema": jsonSchemaDraft202012,
			"$defs": map[string]any{
				"anyComponent": map[string]any{"type": "object", "additionalProperties": true},
				"anyFunction": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"@call": map[string]any{"not": map[string]any{"pattern": "^@"}},
						"args":  map[string]any{"type": "object"},
					},
				},
			},
		}
	} else {
		placeholder = map[string]any{
			"$schema": jsonSchemaDraft202012,
			"$defs": map[string]any{
				"anyComponent": map[string]any{"type": "object", "additionalProperties": true},
				"anyFunction": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"call":       map[string]any{},
						"args":       map[string]any{},
						"returnType": map[string]any{},
					},
				},
			},
		}
	}
	if cached, ok := commonTypesCompilers.Load(norm); ok {
		return cached.(*jsonschema.Compiler), baseURL, nil
	}
	c := schemaengine.NewCompiler(map[string]any{
		baseURL: commonMap,
		catURL:  placeholder,
	})
	actual, _ := commonTypesCompilers.LoadOrStore(norm, c)
	return actual.(*jsonschema.Compiler), baseURL, nil
}

var (
	commonTypesCompilerMu sync.Mutex
	commonTypesSchemas    sync.Map // map[string]*jsonschema.Schema
)

// ValidateCommonType validates val against #/$defs/<defName> of version's canonical common_types.json.
func ValidateCommonType(version ProtocolVersion, defName string, val any) error {
	norm, err := ToProtocolVersion(string(version))
	if err != nil {
		return err
	}
	cacheKey := string(norm) + "::" + defName
	var s *jsonschema.Schema
	if cached, ok := commonTypesSchemas.Load(cacheKey); ok {
		s = cached.(*jsonschema.Schema)
	} else {
		commonTypesCompilerMu.Lock()
		comp, baseURL, cErr := getCommonTypesCompiler(norm)
		if cErr != nil {
			commonTypesCompilerMu.Unlock()
			return cErr
		}
		compiled, cErr := comp.Compile(baseURL + "#/$defs/" + escapeJSONPointerToken(defName))
		commonTypesCompilerMu.Unlock()
		if cErr != nil {
			return NewCatalogErrorf("unknown common_types definition %q for %s: %v", defName, version, cErr)
		}
		actual, _ := commonTypesSchemas.LoadOrStore(cacheKey, compiled)
		s = actual.(*jsonschema.Schema)
	}
	if vErr := s.Validate(schemaengine.NormalizeJSON(val)); vErr != nil {
		issues := schemaengine.ExtractIssues(vErr)
		var details []ErrorDetail
		for _, iss := range issues {
			details = append(details, ErrorDetail{
				Path:    strings.Join(iss.Location, "."),
				Code:    iss.Code,
				Message: iss.Message,
			})
		}
		return NewValidationError(vErr.Error(), details...)
	}
	return nil
}

// PayloadValidator validates components and function calls against a Catalog's JSON Schemas.
type PayloadValidator struct {
	Catalog   *Catalog
	Config    ValidationConfig
	hasConfig bool
}

// NewPayloadValidator creates a PayloadValidator for catalog and config.
func NewPayloadValidator(catalog *Catalog, config *ValidationConfig) *PayloadValidator {
	cfg := StrictValidation()
	hasCfg := false
	if config != nil {
		hasCfg = true
		cfg = *config
		if cfg.RootID == "" {
			cfg.RootID = "root"
		}
	}
	return &PayloadValidator{Catalog: catalog, Config: cfg, hasConfig: hasCfg}
}

// ValidateComponent validates a raw component map against the catalog's schema.
func (v *PayloadValidator) ValidateComponent(comp map[string]any, surfaceID string) error {
	return v.ValidateComponentAtIndex(comp, nil, surfaceID)
}

// ValidateComponentAtIndex validates a component map and reports array-indexed JSON Pointers when index != nil.
func (v *PayloadValidator) ValidateComponentAtIndex(comp map[string]any, index *int, surfaceID string) error {
	if comp == nil {
		err := NewValidationError("Component must be an object", ErrorDetail{
			Path:      "components",
			Code:      "type_mismatch",
			Message:   "Component must be an object",
			SurfaceID: surfaceID,
		})
		err.Path = "/components"
		err.SurfaceID = surfaceID
		return err
	}

	allowUnknown := v.hasConfig && v.Config.AllowUnknownElements
	var pVer ProtocolVersion
	if v.Catalog != nil {
		pVer = v.Catalog.ProtocolVersion()
	}
	atLeastV10 := pVer != "" && IsAtLeastVersion(string(pVer), Version1_0)

	compID, _ := comp["id"].(string)
	compIDOrUnknown := compID
	if compIDOrUnknown == "" {
		compIDOrUnknown = "unknown"
	}
	compType, hasCompTypeStr := comp["component"].(string)

	var errors []ErrorDetail
	if compID != "" && atLeastV10 && !IsValidUAX31Identifier(compID) {
		errors = append(errors, ErrorDetail{
			Path:      fmt.Sprintf("components.%s.id", compID),
			Code:      "invalid_identifier",
			Message:   fmt.Sprintf("Component id '%s' must be a valid UAX #31 identifier", compID),
			SurfaceID: surfaceID,
		})
	}
	if compType != "" && atLeastV10 && !IsValidUAX31Identifier(compType) {
		errors = append(errors, ErrorDetail{
			Path:      fmt.Sprintf("components.%s.component", compIDOrUnknown),
			Code:      "invalid_identifier",
			Message:   fmt.Sprintf("Component type '%s' must be a valid UAX #31 identifier", compType),
			SurfaceID: surfaceID,
		})
	}
	if compType == "Surface" && atLeastV10 {
		errors = append(errors, ErrorDetail{
			Path:      fmt.Sprintf("components.%s.component", compIDOrUnknown),
			Code:      "invalid_value",
			Message:   "Component type 'Surface' is reserved",
			SurfaceID: surfaceID,
		})
	}

	var targetComp *ComponentAPI
	if v.Catalog != nil && hasCompTypeStr {
		if api, ok := v.Catalog.components[compType]; ok {
			targetComp = &api
		}
	}

	customProps := getCustomEnvelopeProperties(v.Catalog, compType, atLeastV10)
	var compCatalogID any
	var protoCatKey string
	hasCompCatalogID := false
	if atLeastV10 {
		if val, ok := comp["@catalogId"]; ok {
			compCatalogID = val
			protoCatKey = "@catalogId"
			hasCompCatalogID = true
		} else if val, ok := comp["catalogId"]; ok && !customProps["catalogId"] {
			compCatalogID = val
			protoCatKey = "catalogId"
			hasCompCatalogID = true
		}
	}

	if targetComp == nil {
		if !allowUnknown {
			errors = append(errors, ErrorDetail{
				Path:      fmt.Sprintf("components.%s.component", compIDOrUnknown),
				Code:      "unrecognized_component",
				Message:   fmt.Sprintf("Unrecognized component type '%v'", comp["component"]),
				SurfaceID: surfaceID,
			})
		}
		v.validateNestedFunctions(compIDOrUnknown, compCatalogID, hasCompCatalogID, comp, "", &errors, customProps)
		if len(errors) > 0 {
			return raiseComponentValidationErrors(errors, compID, index, surfaceID)
		}
		return nil
	}

	compForSchema := make(map[string]any, len(comp))
	for k, val := range comp {
		compForSchema[k] = val
	}

	if !atLeastV10 {
		declared := getDeclaredComponentProperties(v.Catalog, compType)
		for _, atKey := range []string{"@metadata", "@catalogId", "@accessibility", "@checks"} {
			if _, present := comp[atKey]; present && !declared[atKey] {
				delete(compForSchema, atKey)
				if !allowUnknown {
					errors = append(errors, ErrorDetail{
						Path:      fmt.Sprintf("components.%s.%s", compIDOrUnknown, atKey),
						Code:      "extra_field",
						Message:   fmt.Sprintf("Additional properties are not allowed ('%s' was unexpected)", atKey),
						SurfaceID: surfaceID,
					})
				}
			}
		}
	} else {
		isCheckable := isComponentCheckable(v.Catalog, compType)
		for _, pair := range [][2]string{
			{"metadata", "@metadata"},
			{"catalogId", "@catalogId"},
			{"accessibility", "@accessibility"},
			{"checks", "@checks"},
		} {
			bareKey, atKey := pair[0], pair[1]
			if hasKey(comp, atKey) && hasKey(comp, bareKey) && !customProps[bareKey] {
				errors = append(errors, ErrorDetail{
					Path:      fmt.Sprintf("components.%s.%s", compIDOrUnknown, atKey),
					Code:      "conflicting_properties",
					Message:   fmt.Sprintf("Component '%s' cannot specify both '%s' and legacy '%s'.", compID, atKey, bareKey),
					SurfaceID: surfaceID,
				})
			}
		}
		if protoCatKey != "" {
			if _, ok := compCatalogID.(string); !ok {
				errors = append(errors, ErrorDetail{
					Path:      fmt.Sprintf("components.%s.%s", compIDOrUnknown, protoCatKey),
					Code:      "type_mismatch",
					Message:   fmt.Sprintf("'%s' must be a string", protoCatKey),
					SurfaceID: surfaceID,
				})
			}
		}
		protoMetaKey := ""
		if hasKey(comp, "@metadata") {
			protoMetaKey = "@metadata"
		} else if hasKey(comp, "metadata") && !customProps["metadata"] {
			protoMetaKey = "metadata"
		}
		if protoMetaKey != "" {
			rawMeta := comp[protoMetaKey]
			metaMap, isMap := rawMeta.(map[string]any)
			if !isMap {
				errors = append(errors, ErrorDetail{
					Path:      fmt.Sprintf("components.%s.%s", compIDOrUnknown, protoMetaKey),
					Code:      "type_mismatch",
					Message:   fmt.Sprintf("'%s' must be an object", protoMetaKey),
					SurfaceID: surfaceID,
				})
			} else if err := ValidateMetadata(metaMap, Version1_0); err != nil {
				metaPath := fmt.Sprintf("components.%s.%s", compIDOrUnknown, protoMetaKey)
				if strings.Contains(err.Error(), "extension") {
					metaPath += ".extensions"
				}
				errors = append(errors, ErrorDetail{
					Path:      metaPath,
					Code:      "invalid_metadata",
					Message:   err.Error(),
					SurfaceID: surfaceID,
				})
			}
		}

		protoA11yKey := ""
		if hasKey(comp, "@accessibility") {
			protoA11yKey = "@accessibility"
		} else if hasKey(comp, "accessibility") && !customProps["accessibility"] {
			protoA11yKey = "accessibility"
		}
		if protoA11yKey != "" {
			if err := ValidateCommonType(Version1_0, "AccessibilityAttributes", comp[protoA11yKey]); err != nil {
				if ve, ok := err.(*ValidationError); ok {
					for _, d := range ve.Details {
						if allowUnknown && d.Code == "extra_field" {
							continue
						}
						p := fmt.Sprintf("components.%s.%s", compIDOrUnknown, protoA11yKey)
						if d.Path != "" {
							p += "." + d.Path
						}
						errors = append(errors, ErrorDetail{Path: p, Code: d.Code, Message: d.Message, SurfaceID: surfaceID})
					}
				}
			}
		}

		protoChecksKey := ""
		if hasKey(comp, "@checks") {
			protoChecksKey = "@checks"
		} else if hasKey(comp, "checks") && !customProps["checks"] {
			protoChecksKey = "checks"
		}
		if protoChecksKey != "" {
			if !isCheckable {
				if !allowUnknown {
					errors = append(errors, ErrorDetail{
						Path:      fmt.Sprintf("components.%s.%s", compIDOrUnknown, protoChecksKey),
						Code:      "extra_field",
						Message:   fmt.Sprintf("Additional properties are not allowed ('%s' was unexpected)", protoChecksKey),
						SurfaceID: surfaceID,
					})
				}
			} else {
				// The v1.0 Checkable mixin declares the rules under @checks, whichever key
				// the component used.
				if err := ValidateCommonType(Version1_0, "Checkable", map[string]any{"@checks": comp[protoChecksKey]}); err != nil {
					if ve, ok := err.(*ValidationError); ok {
						for _, d := range ve.Details {
							if allowUnknown && d.Code == "extra_field" {
								continue
							}
							sub := strings.TrimPrefix(d.Path, "@checks")
							sub = strings.TrimPrefix(sub, ".")
							p := fmt.Sprintf("components.%s.%s", compIDOrUnknown, protoChecksKey)
							if sub != "" {
								p += "." + sub
							}
							errors = append(errors, ErrorDetail{Path: p, Code: d.Code, Message: d.Message, SurfaceID: surfaceID})
						}
					}
				}
			}
		}

		for _, atKey := range []string{"@metadata", "@catalogId", "@accessibility", "@checks"} {
			delete(compForSchema, atKey)
		}
		for _, bareKey := range []string{"metadata", "catalogId", "accessibility", "checks"} {
			if !customProps[bareKey] {
				delete(compForSchema, bareKey)
			}
		}
	}

	compiled, compErr := v.compileComponentSchema(compType, atLeastV10)
	if compErr != nil {
		errors = append(errors, ErrorDetail{
			Path:      fmt.Sprintf("components.%s", compIDOrUnknown),
			Code:      "invalid_reference",
			Message:   compErr.Error(),
			SurfaceID: surfaceID,
		})
	} else if compiled != nil {
		// Strip envelope keys if the component schema itself doesn't declare them.
		compSchemaMap := v.Catalog.validationSchema()
		var targetSchemaMap map[string]any
		if cm, ok := compSchemaMap["components"].(map[string]any); ok {
			targetSchemaMap, _ = cm[compType].(map[string]any)
		}
		propsToCheck := make(map[string]any, len(compForSchema))
		for k, val := range compForSchema {
			propsToCheck[k] = val
		}
		if targetSchemaMap != nil {
			reqSlice, _ := toStringSlice(targetSchemaMap["required"])
			envKeys := componentEnvelopeKeysFor(atLeastV10)
			if v.Catalog.ProtocolVersion() == Version0_8 {
				// A v0.8 component instance is {"id", "weight", "component": {"<Type>": {...}}}:
				// weight belongs to the instance wrapper (server_to_client.json), not to the
				// component's properties, so a catalog schema that closes its properties must
				// not see it.
				envKeys = append(envKeys, "weight")
			}
			for _, envKey := range envKeys {
				if !hasKey(propsToCheck, envKey) {
					continue
				}
				if schemaDeclaresProperty(targetSchemaMap, envKey) || containsString(reqSlice, envKey) {
					continue
				}
				val := propsToCheck[envKey]
				delete(propsToCheck, envKey)
				if envKey == "catalogId" {
					if _, isStr := val.(string); !isStr {
						errors = append(errors, ErrorDetail{
							Path:      fmt.Sprintf("components.%s.catalogId", compIDOrUnknown),
							Code:      "type_mismatch",
							Message:   "'catalogId' must be a string",
							SurfaceID: surfaceID,
						})
					}
				}
			}
		}

		if sErr := compiled.Validate(schemaengine.NormalizeJSON(propsToCheck)); sErr != nil {
			for _, iss := range schemaengine.ExtractIssues(sErr) {
				if allowUnknown && iss.IsUnknownProp {
					continue
				}
				p := fmt.Sprintf("components.%s", compIDOrUnknown)
				if len(iss.Location) > 0 {
					p += "." + strings.Join(iss.Location, ".")
				}
				errors = append(errors, ErrorDetail{
					Path:      p,
					Code:      iss.Code,
					Message:   iss.Message,
					SurfaceID: surfaceID,
				})
			}
		}
	}

	v.validateNestedFunctions(compIDOrUnknown, compCatalogID, hasCompCatalogID, comp, "", &errors, customProps)

	if len(errors) > 0 {
		return raiseComponentValidationErrors(errors, compID, index, surfaceID)
	}
	return nil
}

func (v *PayloadValidator) compileComponentSchema(compType string, atLeastV10 bool) (*jsonschema.Schema, error) {
	if v.Catalog == nil {
		return nil, nil
	}
	cache := getCompiledCache(v.Catalog)
	cache.mu.RLock()
	if s, ok := cache.components[compType]; ok {
		cache.mu.RUnlock()
		return s, nil
	}
	cache.mu.RUnlock()

	valSchema := v.Catalog.validationSchema()
	compsMap, _ := valSchema["components"].(map[string]any)
	compSchema, ok := compsMap[compType].(map[string]any)
	if !ok || compSchema == nil {
		return nil, nil
	}

	defs := map[string]any{}
	if baseDefs, ok := valSchema["$defs"].(map[string]any); ok {
		for k, item := range baseDefs {
			defs[k] = CloneJSONValue(item)
		}
	}
	if atLeastV10 {
		// Replace FunctionCall with envelope-only check so cross-catalog nested calls aren't rejected by this catalog's anyFunction union;
		// validateNestedFunctions checks calls against the catalog they actually run in.
		defs["FunctionCall"] = v10FunctionCallEnvelopeSchema()
	} else if catID := v.Catalog.CatalogID(); catID != "" {
		if anyFn, ok := defs["anyFunction"].(map[string]any); ok {
			var declared []any
			if oneOf, ok := anyFn["oneOf"].([]any); ok {
				declared = append(declared, oneOf...)
			}
			declared = append(declared, map[string]any{
				"type": "object",
				"properties": map[string]any{
					"catalogId": map[string]any{"not": map[string]any{"const": catID}},
					"args":      map[string]any{"type": "object"},
				},
				"required": []any{"catalogId"},
			})
			defs["anyFunction"] = map[string]any{"oneOf": declared}
		}
	}

	full := map[string]any{
		"$schema": jsonSchemaDraft202012,
		"$defs":   defs,
	}
	for k, item := range compSchema {
		if k != "$defs" {
			full[k] = CloneJSONValue(item)
		}
	}
	if atLeastV10 && !hasKey(full, "unevaluatedProperties") && !hasKey(full, "additionalProperties") {
		full["unevaluatedProperties"] = false
	}
	if fns, ok := valSchema["functions"]; ok && !hasKey(full, "functions") {
		full["functions"] = fns
	}
	if cm, ok := valSchema["components"]; ok && !hasKey(full, "components") {
		full["components"] = cm
	}

	compiled, err := schemaengine.CompileInline("https://a2ui.org/inline/component/target.json", full, nil)
	if err != nil {
		return nil, err
	}
	cache.mu.Lock()
	cache.components[compType] = compiled
	cache.mu.Unlock()
	return compiled, nil
}

func v10FunctionCallEnvelopeSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"@call":     map[string]any{"type": "string"},
			"catalogId": map[string]any{"type": "string"},
			"args":      map[string]any{"type": "object"},
		},
		"required":             []any{"@call"},
		"additionalProperties": false,
	}
}

func (v *PayloadValidator) validateNestedFunctions(
	compID string,
	compCatalogID any,
	hasCompCatalogID bool,
	val any,
	path string,
	errors *[]ErrorDetail,
	customProps map[string]bool,
) {
	var pVer ProtocolVersion
	if v.Catalog != nil {
		pVer = v.Catalog.ProtocolVersion()
	}
	atLeastV10 := pVer != "" && IsAtLeastVersion(string(pVer), Version1_0)

	switch typed := val.(type) {
	case map[string]any:
		callPath := "components." + compID
		if path != "" {
			callPath += "." + path
		}
		if atLeastV10 {
			var keys []string
			for k := range typed {
				if path == "" && (k == "@metadata" || k == "@catalogId" || k == "@accessibility" || k == "@checks") {
					continue
				}
				keys = append(keys, k)
			}
			sort.Strings(keys)
			if err := validateReservedDirectives(keys, pVer); err != nil {
				*errors = append(*errors, ErrorDetail{
					Path:    callPath,
					Code:    "INVALID_RESERVED_KEY",
					Message: err.Error(),
				})
			}
		}

		var fnName string
		hasFnName := false
		if atLeastV10 {
			fnName, hasFnName = typed["@call"].(string)
		} else {
			if s, ok := typed["call"].(string); ok && s != "" {
				fnName, hasFnName = s, true
			} else if s, ok := typed["function"].(string); ok && s != "" {
				fnName, hasFnName = s, true
			}
		}
		if hasFnName {
			v.validateNestedCall(fnName, typed, callPath, hasCompCatalogID, atLeastV10, pVer, errors)
		}

		keys := make([]string, 0, len(typed))
		for k := range typed {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if k == "id" || k == "component" {
				continue
			}
			if path == "" && atLeastV10 {
				if k == "@catalogId" || k == "@metadata" {
					continue
				}
				if k == "catalogId" && !customProps["catalogId"] {
					continue
				}
				if k == "metadata" && !customProps["metadata"] {
					continue
				}
			}
			childPath := k
			if path != "" {
				childPath = path + "." + k
			}
			v.validateNestedFunctions(compID, compCatalogID, hasCompCatalogID, typed[k], childPath, errors, customProps)
		}
	case []any:
		for idx, item := range typed {
			childPath := fmt.Sprintf("%d", idx)
			if path != "" {
				childPath = fmt.Sprintf("%s.%d", path, idx)
			}
			v.validateNestedFunctions(compID, compCatalogID, hasCompCatalogID, item, childPath, errors, customProps)
		}
	}
}

func (v *PayloadValidator) validateNestedCall(
	fnName string,
	call map[string]any,
	callPath string,
	hasCompCatalogID bool,
	atLeastV10 bool,
	pVer ProtocolVersion,
	errors *[]ErrorDetail,
) {
	fnArgs, hasArgs := call["args"]
	if !hasArgs {
		fnArgs = nil
	}
	if atLeastV10 && strings.HasPrefix(fnName, "@") {
		if hasKey(call, "catalogId") {
			*errors = append(*errors, ErrorDetail{
				Path:    callPath + ".catalogId",
				Code:    "extra_field",
				Message: fmt.Sprintf("System function '%s' belongs to no catalog and must not name a catalogId", fnName),
			})
		}
		var cfgPtr *ValidationConfig
		if v.hasConfig {
			c := v.Config
			cfgPtr = &c
		}
		if _, err := validateSystemFunction(fnName, fnArgs, pVer, cfgPtr); err != nil {
			if ve, ok := err.(*ValidationError); ok {
				*errors = append(*errors, rebaseFunctionErrorDetails(ve, fnName, callPath, "invalid_function_call")...)
			}
		}
		return
	}

	fullCheck := true
	if atLeastV10 {
		rawCatID, hasCat := call["catalogId"]
		if hasCat && rawCatID != nil {
			catStr, ok := rawCatID.(string)
			if !ok {
				*errors = append(*errors, ErrorDetail{
					Path:    callPath + ".catalogId",
					Code:    "type_mismatch",
					Message: "'catalogId' must be a string",
				})
				fullCheck = false
			} else {
				var ownID string
				if v.Catalog != nil {
					ownID = v.Catalog.CatalogID()
				}
				fullCheck = (catStr == ownID)
			}
		} else if hasCat && rawCatID == nil {
			*errors = append(*errors, ErrorDetail{
				Path:    callPath + ".catalogId",
				Code:    "type_mismatch",
				Message: "'catalogId' must be a string",
			})
			fullCheck = false
		} else {
			fullCheck = !hasCompCatalogID
		}
	}

	var checkErr error
	if fullCheck {
		checkErr = checkRendererMayCall(v.Catalog, fnName)
		if checkErr == nil {
			_, checkErr = v.ValidateFunctionArgs(fnName, fnArgs)
		}
	} else {
		checkErr = v.validateFunctionIdentifiers(fnName, fnArgs)
	}
	if checkErr != nil {
		if ve, ok := checkErr.(*ValidationError); ok {
			fb := "invalid_function_call"
			if !fullCheck {
				fb = "invalid_identifier"
			}
			*errors = append(*errors, rebaseFunctionErrorDetails(ve, fnName, callPath, fb)...)
		}
	}
}

func checkRendererMayCall(cat *Catalog, name string) error {
	if cat == nil || !IsAtLeastVersion(string(cat.ProtocolVersion()), Version1_0) {
		return nil
	}
	fn, ok := lookupCatalogFunction(cat, name)
	if !ok || fn.AllowedCallers != AllowedCallersAgentOnly {
		return nil
	}
	msg := fmt.Sprintf("Function '%s' cannot be called by renderer (allowedCallers is agentOnly).", name)
	return NewValidationError(msg, ErrorDetail{
		Path:    "functions." + name,
		Code:    "invalid_function_call",
		Message: msg,
	})
}

func lookupCatalogFunction(cat *Catalog, name string) (FunctionAPI, bool) {
	if cat == nil || name == "" {
		return FunctionAPI{}, false
	}
	fns := cat.snapshotFunctions()
	if f, ok := fns[name]; ok {
		return f, true
	}
	lowerFirst := strings.ToLower(name[:1]) + name[1:]
	if f, ok := fns[lowerFirst]; ok {
		return f, true
	}
	upperFirst := strings.ToUpper(name[:1]) + name[1:]
	if f, ok := fns[upperFirst]; ok {
		return f, true
	}
	return FunctionAPI{}, false
}

// ValidateFunction validates a wire FunctionCall map against the catalog's schema.
func (v *PayloadValidator) ValidateFunction(fnCall map[string]any) error {
	if fnCall == nil {
		return NewValidationError("Function call must be an object")
	}
	var pVer ProtocolVersion
	if v.Catalog != nil {
		pVer = v.Catalog.ProtocolVersion()
	}
	atLeastV10 := pVer != "" && IsAtLeastVersion(string(pVer), Version1_0)
	var name string
	if atLeastV10 {
		name, _ = fnCall["@call"].(string)
	} else {
		name, _ = fnCall["call"].(string)
	}
	_, err := v.ValidateFunctionArgs(name, fnCall["args"])
	return err
}

func (v *PayloadValidator) validateFunctionIdentifiers(name string, args any) error {
	if v.Catalog == nil || !IsAtLeastVersion(string(v.Catalog.ProtocolVersion()), Version1_0) {
		return nil
	}
	checkName := strings.TrimPrefix(name, "@")
	if !IsValidUAX31Identifier(checkName) {
		msg := fmt.Sprintf("Function name '%s' must be a valid UAX #31 identifier", name)
		return NewValidationError(msg, ErrorDetail{
			Path:    "functions." + name,
			Code:    "invalid_identifier",
			Message: msg,
		})
	}
	if args != nil {
		argsMap, ok := args.(map[string]any)
		if !ok {
			return nonObjectArgsError(name)
		}
		for argName := range argsMap {
			if !IsValidUAX31Identifier(argName) {
				msg := fmt.Sprintf("Function argument '%s' in function '%s' must be a valid UAX #31 identifier", argName, name)
				return NewValidationError(msg, ErrorDetail{
					Path:    fmt.Sprintf("functions.%s.%s", name, argName),
					Code:    "invalid_identifier",
					Message: msg,
				})
			}
		}
	}
	return nil
}

func nonObjectArgsError(name string) *ValidationError {
	msg := fmt.Sprintf("Function arguments for '%s' must be an object/dictionary", name)
	return NewValidationError(msg, ErrorDetail{
		Path:    "functions." + name,
		Code:    "type_mismatch",
		Message: msg,
	})
}

// ValidateFunctionArgs validates args for function name against the catalog and returns a copy with schema defaults applied.
func (v *PayloadValidator) ValidateFunctionArgs(name string, args any) (map[string]any, error) {
	allowUnknown := v.hasConfig && v.Config.AllowUnknownElements
	var normArgs map[string]any
	if args == nil {
		normArgs = map[string]any{}
	} else if m, ok := CloneJSONValue(args).(map[string]any); ok {
		normArgs = m
	} else if rv := reflect.ValueOf(args); rv.Kind() == reflect.Map && rv.Type().Key().Kind() == reflect.String && rv.IsNil() {
		normArgs = map[string]any{}
	} else {
		return nil, nonObjectArgsError(name)
	}

	if len(normArgs) > MaxFunctionCallArgs {
		msg := fmt.Sprintf("Function call '%s' exceeds maximum allowed arguments count (%d)", name, MaxFunctionCallArgs)
		return nil, NewValidationError(msg, ErrorDetail{
			Path:    "functions." + name,
			Code:    "too_many_arguments",
			Message: msg,
		})
	}

	if err := v.validateFunctionIdentifiers(name, normArgs); err != nil {
		return nil, err
	}

	if strings.HasPrefix(name, "@") {
		pVer := Version1_0
		if v.Catalog != nil && v.Catalog.ProtocolVersion() != "" {
			pVer = v.Catalog.ProtocolVersion()
		}
		var cfgPtr *ValidationConfig
		if v.hasConfig {
			c := v.Config
			cfgPtr = &c
		}
		return validateSystemFunctionDirect(name, normArgs, pVer, cfgPtr)
	}

	fnAPI, found := lookupCatalogFunction(v.Catalog, name)
	if !found {
		if !allowUnknown {
			msg := fmt.Sprintf("Unrecognized function '%s'", name)
			return nil, NewValidationError(msg, ErrorDetail{
				Path:    "functions." + name,
				Code:    "unrecognized_function",
				Message: msg,
			})
		}
		return normArgs, nil
	}

	paramSchema, compiled, err := v.compileFunctionArgsSchema(fnAPI.Name)
	if err != nil {
		return nil, NewValidationError(err.Error(), ErrorDetail{
			Path:    "functions." + name,
			Code:    "invalid_reference",
			Message: err.Error(),
		})
	}
	if compiled != nil {
		if sErr := compiled.Validate(schemaengine.NormalizeJSON(normArgs)); sErr != nil {
			var fnErrors []ErrorDetail
			for _, iss := range schemaengine.ExtractIssues(sErr) {
				if allowUnknown && iss.IsUnknownProp {
					continue
				}
				p := "functions." + name
				if len(iss.Location) > 0 {
					p += "." + strings.Join(iss.Location, ".")
				}
				fnErrors = append(fnErrors, ErrorDetail{
					Path:    p,
					Code:    iss.Code,
					Message: iss.Message,
				})
			}
			if len(fnErrors) > 0 {
				var lines []string
				for _, d := range fnErrors {
					lines = append(lines, fmt.Sprintf("%s: %s", d.Path, d.Message))
				}
				return nil, NewValidationError(strings.Join(lines, "\n"), fnErrors...)
			}
		}
	}
	if paramSchema != nil {
		defs, _ := paramSchema["$defs"].(map[string]any)
		applyObjectDefaults(normArgs, paramSchema, defs, map[string]bool{})
	}
	return normArgs, nil
}

func (v *PayloadValidator) compileFunctionArgsSchema(fnName string) (map[string]any, *jsonschema.Schema, error) {
	if v.Catalog == nil {
		return nil, nil, nil
	}
	cache := getCompiledCache(v.Catalog)
	cache.mu.RLock()
	if entry, ok := cache.functions[fnName]; ok {
		cache.mu.RUnlock()
		return entry.paramSchema, entry.compiled, nil
	}
	cache.mu.RUnlock()

	valSchema := v.Catalog.validationSchema()
	fnsMap, _ := valSchema["functions"].(map[string]any)
	fnSchema, ok := fnsMap[fnName].(map[string]any)
	if !ok || fnSchema == nil {
		return nil, nil, nil
	}
	props, _ := fnSchema["properties"].(map[string]any)
	argsObj, ok := props["args"].(map[string]any)
	if !ok || argsObj == nil {
		return nil, nil, nil
	}

	defs := map[string]any{}
	if baseDefs, ok := valSchema["$defs"].(map[string]any); ok {
		for k, item := range baseDefs {
			defs[k] = CloneJSONValue(item)
		}
	}
	if IsAtLeastVersion(string(v.Catalog.ProtocolVersion()), Version1_0) {
		defs["FunctionCall"] = v10FunctionCallEnvelopeSchema()
	}

	full := map[string]any{
		"$schema": jsonSchemaDraft202012,
		"$defs":   defs,
	}
	for k, item := range argsObj {
		if k != "$defs" {
			full[k] = CloneJSONValue(item)
		}
	}
	// The validation schema closes every object args schema, but a call is validated against the args
	// as authored (as the reference SDK does), so unlisted arguments pass unless the author closed them.
	if fnAPI, found := v.Catalog.functionByName(fnName); found && fnAPI.Schema != nil {
		authoredArgs := extractAuthoredFunctionArgs(fnAPI.Schema)
		if !hasKey(authoredArgs, "additionalProperties") && !hasKey(authoredArgs, "unevaluatedProperties") {
			delete(full, "unevaluatedProperties")
		}
	}
	if fns, ok := valSchema["functions"]; ok && !hasKey(full, "functions") {
		full["functions"] = fns
	}
	if cm, ok := valSchema["components"]; ok && !hasKey(full, "components") {
		full["components"] = cm
	}

	compiled, err := schemaengine.CompileInline("https://a2ui.org/inline/function/target.json", full, nil)
	if err != nil {
		return nil, nil, err
	}
	cache.mu.Lock()
	cache.functions[fnName] = compiledFunctionArgs{paramSchema: full, compiled: compiled}
	cache.mu.Unlock()
	return full, compiled, nil
}

// ValidateTheme validates a surface theme map against the catalog's theme schema.
func (v *PayloadValidator) ValidateTheme(theme map[string]any) error {
	if theme == nil {
		return NewValidationError("Theme payload must be an object", ErrorDetail{
			Path:    "theme",
			Code:    "type_mismatch",
			Message: "Theme payload must be an object",
		})
	}
	if v.Catalog == nil {
		return nil
	}
	valSchema := v.Catalog.validationSchema()
	defs, _ := valSchema["$defs"].(map[string]any)
	themeSchema, ok := defs["theme"].(map[string]any)
	if !ok || len(themeSchema) == 0 {
		return nil
	}
	full := map[string]any{
		"$schema": jsonSchemaDraft202012,
		"$defs":   defs,
	}
	for k, item := range themeSchema {
		if k != "$defs" {
			full[k] = CloneJSONValue(item)
		}
	}
	compiled, err := schemaengine.CompileInline("https://a2ui.org/inline/theme.json", full, nil)
	if err != nil {
		return NewValidationError(err.Error(), ErrorDetail{Path: "theme", Code: "invalid_reference", Message: err.Error()})
	}
	if sErr := compiled.Validate(schemaengine.NormalizeJSON(theme)); sErr != nil {
		var details []ErrorDetail
		for _, iss := range schemaengine.ExtractIssues(sErr) {
			p := strings.Join(iss.Location, ".")
			if p == "" {
				p = "theme"
			}
			details = append(details, ErrorDetail{
				Path:    p,
				Code:    iss.Code,
				Message: iss.Message,
			})
		}
		errPtr := "/theme"
		if len(details) > 0 && details[0].Path != "theme" {
			errPtr = "/theme/" + strings.TrimPrefix(toJSONPointer(details[0].Path), "/")
		}
		var lines []string
		for _, d := range details {
			lines = append(lines, fmt.Sprintf("%s: %s", d.Path, d.Message))
		}
		ve := NewValidationError(strings.Join(lines, "\n"), details...)
		ve.Path = errPtr
		return ve
	}
	return nil
}

// validateSystemFunction validates a call to a reserved '@' system function (such as '@index' in v1.0).
func validateSystemFunction(name string, args any, version ProtocolVersion, cfg *ValidationConfig) (map[string]any, error) {
	return validateSystemFunctionDirect(name, args, version, cfg)
}

func validateSystemFunctionDirect(name string, args any, version ProtocolVersion, cfg *ValidationConfig) (map[string]any, error) {
	allowUnknown := cfg != nil && cfg.AllowUnknownElements
	var normArgs map[string]any
	if args == nil {
		normArgs = map[string]any{}
	} else if m, ok := args.(map[string]any); ok {
		normArgs, _ = CloneJSONValue(m).(map[string]any)
	} else {
		return nil, nonObjectArgsError(name)
	}

	if !IsAtLeastVersion(string(version), Version1_0) || name != "@index" {
		if allowUnknown {
			return normArgs, nil
		}
		msg := fmt.Sprintf("Unrecognized function '%s'", name)
		return nil, NewValidationError(msg, ErrorDetail{
			Path:    "functions." + name,
			Code:    "unrecognized_function",
			Message: msg,
		})
	}

	stdDefs := standardDefsForVersion(Version1_0)
	defsCopy, _ := CloneJSONValue(stdDefs).(map[string]any)
	defsCopy["FunctionCall"] = v10FunctionCallEnvelopeSchema()
	indexDef, _ := defsCopy["IndexSystemFunction"].(map[string]any)
	props, _ := indexDef["properties"].(map[string]any)
	argsSchema, _ := props["args"].(map[string]any)
	full := map[string]any{
		"$schema": jsonSchemaDraft202012,
		"$defs":   defsCopy,
	}
	for k, item := range argsSchema {
		full[k] = CloneJSONValue(item)
	}
	compiled, err := schemaengine.CompileInline("https://a2ui.org/inline/system/index.json", full, nil)
	if err != nil {
		return nil, NewValidationError(err.Error())
	}
	if sErr := compiled.Validate(schemaengine.NormalizeJSON(normArgs)); sErr != nil {
		var details []ErrorDetail
		for _, iss := range schemaengine.ExtractIssues(sErr) {
			if allowUnknown && iss.IsUnknownProp {
				continue
			}
			p := "functions." + name
			if len(iss.Location) > 0 {
				p += "." + strings.Join(iss.Location, ".")
			}
			details = append(details, ErrorDetail{
				Path:    p,
				Code:    iss.Code,
				Message: iss.Message,
			})
		}
		if len(details) > 0 {
			return nil, NewValidationError(details[0].Message, details...)
		}
	}
	applyObjectDefaults(normArgs, full, defsCopy, map[string]bool{})
	return normArgs, nil
}

// ValidateAndApplyFunctionDefaults validates args against an AgentFunction schema and returns a copy with defaults applied.
func ValidateAndApplyFunctionDefaults(fn *AgentFunction, catalog *Catalog, args map[string]any) (map[string]any, error) {
	normArgs := map[string]any{}
	if args != nil {
		if copied, ok := CloneJSONValue(args).(map[string]any); ok {
			normArgs = copied
		}
	}
	if fn == nil || len(fn.ArgsSchema) == 0 {
		return normArgs, nil
	}
	defs := map[string]any{}
	if catalog != nil {
		valSchema := catalog.validationSchema()
		if baseDefs, ok := valSchema["$defs"].(map[string]any); ok {
			for k, item := range baseDefs {
				defs[k] = CloneJSONValue(item)
			}
		}
	} else {
		for k, item := range standardDefsForVersion(Version1_0) {
			copied := CloneJSONValue(item)
			localizeBundleRefs(copied)
			defs[k] = copied
		}
	}
	if localDefs, ok := fn.ArgsSchema["$defs"].(map[string]any); ok {
		for k, item := range localDefs {
			defs[k] = CloneJSONValue(item)
		}
	}
	defs["FunctionCall"] = v10FunctionCallEnvelopeSchema()

	argsCopy, _ := CloneJSONValue(fn.ArgsSchema).(map[string]any)
	restoreSourceRefs(argsCopy, standardDefsForVersion(Version1_0), false)
	localizeBundleRefs(argsCopy)
	if argsCopy["type"] == "object" {
		if add, hasAdd := argsCopy["additionalProperties"]; hasAdd {
			delete(argsCopy, "additionalProperties")
			if !hasKey(argsCopy, "unevaluatedProperties") {
				argsCopy["unevaluatedProperties"] = add
			}
		} else if !hasKey(argsCopy, "unevaluatedProperties") {
			argsCopy["unevaluatedProperties"] = false
		}
	}
	full := map[string]any{
		"$schema": jsonSchemaDraft202012,
		"$defs":   defs,
	}
	for k, item := range argsCopy {
		if k != "$defs" {
			full[k] = item
		}
	}
	compiled, err := schemaengine.CompileInline("https://a2ui.org/inline/agentfn/"+escapeJSONPointerToken(fn.Name)+".json", full, nil)
	if err != nil {
		return nil, NewValidationError(err.Error())
	}
	if sErr := compiled.Validate(schemaengine.NormalizeJSON(normArgs)); sErr != nil {
		var details []ErrorDetail
		for _, iss := range schemaengine.ExtractIssues(sErr) {
			p := "functions." + fn.Name
			if len(iss.Location) > 0 {
				p += "." + strings.Join(iss.Location, ".")
			}
			details = append(details, ErrorDetail{
				Path:    p,
				Code:    iss.Code,
				Message: iss.Message,
			})
		}
		return nil, NewValidationError(sErr.Error(), details...)
	}
	applyObjectDefaults(normArgs, full, defs, map[string]bool{})
	return normArgs, nil
}
