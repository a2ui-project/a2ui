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
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/a2ui-project/a2ui/go/core/internal/specassets"
)

// ExtractJSONKeyOrder parses JSON bytes and returns an RFC 6901 JSON Pointer -> ordered object keys map.
func ExtractJSONKeyOrder(data []byte) (map[string][]string, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	out := map[string][]string{}
	if err := readJSONValueOrder(dec, "", out); err != nil {
		return nil, NewParseErrorf("invalid JSON: %v", err)
	}
	return out, nil
}

func readJSONValueOrder(dec *json.Decoder, ptr string, out map[string][]string) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	delim, ok := tok.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		var keys []string
		for dec.More() {
			kTok, err := dec.Token()
			if err != nil {
				return err
			}
			key, ok := kTok.(string)
			if !ok {
				return fmt.Errorf("expected object key string at %s", ptr)
			}
			keys = append(keys, key)
			childPtr := ptr + "/" + escapeJSONPointerToken(key)
			if err := readJSONValueOrder(dec, childPtr, out); err != nil {
				return err
			}
		}
		if _, err := dec.Token(); err != nil { // consume '}'
			return err
		}
		out[ptr] = keys
	case '[':
		idx := 0
		for dec.More() {
			childPtr := ptr + "/" + strconv.Itoa(idx)
			if err := readJSONValueOrder(dec, childPtr, out); err != nil {
				return err
			}
			idx++
		}
		if _, err := dec.Token(); err != nil { // consume ']'
			return err
		}
	}
	return nil
}

// NewCatalog constructs a Catalog programmatically from ComponentAPI and FunctionAPI slices.
func NewCatalog(catalogID string, protocolVersion string, components []ComponentAPI, functions []FunctionAPI) (*Catalog, error) {
	if catalogID == "" {
		return nil, NewCatalogError("catalog_id must be non-empty")
	}
	rawVer := protocolVersion
	if rawVer == "" {
		rawVer = defaultCatalogProtoVer
	}
	pVer, err := ToProtocolVersion(rawVer)
	if err != nil {
		if sv, ok := ParseSemVer(rawVer); ok && sv.Major >= 1 {
			pVer = ProtocolVersion(fmt.Sprintf("%d.%d", sv.Major, sv.Minor))
		} else {
			return nil, err
		}
	}
	validateIDs := IsAtLeastVersion(rawVer, Version1_0)
	compsMap := make(map[string]ComponentAPI, len(components))
	var compOrder []string
	for _, comp := range components {
		if validateIDs && !IsValidUAX31Identifier(comp.Name) {
			return nil, NewCatalogErrorf("Component name '%s' must be a valid UAX #31 identifier.", comp.Name)
		}
		if _, exists := compsMap[comp.Name]; !exists {
			compOrder = append(compOrder, comp.Name)
		}
		cp := comp
		cp.Schema, _ = CloneJSONValue(comp.Schema).(map[string]any)
		cp.Metadata, _ = CloneJSONValue(comp.Metadata).(map[string]any)
		cp.AllowedParents = append([]string(nil), comp.AllowedParents...)
		cp.AllowedChildren = append([]string(nil), comp.AllowedChildren...)
		compsMap[comp.Name] = cp
	}
	fnsMap := make(map[string]FunctionAPI, len(functions))
	var fnOrder []string
	for _, fn := range functions {
		if validateIDs && !strings.HasPrefix(fn.Name, "@") && !IsValidUAX31Identifier(fn.Name) {
			return nil, NewCatalogErrorf("Function name '%s' must be a valid UAX #31 identifier.", fn.Name)
		}
		if validateIDs && fn.Schema != nil {
			argsS := extractAuthoredFunctionArgs(fn.Schema)
			for _, pName := range extractParamNames(argsS) {
				if !IsValidUAX31Identifier(pName) {
					return nil, NewCatalogErrorf("Argument '%s' in function '%s' must be a valid UAX #31 identifier.", pName, fn.Name)
				}
			}
		}
		if _, exists := fnsMap[fn.Name]; !exists {
			fnOrder = append(fnOrder, fn.Name)
		}
		cp := fn
		cp.Schema, _ = CloneJSONValue(fn.Schema).(map[string]any)
		if cp.RequiresUserActivation {
			cp.hasRequiresActivation = true
		}
		fnsMap[fn.Name] = cp
	}
	dialect := jsonSchemaDraft202012
	cat := &Catalog{
		catalogID:               catalogID,
		protocolVersion:         pVer,
		rawProtocolVersion:      rawVer,
		declaresProtocolVersion: protocolVersion != "",
		declaresCatalogID:       true,
		declaresComponents:      len(compOrder) > 0,
		schemaDialect:           &dialect,
		components:              compsMap,
		componentOrder:          compOrder,
		functions:               fnsMap,
		functionOrder:           fnOrder,
		agentFunctions:          map[string]*AgentFunction{},
		defs:                    map[string]any{},
		extras:                  map[string]any{},
	}
	cat.rawDoc = cat.buildDocument()
	return cat, nil
}

// CatalogFromJSONBytes parses a raw JSON catalog document preserving exact authored property and entry order.
// Numbers are decoded as ParseJSON decodes them, so integer literals stay int64.
func CatalogFromJSONBytes(data []byte, opts *CatalogLoadOptions) (*Catalog, error) {
	keyOrder, err := ExtractJSONKeyOrder(data)
	if err != nil {
		return nil, err
	}
	parsed, err := ParseJSON(data)
	if err != nil {
		return nil, err
	}
	doc, ok := parsed.(map[string]any)
	if !ok {
		return nil, NewParseErrorf("catalog document must be a JSON object, got %T", parsed)
	}
	var merged CatalogLoadOptions
	if opts != nil {
		merged = *opts
	}
	if len(merged.KeyOrder) == 0 {
		merged.KeyOrder = keyOrder
	}
	return CatalogFromJSON(doc, &merged)
}

// CatalogFromJSON parses and validates a catalog JSON Schema document.
func CatalogFromJSON(doc map[string]any, opts *CatalogLoadOptions) (*Catalog, error) {
	if doc == nil {
		return nil, NewCatalogError("catalog document cannot be nil")
	}
	var catID string
	var pVerOverride ProtocolVersion
	var keyOrder map[string][]string
	if opts != nil {
		catID = opts.CatalogID
		pVerOverride = opts.ProtocolVersion
		if len(opts.KeyOrder) > 0 {
			keyOrder = make(map[string][]string, len(opts.KeyOrder))
			for k, v := range opts.KeyOrder {
				keyOrder[k] = append([]string(nil), v...)
			}
		}
	}
	if catID == "" {
		if docCatID, ok := doc["catalogId"].(string); ok {
			catID = docCatID
		}
	}
	if catID == "" {
		return nil, NewCatalogError("catalog_id must be provided or exist in catalog schema.")
	}

	document, _ := CloneJSONValue(doc).(map[string]any)
	declaredVer, hasDeclaredVer := document["protocolVersion"].(string)
	rawVerStr := defaultCatalogProtoVer
	if pVerOverride != "" {
		rawVerStr = string(pVerOverride)
	} else if hasDeclaredVer && declaredVer != "" {
		rawVerStr = declaredVer
	}

	pVer, err := ToProtocolVersion(rawVerStr)
	if err != nil {
		// Allow arbitrary future semver >= 1.0 (e.g., 1.1) if parseable, else return CatalogError.
		if sv, ok := ParseSemVer(rawVerStr); ok && sv.Major >= 1 {
			pVer = ProtocolVersion(fmt.Sprintf("%d.%d", sv.Major, sv.Minor))
		} else {
			return nil, err
		}
	}

	validateIdentifiers := IsAtLeastVersion(rawVerStr, Version1_0)
	if validateIdentifiers {
		if err := checkV10ExternalRefs(document, ""); err != nil {
			return nil, err
		}
	}

	var compsMap map[string]any
	declaresComps := false
	if rawComps, exists := document["components"]; exists {
		declaresComps = true
		m, ok := rawComps.(map[string]any)
		if !ok || m == nil {
			return nil, NewCatalogError("Catalog 'components' must be an object mapping names to schemas.")
		}
		compsMap = m
	}

	rawDefs, declaresDefs := document["$defs"].(map[string]any)
	defsMap := map[string]any{}
	if declaresDefs {
		for k, v := range rawDefs {
			defsMap[k] = CloneJSONValue(v)
		}
	}

	permittedComps := unionMemberNames(defsMap["anyComponent"], "#/components/")
	permittedFuncs := unionMemberNames(defsMap["anyFunction"], "#/functions/")

	compNamesOrdered := orderedMapKeys(compsMap, keyOrder, "/components")
	components := make(map[string]ComponentAPI, len(compNamesOrdered))
	var activeCompOrder []string
	for _, name := range compNamesOrdered {
		rawComp := compsMap[name]
		compSchema, ok := rawComp.(map[string]any)
		if !ok {
			return nil, NewCatalogErrorf("Component '%s' schema must be a JSON schema object.", name)
		}
		api, err := parseComponentEntry(name, compSchema, validateIdentifiers)
		if err != nil {
			return nil, err
		}
		if len(permittedComps) == 0 || permittedComps[name] {
			components[name] = api
			activeCompOrder = append(activeCompOrder, name)
		}
	}

	fnEntries, fnForm, err := extractFunctionEntries(document["functions"], hasKey(document, "functions"), catID, keyOrder)
	if err != nil {
		return nil, err
	}
	functions := make(map[string]FunctionAPI, len(fnEntries))
	var activeFnOrder []string
	for _, entry := range fnEntries {
		api, err := parseFunctionEntry(entry.name, entry.spec, validateIdentifiers)
		if err != nil {
			return nil, err
		}
		if len(permittedFuncs) == 0 || permittedFuncs[entry.name] {
			functions[entry.name] = api
			activeFnOrder = append(activeFnOrder, entry.name)
		}
	}

	// Theme extraction
	themeLocation := ""
	var themeSchema map[string]any
	if t, ok := document["theme"].(map[string]any); ok {
		themeLocation = "theme"
		themeSchema, _ = CloneJSONValue(t).(map[string]any)
	} else if styles, ok := document["styles"].(map[string]any); ok && len(styles) > 0 && !isObjectSchemaMap(styles) {
		themeLocation = "styles"
		themeSchema = map[string]any{
			"type":       "object",
			"properties": CloneJSONValue(styles),
		}
	} else if tDef, ok := defsMap["theme"].(map[string]any); ok {
		themeLocation = "$defs"
		themeSchema, _ = CloneJSONValue(tDef).(map[string]any)
		delete(defsMap, "theme")
	}

	// Union definitions
	unionDefs := map[string]any{}
	nullUnions := map[string]bool{}
	derivedCompUnion := makeComponentUnion(activeCompOrder)
	derivedFnUnion := makeFunctionUnion(activeFnOrder)
	for _, pair := range []struct {
		name    string
		derived map[string]any
	}{
		{"anyComponent", derivedCompUnion},
		{"anyFunction", derivedFnUnion},
	} {
		if authored, exists := defsMap[pair.name]; exists {
			delete(defsMap, pair.name)
			if reflect.DeepEqual(authored, pair.derived) {
				unionDefs[pair.name] = nil
			} else {
				unionDefs[pair.name] = authored
				if authored == nil {
					nullUnions[pair.name] = true
				}
			}
		}
	}

	modeledKeys := map[string]bool{
		"$schema": true, "$id": true, "title": true, "description": true,
		"catalogId": true, "protocolVersion": true, "instructions": true,
		"components": true, "functions": true, "theme": true, "$defs": true,
	}
	extras := map[string]any{}
	for k, v := range document {
		_, isMeta := map[string]bool{"$schema": true, "$id": true, "title": true, "description": true}[k]
		_, isStr := v.(string)
		if !modeledKeys[k] ||
			(isMeta && !isStr) ||
			(k == "instructions" && !isStr) ||
			(k == "protocolVersion" && !hasDeclaredVer) ||
			(k == "theme" && themeLocation != "theme") ||
			(k == "$defs" && !declaresDefs) {
			extras[k] = CloneJSONValue(v)
		}
	}
	if themeLocation == "styles" {
		delete(extras, "styles")
	}

	var schemaDialect, schemaID *string
	if s, ok := document["$schema"].(string); ok {
		schemaDialect = &s
	}
	if s, ok := document["$id"].(string); ok {
		schemaID = &s
	}
	title, hasTitle := document["title"].(string)
	desc, hasDesc := document["description"].(string)
	instr, hasInstr := document["instructions"].(string)
	declaresCatID := hasKey(document, "catalogId")

	cat := &Catalog{
		catalogID:               catID,
		protocolVersion:         pVer,
		rawProtocolVersion:      declaredVer,
		declaresProtocolVersion: hasDeclaredVer,
		declaresCatalogID:       declaresCatID,
		declaresComponents:      declaresComps,
		declaresDefs:            declaresDefs,
		schemaDialect:           schemaDialect,
		schemaID:                schemaID,
		title:                   title,
		hasTitle:                hasTitle,
		description:             desc,
		hasDescription:          hasDesc,
		instructions:            instr,
		hasInstructions:         hasInstr,
		themeSchema:             themeSchema,
		themeLocation:           themeLocation,
		functionsForm:           fnForm,
		unionDefs:               unionDefs,
		nullUnions:              nullUnions,
		defs:                    defsMap,
		extras:                  extras,
		keyOrder:                keyOrder,
		components:              components,
		componentOrder:          activeCompOrder,
		functions:               functions,
		functionOrder:           activeFnOrder,
		agentFunctions:          map[string]*AgentFunction{},
	}
	cat.rawDoc = cat.buildDocument()
	return cat, nil
}

func parseComponentEntry(name string, compSchema map[string]any, validateIdentifiers bool) (ComponentAPI, error) {
	if validateIdentifiers {
		if !IsValidUAX31Identifier(name) {
			return ComponentAPI{}, NewCatalogErrorf("Invalid UAX #31 component identifier: '%s'", name)
		}
		if props, ok := compSchema["properties"].(map[string]any); ok {
			for propName := range props {
				if propName != "@metadata" && propName != "@catalogId" && propName != "@accessibility" && propName != "@checks" {
					if !IsValidUAX31Identifier(propName) {
						return ComponentAPI{}, NewCatalogErrorf("Invalid UAX #31 property identifier: '%s' in component '%s'", propName, name)
					}
				}
			}
		}
		if rawMeta, hasMeta := compSchema["metadata"]; hasMeta && rawMeta != nil {
			metaMap, ok := rawMeta.(map[string]any)
			if !ok {
				return ComponentAPI{}, NewValidationErrorf("component %q metadata must be an object", name)
			}
			if err := ValidateMetadata(metaMap, Version1_0); err != nil {
				return ComponentAPI{}, err
			}
		}
	}

	copiedSchema, _ := CloneJSONValue(compSchema).(map[string]any)
	parents, _ := toStringSlice(compSchema["allowedParents"])
	children, _ := toStringSlice(compSchema["allowedChildren"])
	var metaCopy map[string]any
	if m, ok := compSchema["metadata"].(map[string]any); ok {
		metaCopy, _ = CloneJSONValue(m).(map[string]any)
	}
	return ComponentAPI{
		Name:            name,
		Schema:          copiedSchema,
		AllowedParents:  parents,
		AllowedChildren: children,
		Metadata:        metaCopy,
	}, nil
}

type namedFnSpec struct {
	name string
	spec map[string]any
}

func extractFunctionEntries(raw any, present bool, catID string, keyOrder map[string][]string) ([]namedFnSpec, string, error) {
	if !present || raw == nil {
		if present && raw == nil {
			return nil, "", NewCatalogErrorf("Catalog '%s' 'functions' must be an object or a list of definitions.", catID)
		}
		return nil, "", nil
	}
	switch typed := raw.(type) {
	case map[string]any:
		names := orderedMapKeys(typed, keyOrder, "/functions")
		out := make([]namedFnSpec, 0, len(names))
		for _, name := range names {
			spec, ok := typed[name].(map[string]any)
			if !ok {
				return nil, "", NewCatalogErrorf("Catalog '%s' function '%s' must be a JSON schema object.", catID, name)
			}
			copied, _ := CloneJSONValue(spec).(map[string]any)
			out = append(out, namedFnSpec{name: name, spec: copied})
		}
		return out, "map", nil
	case []any:
		seen := map[string]bool{}
		out := make([]namedFnSpec, 0, len(typed))
		for idx, item := range typed {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, "", NewCatalogErrorf("Catalog '%s' function definition %d must be an object.", catID, idx)
			}
			name, _ := m["name"].(string)
			if name == "" {
				return nil, "", NewCatalogErrorf("Catalog '%s' function definition %d is missing a non-empty 'name' string.", catID, idx)
			}
			if seen[name] {
				return nil, "", NewCatalogErrorf("Catalog '%s' function definition %d duplicates the name '%s'.", catID, idx, name)
			}
			seen[name] = true
			spec := map[string]any{}
			for k, v := range m {
				if k != "name" {
					spec[k] = CloneJSONValue(v)
				}
			}
			out = append(out, namedFnSpec{name: name, spec: spec})
		}
		return out, "list", nil
	default:
		return nil, "", NewCatalogErrorf("Catalog '%s' 'functions' must be an object or a list of definitions.", catID)
	}
}

func parseFunctionEntry(name string, spec map[string]any, validateIdentifiers bool) (FunctionAPI, error) {
	if validateIdentifiers {
		if !IsValidUAX31Identifier(name) {
			return FunctionAPI{}, NewCatalogErrorf("Invalid UAX #31 function identifier: '%s'", name)
		}
		var argsTarget map[string]any
		rawProps, hasProps := spec["properties"].(map[string]any)
		if hasProps {
			if a, ok := rawProps["args"].(map[string]any); ok {
				argsTarget = a
			}
		}
		if argsTarget == nil {
			if a, ok := spec["args"].(map[string]any); ok {
				argsTarget = a
			} else if p, ok := spec["parameters"].(map[string]any); ok {
				argsTarget = p
			} else if hasProps && !hasKey(rawProps, "call") && !hasKey(rawProps, "@call") && !hasKey(rawProps, "function") {
				argsTarget = spec
			}
		}
		for _, argName := range extractParamNames(argsTarget) {
			if !IsValidUAX31Identifier(argName) {
				return FunctionAPI{}, NewCatalogErrorf("Invalid UAX #31 argument identifier: '%s' in function '%s'", argName, name)
			}
		}
	}

	acStr, hasAC := spec["allowedCallers"].(string)
	rua, hasRUA := spec["requiresUserActivation"].(bool)
	if validateIdentifiers && hasRUA && rua && hasAC && acStr != string(AllowedCallersRendererOnly) {
		return FunctionAPI{}, NewCatalogErrorf(
			"Function '%s' declares requiresUserActivation=true with allowedCallers='%s'; requiresUserActivation=true requires allowedCallers='rendererOnly'.",
			name, acStr,
		)
	}

	rt := declaredReturnType(spec)
	if rt == "" {
		rt = ReturnTypeAny
	}
	ac := AllowedCallers(acStr)
	if ac == "" {
		ac = AllowedCallersRendererOnly
	}
	desc, _ := spec["description"].(string)
	copiedSpec, _ := CloneJSONValue(spec).(map[string]any)
	return FunctionAPI{
		Name:                    name,
		Description:             desc,
		ReturnType:              rt,
		Schema:                  copiedSpec,
		AllowedCallers:          ac,
		RequiresUserActivation:  rua,
		defaultedAllowedCallers: !hasAC,
		hasRequiresActivation:   hasRUA,
	}, nil
}

func declaredReturnType(spec map[string]any) FunctionReturnType {
	if rt, ok := spec["returnType"].(string); ok && rt != "" {
		return FunctionReturnType(rt)
	}
	if props, ok := spec["properties"].(map[string]any); ok {
		if rtObj, ok := props["returnType"].(map[string]any); ok {
			if c, ok := rtObj["const"].(string); ok && c != "" {
				return FunctionReturnType(c)
			}
		}
	}
	return ""
}

func extractParamNames(schema map[string]any) []string {
	return extractReachableParamNames(schema, nil)
}

func extractReachableParamNames(schema map[string]any, rootDefs map[string]any) []string {
	if schema == nil {
		return nil
	}
	combinedDefs := map[string]any{}
	for k, v := range rootDefs {
		combinedDefs[k] = v
	}
	if localDefs, ok := schema["$defs"].(map[string]any); ok {
		for k, v := range localDefs {
			combinedDefs[k] = v
		}
	}
	rootDoc := map[string]any{"$defs": combinedDefs}
	seenNames := map[string]bool{}
	visitedRefs := map[string]bool{}

	var collect func(sub map[string]any)
	collect = func(sub map[string]any) {
		if sub == nil {
			return
		}
		if props, ok := sub["properties"].(map[string]any); ok {
			for k := range props {
				seenNames[k] = true
			}
		} else if isShorthandParamMap(sub) {
			for k := range sub {
				seenNames[k] = true
			}
		}
		if ref, ok := sub["$ref"].(string); ok && strings.HasPrefix(ref, "#/") && !visitedRefs[ref] {
			visitedRefs[ref] = true
			if target, ok := queryJSONPointer(rootDoc, ref).(map[string]any); ok {
				collect(target)
			}
		}
		for _, comb := range []string{"allOf", "anyOf", "oneOf"} {
			if arr, ok := sub[comb].([]any); ok {
				for _, branch := range arr {
					if bm, ok := branch.(map[string]any); ok {
						collect(bm)
					}
				}
			}
		}
	}
	collect(schema)
	if len(seenNames) == 0 {
		return nil
	}
	out := make([]string, 0, len(seenNames))
	for k := range seenNames {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func checkV10ExternalRefs(node any, ptr string) error {
	switch typed := node.(type) {
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok && !isSupportedV10Ref(ref) {
			return NewCatalogErrorf(
				"Unsupported external $ref '%s' at %s/$ref: a v1.0 catalog may only reference its own components and functions (#/...) or common_types.json.",
				ref, ptr,
			)
		}
		for k, v := range typed {
			if err := checkV10ExternalRefs(v, ptr+"/"+escapeJSONPointerToken(k)); err != nil {
				return err
			}
		}
	case []any:
		for i, item := range typed {
			if err := checkV10ExternalRefs(item, fmt.Sprintf("%s/%d", ptr, i)); err != nil {
				return err
			}
		}
	}
	return nil
}

func isSupportedV10Ref(ref string) bool {
	doc := strings.SplitN(ref, "#", 2)[0]
	if doc == "" || doc == "catalog.json" {
		return true
	}
	idx := strings.LastIndex(doc, "/")
	base := doc
	if idx >= 0 {
		base = doc[idx+1:]
	}
	return base == "common_types.json"
}

func unionMemberNames(union any, prefix string) map[string]bool {
	out := map[string]bool{}
	m, ok := union.(map[string]any)
	if !ok {
		return out
	}
	arr, ok := m["oneOf"].([]any)
	if !ok {
		return out
	}
	for _, item := range arr {
		im, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if ref, ok := im["$ref"].(string); ok && strings.HasPrefix(ref, prefix) {
			parts := strings.Split(ref, "/")
			out[unescapeJSONPointerToken(parts[len(parts)-1])] = true
		}
	}
	return out
}

func isObjectSchemaMap(m map[string]any) bool {
	return hasKey(m, "properties") || hasKey(m, "allOf") || m["type"] == "object"
}

func orderedMapKeys(m map[string]any, keyOrder map[string][]string, ptr string) []string {
	if len(m) == 0 {
		return nil
	}
	if keyOrder != nil {
		if ordered, ok := keyOrder[ptr]; ok {
			var out []string
			seen := map[string]bool{}
			for _, k := range ordered {
				if _, exists := m[k]; exists && !seen[k] {
					out = append(out, k)
					seen[k] = true
				}
			}
			if len(out) == len(m) {
				return out
			}
			var rest []string
			for k := range m {
				if !seen[k] {
					rest = append(rest, k)
				}
			}
			sort.Strings(rest)
			return append(out, rest...)
		}
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func loadEmbeddedBasicCatalog(norm ProtocolVersion) (*Catalog, error) {
	var assetPath string
	opts := &CatalogLoadOptions{ProtocolVersion: norm}
	switch norm {
	case Version1_0:
		assetPath = "catalogs/basic/v1/catalog.json"
	case Version0_9:
		assetPath = "specification/v0_9/catalogs/basic/catalog.json"
	case Version0_9_1:
		assetPath = "specification/v0_9_1/catalogs/basic/catalog.json"
	case Version0_8:
		assetPath = "specification/v0_8/json/standard_catalog_definition.json"
		opts.CatalogID = v08BasicCatalogID
	default:
		return nil, NewCatalogErrorf("unsupported BasicCatalog version %q", norm)
	}
	raw, err := specassets.ReadBytes(assetPath)
	if err != nil {
		return nil, NewCatalogErrorf("load embedded basic catalog (%s): %v", norm, err)
	}
	cat, err := CatalogFromJSONBytes(raw, opts)
	if err != nil {
		return nil, err
	}
	attachBasicCatalogEvaluators(cat)
	return cat, nil
}

var (
	basicCatalogV10  = sync.OnceValues(func() (*Catalog, error) { return loadEmbeddedBasicCatalog(Version1_0) })
	basicCatalogV09  = sync.OnceValues(func() (*Catalog, error) { return loadEmbeddedBasicCatalog(Version0_9) })
	basicCatalogV091 = sync.OnceValues(func() (*Catalog, error) { return loadEmbeddedBasicCatalog(Version0_9_1) })
	basicCatalogV08  = sync.OnceValues(func() (*Catalog, error) { return loadEmbeddedBasicCatalog(Version0_8) })
	mcpCatalogV10    = sync.OnceValues(func() (*Catalog, error) {
		raw, err := specassets.ReadBytes("catalogs/mcp/v1/catalog.json")
		if err != nil {
			return nil, NewCatalogErrorf("load embedded MCP catalog: %v", err)
		}
		return CatalogFromJSONBytes(raw, &CatalogLoadOptions{ProtocolVersion: Version1_0})
	})
)

// BasicCatalog returns a fresh copy of the built-in A2UI Basic Catalog for the specified protocol version.
func BasicCatalog(version ProtocolVersion) (*Catalog, error) {
	norm, err := ToProtocolVersion(string(version))
	if err != nil {
		return nil, err
	}
	var base *Catalog
	switch norm {
	case Version1_0:
		base, err = basicCatalogV10()
	case Version0_9:
		base, err = basicCatalogV09()
	case Version0_9_1:
		base, err = basicCatalogV091()
	case Version0_8:
		base, err = basicCatalogV08()
	default:
		return nil, NewCatalogErrorf("unsupported BasicCatalog version %q", version)
	}
	if err != nil {
		return nil, err
	}
	return base.clone(), nil
}

// MustBasicCatalog returns BasicCatalog(version) and panics if version is invalid.
func MustBasicCatalog(version ProtocolVersion) *Catalog {
	cat, err := BasicCatalog(version)
	if err != nil {
		panic(err)
	}
	return cat
}

// MCPCatalog returns a fresh copy of the built-in A2UI v1.0 MCP Catalog.
func MCPCatalog() (*Catalog, error) {
	base, err := mcpCatalogV10()
	if err != nil {
		return nil, err
	}
	return base.clone(), nil
}

var preservedCommonTypeRefs = sync.OnceValue(func() map[string]bool {
	out := map[string]bool{}
	for _, ver := range []ProtocolVersion{Version0_9, Version1_0} {
		if m, err := CommonTypesSchemaMap(ver); err == nil {
			if defs, ok := m["$defs"].(map[string]any); ok {
				for k := range defs {
					out[k] = true
				}
			}
		}
	}
	return out
})

// maxInlinedSchemaNodes bounds the number of schema nodes one inlineLocalRefs call produces.
// Inlining every occurrence of a $ref separately expands schemas whose references form a DAG
// with fan-out exponentially (each $defs entry referencing the next one twice doubles the output
// per level), so references met after the budget is spent are left in place, as cyclic ones are.
// The largest resolved schema in the built-in catalogs has under 100 nodes.
const maxInlinedSchemaNodes = 1 << 14

// inlineLocalRefs resolves #/ JSON Pointer references within rootCatalog while preserving common_types $defs.
func inlineLocalRefs(node any, rootCatalog map[string]any, inlineLocalDefs bool) any {
	budget := maxInlinedSchemaNodes
	return inlineLocalRefsVisited(node, rootCatalog, map[string]bool{}, inlineLocalDefs, &budget)
}

func inlineLocalRefsVisited(node any, rootCatalog map[string]any, visited map[string]bool, inlineLocalDefs bool, budget *int) any {
	*budget--
	switch typed := node.(type) {
	case map[string]any:
		if refPath, ok := typed["$ref"].(string); ok && strings.HasPrefix(refPath, "#/") {
			parts := strings.Split(refPath, "/")
			refName := unescapeJSONPointerToken(parts[len(parts)-1])
			if strings.HasPrefix(refPath, "#/$defs/") && (preservedCommonTypeRefs()[refName] || !inlineLocalDefs) {
				return CloneJSONValue(typed)
			}
			if visited[refPath] || *budget <= 0 {
				return CloneJSONValue(typed)
			}
			nextVisited := make(map[string]bool, len(visited)+1)
			for k, v := range visited {
				nextVisited[k] = v
			}
			nextVisited[refPath] = true

			if resolvedNode := queryJSONPointer(rootCatalog, refPath); resolvedNode != nil {
				inlinedTarget := inlineLocalRefsVisited(resolvedNode, rootCatalog, nextVisited, inlineLocalDefs, budget)
				siblings := map[string]any{}
				for k, v := range typed {
					if k != "$ref" {
						siblings[k] = inlineLocalRefsVisited(v, rootCatalog, visited, inlineLocalDefs, budget)
					}
				}
				// inlinedTarget and siblings are fresh copies, so they are merged without cloning them again.
				if res, ok := inlinedTarget.(map[string]any); ok {
					for k, v := range siblings {
						if existingMap, ok1 := res[k].(map[string]any); ok1 {
							if sibMap, ok2 := v.(map[string]any); ok2 {
								merged := make(map[string]any, len(existingMap)+len(sibMap))
								for ek, ev := range existingMap {
									merged[ek] = ev
								}
								for sk, sv := range sibMap {
									merged[sk] = sv
								}
								res[k] = merged
								continue
							}
						}
						if existingSlice, ok1 := res[k].([]any); ok1 {
							if sibSlice, ok2 := v.([]any); ok2 {
								merged := append([]any(nil), existingSlice...)
								for _, item := range sibSlice {
									if !sliceContainsEqual(merged, item) {
										merged = append(merged, item)
									}
								}
								res[k] = merged
								continue
							}
						}
						res[k] = v
					}
					return res
				}
				return inlinedTarget
			}
		}
		out := make(map[string]any, len(typed))
		for k, v := range typed {
			out[k] = inlineLocalRefsVisited(v, rootCatalog, visited, inlineLocalDefs, budget)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = inlineLocalRefsVisited(item, rootCatalog, visited, inlineLocalDefs, budget)
		}
		return out
	default:
		return CloneJSONValue(node)
	}
}

func normalizeExternalSchemaRefs(node any) any {
	switch typed := node.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for k, v := range typed {
			if k == "$ref" {
				if s, ok := v.(string); ok {
					out[k] = localizeKnownSpecRef(s)
					continue
				}
			}
			out[k] = normalizeExternalSchemaRefs(v)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = normalizeExternalSchemaRefs(item)
		}
		return out
	default:
		return node
	}
}

func localizeKnownSpecRef(ref string) string {
	if !strings.Contains(ref, "#/$defs/") || strings.HasPrefix(ref, "#/") {
		return ref
	}
	parts := strings.SplitN(ref, "#", 2)
	if len(parts) != 2 {
		return ref
	}
	if strings.HasSuffix(parts[0], "common_types.json") || strings.HasSuffix(parts[0], "catalog.json") {
		return "#" + parts[1]
	}
	return ref
}

func queryJSONPointer(doc map[string]any, pointer string) any {
	if !strings.HasPrefix(pointer, "#/") || doc == nil {
		return nil
	}
	parts := strings.Split(pointer[2:], "/")
	var curr any = doc
	for _, raw := range parts {
		tok := unescapeJSONPointerToken(raw)
		switch m := curr.(type) {
		case map[string]any:
			val, ok := m[tok]
			if !ok {
				return nil
			}
			curr = val
		case []any:
			idx, ok := parseCanonicalArrayIndex(tok)
			if !ok || idx >= len(m) {
				return nil
			}
			curr = m[idx]
		default:
			return nil
		}
	}
	return curr
}

// CommonTypesSchemaJSON returns the canonical common_types.json raw bytes for version.
func CommonTypesSchemaJSON(version ProtocolVersion) ([]byte, error) {
	norm, err := ToProtocolVersion(string(version))
	if err != nil {
		return nil, err
	}
	switch norm {
	case Version1_0:
		return specassets.ReadBytes("specification/v1_0/json/common_types.json")
	case Version0_9:
		return specassets.ReadBytes("specification/v0_9/json/common_types.json")
	case Version0_9_1:
		return specassets.ReadBytes("specification/v0_9_1/json/common_types.json")
	default:
		return nil, NewCatalogErrorf("common_types schema is not available for protocol version %q", version)
	}
}

// CommonTypesSchemaMap returns the canonical common_types.json schema map for version.
func CommonTypesSchemaMap(version ProtocolVersion) (map[string]any, error) {
	raw, err := CommonTypesSchemaJSON(version)
	if err != nil {
		return nil, err
	}
	return decodeSchemaDocument(raw, "common_types")
}

// decodeSchemaDocument decodes an embedded specification schema with ParseJSON.
func decodeSchemaDocument(raw []byte, name string) (map[string]any, error) {
	parsed, err := ParseJSON(raw)
	if err != nil {
		return nil, NewCatalogErrorf("decode %s schema: %v", name, err)
	}
	out, ok := parsed.(map[string]any)
	if !ok {
		return nil, NewCatalogErrorf("decode %s schema: document is not a JSON object", name)
	}
	return out, nil
}

// AgentToRendererSchemaJSON returns the canonical agent_to_renderer / server_to_client raw bytes for version.
func AgentToRendererSchemaJSON(version ProtocolVersion) ([]byte, error) {
	norm, err := ToProtocolVersion(string(version))
	if err != nil {
		return nil, err
	}
	switch norm {
	case Version1_0:
		return specassets.ReadBytes("specification/v1_0/json/agent_to_renderer.json")
	case Version0_9:
		return specassets.ReadBytes("specification/v0_9/json/server_to_client.json")
	case Version0_9_1:
		return specassets.ReadBytes("specification/v0_9_1/json/server_to_client.json")
	case Version0_8:
		return specassets.ReadBytes("specification/v0_8/json/server_to_client.json")
	default:
		return nil, NewCatalogErrorf("agent_to_renderer schema is not available for protocol version %q", version)
	}
}

func agentToRendererSchemaMap(version ProtocolVersion) (map[string]any, error) {
	raw, err := AgentToRendererSchemaJSON(version)
	if err != nil {
		return nil, err
	}
	return decodeSchemaDocument(raw, "agent_to_renderer")
}

func escapeJSONPointerToken(token string) string {
	s := strings.ReplaceAll(token, "~", "~0")
	return strings.ReplaceAll(s, "/", "~1")
}

func unescapeJSONPointerToken(token string) string {
	s := strings.ReplaceAll(token, "~1", "/")
	return strings.ReplaceAll(s, "~0", "~")
}

func parseCanonicalArrayIndex(token string) (int, bool) {
	if token == "" {
		return 0, false
	}
	if len(token) > 1 && token[0] == '0' {
		return 0, false
	}
	for i := 0; i < len(token); i++ {
		if token[i] < '0' || token[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(token)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func containsString(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}

func sliceContainsEqual(list []any, item any) bool {
	for _, existing := range list {
		if reflect.DeepEqual(existing, item) {
			return true
		}
	}
	return false
}
