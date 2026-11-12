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

package schemahelper

import (
	"fmt"
	"maps"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/envelope"
	"github.com/a2ui-project/a2ui/go/core"
)

var commonDefRe = regexp.MustCompile(`(?:^|/)common_types\.json#/(?:\$defs|definitions)/(\w+)$`)

// standardCatalogIDDescription is the description of ComponentCommon's catalogId
// property, which identifies a bare catalogId as the standard catalog override.
const standardCatalogIDDescription = "The catalog ID for this component, overriding any surface-level default catalogId."

// isStandardChecksSchema reports whether a bare checks property schema is the
// Checkable mixin's list of check rules.
func isStandardChecksSchema(schema any) bool {
	m, ok := schema.(map[string]any)
	if !ok {
		return false
	}
	if ref, ok := m["$ref"].(string); ok && strings.HasSuffix(ref, "/Checkable") {
		return true
	}
	items, ok := m["items"].(map[string]any)
	if !ok {
		return false
	}
	ref, ok := items["$ref"].(string)
	return ok && strings.HasSuffix(ref, "/CheckRule")
}

// customEnvelopeProperties returns the bare envelope mixin names that a component
// declares as its own properties in propSchemas. A standard checks list of check
// rules is the checks slot, a catalogId with the standard description is the catalog
// override, and metadata or accessibility with the standard mixin shape are the
// mixins themselves, so none of those count as custom.
func customEnvelopeProperties(propSchemas map[string]any) map[string]bool {
	custom := make(map[string]bool)
	for _, mixin := range envelope.MixinNames {
		if _, ok := propSchemas[mixin]; ok {
			custom[mixin] = true
		}
	}
	if custom["checks"] && isStandardChecksSchema(propSchemas["checks"]) {
		delete(custom, "checks")
	}
	if cat, ok := propSchemas["catalogId"].(map[string]any); ok && cat["description"] == standardCatalogIDDescription {
		delete(custom, "catalogId")
	}
	if meta, ok := propSchemas["metadata"].(map[string]any); ok {
		props, _ := meta["properties"].(map[string]any)
		_, hasExtensions := props["extensions"]
		if len(props) == 1 && hasExtensions && meta["additionalProperties"] == false {
			delete(custom, "metadata")
		}
	}
	if a11y, ok := propSchemas["accessibility"].(map[string]any); ok {
		ref, _ := a11y["$ref"].(string)
		props, _ := a11y["properties"].(map[string]any)
		_, hasLabel := props["label"]
		_, hasDescription := props["description"]
		if strings.HasSuffix(ref, "/AccessibilityAttributes") || (hasLabel && hasDescription && a11y["additionalProperties"] == false) {
			delete(custom, "accessibility")
		}
	}
	return custom
}

// CommonDefName returns the common_types.json definition name referenced by ref, or "" if none.
func CommonDefName(ref any) string {
	s, ok := ref.(string)
	if !ok {
		return ""
	}
	m := commonDefRe.FindStringSubmatch(s)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

// IsActionSlot reports whether schema references the common Action definition, directly or via combinators.
func IsActionSlot(schema map[string]any) bool {
	if schema == nil {
		return false
	}
	if CommonDefName(schema["$ref"]) == "Action" {
		return true
	}
	for _, key := range []string{"allOf", "oneOf", "anyOf"} {
		subs, ok := schema[key].([]any)
		if !ok {
			continue
		}
		for _, sub := range subs {
			if subMap, ok := sub.(map[string]any); ok && IsActionSlot(subMap) {
				return true
			}
		}
	}
	return false
}

// ExpectsOptionObjects reports whether schema expects an array of objects with "label" and "value" properties.
func ExpectsOptionObjects(schema map[string]any) bool {
	if schema == nil {
		return false
	}
	if itemsRaw, hasItems := schema["items"]; hasItems {
		itemsMap, ok := itemsRaw.(map[string]any)
		if !ok {
			return false
		}
		var hasLabelValue func(sub map[string]any) bool
		hasLabelValue = func(sub map[string]any) bool {
			if sub == nil {
				return false
			}
			if props, ok := sub["properties"].(map[string]any); ok {
				_, hasLabel := props["label"]
				_, hasVal := props["value"]
				if hasLabel && hasVal {
					return true
				}
			}
			for _, k := range []string{"allOf", "oneOf", "anyOf"} {
				if subs, ok := sub[k].([]any); ok {
					for _, s := range subs {
						if sm, ok := s.(map[string]any); ok && hasLabelValue(sm) {
							return true
						}
					}
				}
			}
			return false
		}
		return hasLabelValue(itemsMap)
	}
	for _, key := range []string{"allOf", "oneOf", "anyOf"} {
		if subs, ok := schema[key].([]any); ok {
			for _, sub := range subs {
				if sm, ok := sub.(map[string]any); ok && ExpectsOptionObjects(sm) {
					return true
				}
			}
		}
	}
	return false
}

// SystemFunctionSchemas extracts protocol-defined @-prefixed system function schemas from commonTypes.
func SystemFunctionSchemas(commonTypes map[string]any) map[string]map[string]any {
	out := make(map[string]map[string]any)
	if commonTypes == nil {
		return out
	}
	defs, ok := commonTypes["$defs"].(map[string]any)
	if !ok {
		defs, _ = commonTypes["definitions"].(map[string]any)
	}
	if defs == nil {
		return out
	}
	for _, k := range OrderedKeys(defs) {
		schema, ok := defs[k].(map[string]any)
		if !ok {
			continue
		}
		props, ok := schema["properties"].(map[string]any)
		if !ok {
			continue
		}
		callObj, ok := props["@call"].(map[string]any)
		if !ok {
			continue
		}
		name, ok := callObj["const"].(string)
		if ok && strings.HasPrefix(name, "@") {
			out[name] = schema
		}
	}
	return out
}

func findEnum(s map[string]any) []any {
	if s == nil {
		return nil
	}
	if enumSlice, ok := s["enum"].([]any); ok && len(enumSlice) > 0 {
		return enumSlice
	}
	for _, k := range []string{"oneOf", "anyOf", "allOf"} {
		if subs, ok := s[k].([]any); ok {
			for _, sub := range subs {
				if sm, ok := sub.(map[string]any); ok {
					if res := findEnum(sm); len(res) > 0 {
						return res
					}
				}
			}
		}
	}
	return nil
}

func functionSignature(schema map[string]any) ([]string, []string) {
	if schema == nil {
		return nil, nil
	}
	subSchemas := []map[string]any{schema}
	if allOf, ok := schema["allOf"].([]any); ok {
		for _, sub := range allOf {
			if sm, ok := sub.(map[string]any); ok {
				subSchemas = append(subSchemas, sm)
			}
		}
	}

	var propOrder []string
	seenProps := make(map[string]bool)
	var reqs []string
	seenReqs := make(map[string]bool)

	for _, sub := range subSchemas {
		props, ok := sub["properties"].(map[string]any)
		if !ok {
			continue
		}
		argsObj, ok := props["args"].(map[string]any)
		if !ok {
			continue
		}
		if argsProps, ok := argsObj["properties"].(map[string]any); ok {
			for _, pk := range OrderedKeys(argsProps) {
				if !seenProps[pk] {
					seenProps[pk] = true
					propOrder = append(propOrder, pk)
				}
			}
		}
		if reqList, ok := argsObj["required"].([]any); ok {
			for _, r := range reqList {
				if rs, ok := r.(string); ok && !seenReqs[rs] {
					seenReqs[rs] = true
					reqs = append(reqs, rs)
				}
			}
		}
	}
	return propOrder, reqs
}

func orderedComponentSubSchemas(schema map[string]any) []map[string]any {
	if schema == nil {
		return nil
	}
	var specific []map[string]any
	var common []map[string]any

	var visit func(node map[string]any, isRoot bool)
	visit = func(node map[string]any, isRoot bool) {
		if node == nil {
			return
		}
		props, hasProps := node["properties"].(map[string]any)
		_, hasComponent := props["component"]
		if hasProps && hasComponent {
			specific = append(specific, node)
		} else {
			_, hasReq := node["required"]
			_, hasRef := node["$ref"]
			if !isRoot || hasProps || hasReq || hasRef {
				common = append(common, node)
			}
		}
		if allOf, ok := node["allOf"].([]any); ok {
			for _, sub := range allOf {
				if sm, ok := sub.(map[string]any); ok {
					visit(sm, false)
				}
			}
		}
	}

	visit(schema, true)
	out := make([]map[string]any, 0, len(specific)+len(common))
	out = append(out, specific...)
	out = append(out, common...)
	return out
}

// DefaultPreservedTypeRefs lists canonical protocol common type names that must remain as $ref
// rather than being flattened when inlining catalog-local $defs.
var defaultPreservedTypeRefs = map[string]bool{
	"AccessibilityAttributes": true,
	"Action":                  true,
	"CheckRule":               true,
	"Checkable":               true,
	"Child":                   true,
	"ChildList":               true,
	"ComponentCommon":         true,
	"ComponentId":             true,
	"DataBinding":             true,
	"DynamicBoolean":          true,
	"DynamicNumber":           true,
	"DynamicString":           true,
	"DynamicStringList":       true,
	"DynamicValue":            true,
	"FunctionCall":            true,
}

func resolveJSONPointer(root map[string]any, pointer string) any {
	if !strings.HasPrefix(pointer, "#/") {
		return nil
	}
	var curr any = root
	for _, rawPart := range strings.Split(pointer[2:], "/") {
		part := strings.ReplaceAll(strings.ReplaceAll(rawPart, "~1", "/"), "~0", "~")
		switch c := curr.(type) {
		case map[string]any:
			val, ok := c[part]
			if !ok {
				return nil
			}
			curr = val
		case []any:
			idx, err := strconv.Atoi(part)
			if err != nil || idx < 0 || idx >= len(c) {
				return nil
			}
			curr = c[idx]
		default:
			return nil
		}
	}
	return curr
}

// InlineLocalRefsWithOrder copies doc, resolving catalog-local "#/..." $refs (except preserved
// common type defs and cycles) while stamping SetMapKeyOrder on every cloned map from keyOrder.
func InlineLocalRefsWithOrder(doc map[string]any, keyOrder map[string][]string, preservedDefs map[string]bool) map[string]any {
	if doc == nil {
		return map[string]any{}
	}

	keysFor := func(m map[string]any, ptr string) []string {
		if keyOrder != nil {
			if ko, ok := keyOrder[ptr]; ok && len(ko) > 0 {
				var filtered []string
				seen := make(map[string]bool, len(m))
				for _, k := range ko {
					if _, exists := m[k]; exists && !seen[k] {
						seen[k] = true
						filtered = append(filtered, k)
					}
				}
				if len(filtered) < len(m) {
					var extra []string
					for k := range m {
						if !seen[k] {
							extra = append(extra, k)
						}
					}
					slices.Sort(extra)
					filtered = append(filtered, extra...)
				}
				return filtered
			}
		}
		return OrderedKeys(m)
	}

	var walk func(node any, ptr string, visited map[string]bool) any
	walk = func(node any, ptr string, visited map[string]bool) any {
		switch n := node.(type) {
		case map[string]any:
			if ref, ok := n["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
				parts := strings.Split(ref, "/")
				refName := parts[len(parts)-1]
				if strings.HasPrefix(ref, "#/$defs/") && (defaultPreservedTypeRefs[refName] || preservedDefs[refName]) {
					// Preserve standard type ref while cloning sibling keys.
					keys := keysFor(n, ptr)
					cloned := make(map[string]any, len(n))
					for _, k := range keys {
						cloned[k] = walk(n[k], ptr+"/"+EscapePointerSegment(k), visited)
					}
					SetMapKeyOrder(cloned, keys)
					return cloned
				}
				if !visited[ref] {
					if target := resolveJSONPointer(doc, ref); target != nil {
						nextVisited := maps.Clone(visited)
						if nextVisited == nil {
							nextVisited = make(map[string]bool)
						}
						nextVisited[ref] = true
						targetPtr := ref[1:] // strip '#'
						resolved := walk(target, targetPtr, nextVisited)
						if resolvedMap, ok := resolved.(map[string]any); ok {
							resKeys := OrderedKeys(resolvedMap)
							res := CloneMapPreservingOrder(resolvedMap)
							ownKeys := keysFor(n, ptr)
							for _, k := range ownKeys {
								if k == "$ref" {
									continue
								}
								mv := walk(n[k], ptr+"/"+EscapePointerSegment(k), visited)
								if existingMap, ok1 := res[k].(map[string]any); ok1 {
									if mvMap, ok2 := mv.(map[string]any); ok2 {
										mergedMap := CloneMapPreservingOrder(existingMap)
										mergedKeys := OrderedKeys(mergedMap)
										for _, mk := range OrderedKeys(mvMap) {
											if _, had := mergedMap[mk]; !had {
												mergedKeys = append(mergedKeys, mk)
											}
											mergedMap[mk] = mvMap[mk]
										}
										SetMapKeyOrder(mergedMap, mergedKeys)
										res[k] = mergedMap
										continue
									}
								}
								if existingList, ok1 := res[k].([]any); ok1 {
									if mvList, ok2 := mv.([]any); ok2 {
										combined := append([]any(nil), existingList...)
										for _, item := range mvList {
											if !slices.ContainsFunc(combined, func(e any) bool { return reflect.DeepEqual(e, item) }) {
												combined = append(combined, item)
											}
										}
										res[k] = combined
										continue
									}
								}
								if !slices.Contains(resKeys, k) {
									resKeys = append(resKeys, k)
								}
								res[k] = mv
							}
							SetMapKeyOrder(res, resKeys)
							return res
						}
						return resolved
					}
				}
			}
			keys := keysFor(n, ptr)
			out := make(map[string]any, len(n))
			for _, k := range keys {
				out[k] = walk(n[k], ptr+"/"+EscapePointerSegment(k), visited)
			}
			SetMapKeyOrder(out, keys)
			return out

		case []any:
			out := make([]any, len(n))
			for i, item := range n {
				out[i] = walk(item, ptr+"/"+strconv.Itoa(i), visited)
			}
			return out

		default:
			return n
		}
	}

	inlined, _ := walk(doc, "", nil).(map[string]any)
	if inlined == nil {
		return map[string]any{}
	}
	return inlined
}

type propEnumKey struct {
	comp string
	prop string
}

// CatalogSchemaHelper dynamically crawls an A2UI Catalog's JSON schemas to resolve
// positional component/function signatures, checkability, enums, and nested slots.
type CatalogSchemaHelper struct {
	CatalogModel      *core.Catalog
	CatalogDoc        map[string]any
	CommonTypes       map[string]any
	CommonTypesLoaded bool
	SystemFunctions   map[string]map[string]any
	Components        map[string]map[string]any
	ComponentOrder    []string
	Functions         map[string]map[string]any
	FunctionOrder     []string

	componentProperties     map[string][]string
	componentRequired       map[string][]string
	componentIsCheckable    map[string]bool
	componentCustomEnvelope map[string]map[string]bool
	componentPropertyEnums  map[propEnumKey][]any
	functionProperties      map[string][]string
	functionRequired        map[string][]string
	sysFunctionProperties   map[string][]string
	sysFunctionRequired     map[string][]string
}

// NewCatalogSchemaHelper constructs a CatalogSchemaHelper for catalog and optional protocolVersion override.
func NewCatalogSchemaHelper(catalog *core.Catalog, protocolVersion string) *CatalogSchemaHelper {
	var rawDoc map[string]any
	var keyOrder map[string][]string
	targetVer := protocolVersion
	if catalog != nil {
		rawDoc = catalog.ToJSON()
		keyOrder = catalog.KeyOrder()
		if targetVer == "" {
			targetVer = string(catalog.ProtocolVersion())
		}
	}

	var commonTypes map[string]any
	var commonTypesKeyOrder map[string][]string
	commonLoaded := false
	if pv, err := core.ToProtocolVersion(targetVer); err == nil {
		if rawBytes, rErr := core.CommonTypesSchemaJSON(pv); rErr == nil && len(rawBytes) > 0 {
			if parsed, ko, uErr := UnmarshalJSONPreservingOrder(rawBytes); uErr == nil {
				if ctMap, isMap := parsed.(map[string]any); isMap {
					commonTypes = ctMap
					commonTypesKeyOrder = ko
					commonLoaded = true
				}
			}
		}
		if !commonLoaded {
			if ct, ctErr := core.CommonTypesSchemaMap(pv); ctErr == nil && ct != nil {
				commonTypes = ct
				commonLoaded = true
			}
		}
	}

	return NewCatalogSchemaHelperFromRaw(catalog, rawDoc, keyOrder, commonTypes, commonTypesKeyOrder, commonLoaded)
}

// NewCatalogSchemaHelperFromRaw constructs a CatalogSchemaHelper directly from raw schema maps and optional key orders.
func NewCatalogSchemaHelperFromRaw(
	catalogModel *core.Catalog,
	rawDoc map[string]any,
	docKeyOrder map[string][]string,
	commonTypes map[string]any,
	commonTypesKeyOrder map[string][]string,
	commonTypesLoaded bool,
) *CatalogSchemaHelper {
	preservedDefs := make(map[string]bool)
	if commonTypes != nil {
		if len(commonTypesKeyOrder) > 0 {
			commonTypes = InlineLocalRefsWithOrder(commonTypes, commonTypesKeyOrder, defaultPreservedTypeRefs)
		}
		if defs, ok := commonTypes["$defs"].(map[string]any); ok {
			for k := range defs {
				preservedDefs[k] = true
			}
		}
		if defs, ok := commonTypes["definitions"].(map[string]any); ok {
			for k := range defs {
				preservedDefs[k] = true
			}
		}
	}

	inlined := InlineLocalRefsWithOrder(rawDoc, docKeyOrder, preservedDefs)

	h := &CatalogSchemaHelper{
		CatalogModel:            catalogModel,
		CatalogDoc:              inlined,
		CommonTypes:             commonTypes,
		CommonTypesLoaded:       commonTypesLoaded,
		SystemFunctions:         SystemFunctionSchemas(commonTypes),
		Components:              make(map[string]map[string]any),
		Functions:               make(map[string]map[string]any),
		componentProperties:     make(map[string][]string),
		componentRequired:       make(map[string][]string),
		componentIsCheckable:    make(map[string]bool),
		componentCustomEnvelope: make(map[string]map[string]bool),
		componentPropertyEnums:  make(map[propEnumKey][]any),
		functionProperties:      make(map[string][]string),
		functionRequired:        make(map[string][]string),
		sysFunctionProperties:   make(map[string][]string),
		sysFunctionRequired:     make(map[string][]string),
	}

	if compsRaw, ok := inlined["components"].(map[string]any); ok {
		var order []string
		if catalogModel != nil && len(catalogModel.ComponentNames()) > 0 {
			for _, name := range catalogModel.ComponentNames() {
				if cm, ok := compsRaw[name].(map[string]any); ok {
					h.Components[name] = cm
					order = append(order, name)
				}
			}
		}
		for _, name := range OrderedKeys(compsRaw) {
			if _, already := h.Components[name]; !already {
				if cm, ok := compsRaw[name].(map[string]any); ok {
					h.Components[name] = cm
					order = append(order, name)
				}
			}
		}
		h.ComponentOrder = order
	}

	if funcsRaw, ok := inlined["functions"].(map[string]any); ok {
		var order []string
		if catalogModel != nil && len(catalogModel.FunctionNames()) > 0 {
			for _, name := range catalogModel.FunctionNames() {
				if fm, ok := funcsRaw[name].(map[string]any); ok {
					h.Functions[name] = fm
					order = append(order, name)
				}
			}
		}
		for _, name := range OrderedKeys(funcsRaw) {
			if _, already := h.Functions[name]; !already {
				if fm, ok := funcsRaw[name].(map[string]any); ok {
					h.Functions[name] = fm
					order = append(order, name)
				}
			}
		}
		h.FunctionOrder = order
	}

	h.loadMappings()
	return h
}

func (h *CatalogSchemaHelper) loadMappings() {
	for _, name := range h.ComponentOrder {
		schema := h.Components[name]
		var propKeys []string
		propSchemas := make(map[string]any)
		var reqs []string
		seenReqs := make(map[string]bool)
		isCheckable := false

		for _, sub := range orderedComponentSubSchemas(schema) {
			if ref, ok := sub["$ref"].(string); ok && strings.Contains(ref, "Checkable") {
				isCheckable = true
			}
			if subProps, ok := sub["properties"].(map[string]any); ok {
				for _, pk := range OrderedKeys(subProps) {
					if _, seen := propSchemas[pk]; !seen {
						propSchemas[pk] = subProps[pk]
						propKeys = append(propKeys, pk)
					}
				}
			}
			if subReqs, ok := sub["required"].([]any); ok {
				for _, r := range subReqs {
					if rs, ok := r.(string); ok && !seenReqs[rs] {
						seenReqs[rs] = true
						reqs = append(reqs, rs)
					}
				}
			}
		}

		// A catalog may also declare the checks mixin inline: as the v1.0 @checks key,
		// or as a bare checks array of check rules.
		if _, ok := propSchemas["@checks"]; ok || isStandardChecksSchema(propSchemas["checks"]) {
			isCheckable = true
		}
		custom := customEnvelopeProperties(propSchemas)

		// Filter out the structural properties component and id, the @-prefixed v1.0
		// envelope mixin keys, which are not DSL parameters, the bare catalogId,
		// metadata, and accessibility unless the component declares them as its own
		// properties, and checks, which a checkable component lists last.
		excluded := map[string]bool{"component": true, "id": true}
		for _, mixin := range envelope.MixinNames {
			excluded["@"+mixin] = true
			if mixin != "checks" && !custom[mixin] {
				excluded[mixin] = true
			}
		}
		if isCheckable && !custom["checks"] {
			excluded["checks"] = true
		}

		var orderedKeys []string
		for _, k := range propKeys {
			if !excluded[k] {
				orderedKeys = append(orderedKeys, k)
			}
		}

		for _, k := range orderedKeys {
			if enumVal := findEnum(h.PropertySchema(name, k)); len(enumVal) > 0 {
				h.componentPropertyEnums[propEnumKey{comp: name, prop: k}] = enumVal
			}
		}

		// A checkable component lists checks last, once, unless it defines a custom
		// checks property that is not a list of check rules.
		if isCheckable && !custom["checks"] {
			orderedKeys = append(orderedKeys, "checks")
		}

		h.componentProperties[name] = orderedKeys
		h.componentRequired[name] = reqs
		h.componentIsCheckable[name] = isCheckable
		h.componentCustomEnvelope[name] = custom
	}

	for _, name := range h.FunctionOrder {
		schema := h.Functions[name]
		propsList, reqs := functionSignature(schema)
		h.functionProperties[name] = propsList
		h.functionRequired[name] = reqs
	}

	for name, schema := range h.SystemFunctions {
		propsList, reqs := functionSignature(schema)
		h.sysFunctionProperties[name] = propsList
		h.sysFunctionRequired[name] = reqs
	}
}

func (h *CatalogSchemaHelper) functionSchema(name string) map[string]any {
	if s, ok := h.Functions[name]; ok {
		return s
	}
	return h.SystemFunctions[name]
}

// ComponentProperties returns the positional property names for component name.
func (h *CatalogSchemaHelper) ComponentProperties(name string) []string {
	return h.componentProperties[name]
}

// ComponentRequired returns the required property names for component name.
func (h *CatalogSchemaHelper) ComponentRequired(name string) []string {
	return h.componentRequired[name]
}

// IsCheckable reports whether component name supports client-side checks via Checkable.
func (h *CatalogSchemaHelper) IsCheckable(name string) bool {
	return h.componentIsCheckable[name]
}

// CustomEnvelopeProperties returns the envelope mixin names (catalogId, metadata,
// accessibility, checks) that component name declares as its own properties. These
// bare names are ordinary catalog properties of the component, so a v1.0 reader must
// not fall back to them when the @-prefixed envelope key is absent. Callers must not
// modify the returned set.
func (h *CatalogSchemaHelper) CustomEnvelopeProperties(name string) map[string]bool {
	return h.componentCustomEnvelope[name]
}

// FunctionProperties returns the ordered argument names for a catalog or system function.
func (h *CatalogSchemaHelper) FunctionProperties(name string) []string {
	if props, ok := h.functionProperties[name]; ok {
		return props
	}
	return h.sysFunctionProperties[name]
}

// FunctionRequired returns the required argument names for a catalog or system function.
func (h *CatalogSchemaHelper) FunctionRequired(name string) []string {
	if reqs, ok := h.functionRequired[name]; ok {
		return reqs
	}
	return h.sysFunctionRequired[name]
}

// FunctionPropertySchema returns the JSON schema of argument propName on function fnName, or nil.
func (h *CatalogSchemaHelper) FunctionPropertySchema(fnName, propName string) map[string]any {
	fnSchema := h.functionSchema(fnName)
	if fnSchema == nil {
		return nil
	}
	subSchemas := []map[string]any{fnSchema}
	if allOf, ok := fnSchema["allOf"].([]any); ok {
		for _, sub := range allOf {
			if sm, ok := sub.(map[string]any); ok {
				subSchemas = append(subSchemas, sm)
			}
		}
	}
	for _, sub := range subSchemas {
		props, ok := sub["properties"].(map[string]any)
		if !ok {
			continue
		}
		argsObj, ok := props["args"].(map[string]any)
		if !ok {
			continue
		}
		argsProps, ok := argsObj["properties"].(map[string]any)
		if !ok {
			continue
		}
		if res, ok := argsProps[propName].(map[string]any); ok {
			return res
		}
	}
	return nil
}

// PropertyEnum returns the raw enum choices declared for componentName.propertyName, or nil.
func (h *CatalogSchemaHelper) PropertyEnum(componentName, propertyName string) []any {
	return h.componentPropertyEnums[propEnumKey{comp: componentName, prop: propertyName}]
}

// PropertyEnumStrings returns stringified enum choices for componentName.propertyName, or nil.
func (h *CatalogSchemaHelper) PropertyEnumStrings(componentName, propertyName string) []string {
	raw := h.PropertyEnum(componentName, propertyName)
	if len(raw) == 0 {
		return nil
	}
	out := make([]string, len(raw))
	for i, v := range raw {
		out[i] = fmt.Sprint(v)
	}
	return out
}

// ComponentDescription returns the description of component name from its schema, or "".
func (h *CatalogSchemaHelper) ComponentDescription(name string) string {
	schema := h.Components[name]
	if schema == nil {
		return ""
	}
	if desc, ok := schema["description"].(string); ok {
		return desc
	}
	if allOf, ok := schema["allOf"].([]any); ok {
		for _, sub := range allOf {
			if sm, ok := sub.(map[string]any); ok {
				if desc, ok := sm["description"].(string); ok {
					return desc
				}
			}
		}
	}
	return ""
}

// FunctionDescription returns the description of catalog or system function name, or "".
func (h *CatalogSchemaHelper) FunctionDescription(name string) string {
	schema := h.functionSchema(name)
	if schema == nil {
		return ""
	}
	desc, _ := schema["description"].(string)
	return desc
}

// PropertySchema returns the winning JSON schema definition for componentName.propertyName, or nil.
func (h *CatalogSchemaHelper) PropertySchema(componentName, propertyName string) map[string]any {
	schema := h.Components[componentName]
	if schema == nil {
		return nil
	}
	if ownProps, ok := schema["properties"].(map[string]any); ok {
		if raw, exists := ownProps[propertyName]; exists {
			res, _ := raw.(map[string]any)
			return res
		}
	}
	for _, sub := range orderedComponentSubSchemas(schema) {
		if props, ok := sub["properties"].(map[string]any); ok {
			if raw, exists := props[propertyName]; exists {
				res, _ := raw.(map[string]any)
				return res
			}
		}
	}
	return nil
}

// PropertyType resolves the semantic reference type ("ChildList", "Child", "Action") of componentName.propertyName, or "".
func (h *CatalogSchemaHelper) PropertyType(componentName, propertyName string) string {
	pSchema := h.PropertySchema(componentName, propertyName)
	if pSchema == nil {
		return ""
	}
	return SchemaRefType(pSchema)
}

// SchemaRefType inspects schema for $ref to ChildList, Child/ComponentId, or Action.
func SchemaRefType(s map[string]any) string {
	if s == nil {
		return ""
	}
	if ref, ok := s["$ref"].(string); ok {
		if strings.Contains(ref, "ChildList") {
			return "ChildList"
		}
		if strings.Contains(ref, "Child") || strings.Contains(ref, "ComponentId") {
			return "Child"
		}
		if strings.Contains(ref, "Action") {
			return "Action"
		}
	}
	for _, k := range []string{"oneOf", "anyOf", "allOf"} {
		if subs, ok := s[k].([]any); ok {
			for _, sub := range subs {
				if sm, ok := sub.(map[string]any); ok {
					if res := SchemaRefType(sm); res != "" {
						return res
					}
				}
			}
		}
	}
	return ""
}

func (h *CatalogSchemaHelper) lookupCommonDef(defName string) map[string]any {
	if h.CommonTypes == nil {
		return nil
	}
	defs, ok := h.CommonTypes["$defs"].(map[string]any)
	if !ok {
		defs, _ = h.CommonTypes["definitions"].(map[string]any)
	}
	if defs == nil {
		return nil
	}
	res, _ := defs[defName].(map[string]any)
	return res
}

func isJSONNumberVal(v any) bool {
	switch v.(type) {
	case int, int64, int32, float64, float32, uint, uint64:
		return true
	default:
		return false
	}
}

// AcceptsNumber reports whether schema admits a numeric literal, following $ref into catalog and common types.
func (h *CatalogSchemaHelper) AcceptsNumber(schema map[string]any) bool {
	visited := make(map[uintptr]bool)

	var check func(s map[string]any, inCommonTypes bool) bool
	check = func(s map[string]any, inCommonTypes bool) bool {
		if s == nil {
			return false
		}
		ptr := reflect.ValueOf(s).Pointer()
		if ptr != 0 {
			if visited[ptr] {
				return false
			}
			visited[ptr] = true
		}

		switch st := s["type"].(type) {
		case string:
			if st == "number" || st == "integer" {
				return true
			}
		case []any:
			for _, t := range st {
				if ts, ok := t.(string); ok && (ts == "number" || ts == "integer") {
					return true
				}
			}
		}

		if cv, hasConst := s["const"]; hasConst && isJSONNumberVal(cv) {
			return true
		}

		if enumVal, ok := s["enum"].([]any); ok {
			for _, v := range enumVal {
				if isJSONNumberVal(v) {
					return true
				}
			}
		}

		if ref, ok := s["$ref"].(string); ok {
			if defName := CommonDefName(ref); defName != "" {
				resolved := h.lookupCommonDef(defName)
				if resolved == nil || check(resolved, true) {
					return true
				}
			} else if inCommonTypes && (strings.HasPrefix(ref, "#/$defs/") || strings.HasPrefix(ref, "#/definitions/")) {
				name := strings.TrimPrefix(ref, "#/$defs/")
				if strings.HasPrefix(ref, "#/definitions/") {
					name = strings.TrimPrefix(ref, "#/definitions/")
				}
				resolved := h.lookupCommonDef(name)
				if resolved == nil || check(resolved, true) {
					return true
				}
			} else if strings.HasPrefix(ref, "#/") {
				resolvedRaw := resolveJSONPointer(h.CatalogDoc, ref)
				if resolvedRaw == nil {
					return true
				}
				if rm, ok := resolvedRaw.(map[string]any); ok && check(rm, false) {
					return true
				}
			} else if strings.HasPrefix(ref, "catalog.json#/") {
				resolvedRaw := resolveJSONPointer(h.CatalogDoc, ref[len("catalog.json"):])
				if resolvedRaw == nil {
					return true
				}
				if rm, ok := resolvedRaw.(map[string]any); ok && check(rm, false) {
					return true
				}
			} else {
				return true
			}
		}

		for _, key := range []string{"allOf", "oneOf", "anyOf"} {
			if subs, ok := s[key].([]any); ok {
				for _, sub := range subs {
					if sm, ok := sub.(map[string]any); ok && check(sm, inCommonTypes) {
						return true
					}
				}
			}
		}

		typeKeys := []string{
			"type", "const", "enum", "$ref", "allOf", "oneOf", "anyOf",
			"properties", "items", "prefixItems", "not",
		}
		hasAnyTypeKey := false
		for _, k := range typeKeys {
			if _, exists := s[k]; exists {
				hasAnyTypeKey = true
				break
			}
		}
		return !hasAnyTypeKey
	}

	return check(schema, false)
}

// ResolveItemSchema resolves the schema declared for items of an array schema.
func (h *CatalogSchemaHelper) ResolveItemSchema(schema map[string]any) map[string]any {
	return h.resolveAt(schema, nil)
}

// ResolvePropertySchema resolves the schema declared for property name on an object schema.
func (h *CatalogSchemaHelper) ResolvePropertySchema(schema map[string]any, name string) map[string]any {
	return h.resolveAt(schema, &name)
}

func (h *CatalogSchemaHelper) resolveAt(schema map[string]any, prop *string) map[string]any {
	visited := make(map[uintptr]bool)

	var resolve func(s map[string]any, inCommonTypes bool) map[string]any
	resolve = func(s map[string]any, inCommonTypes bool) map[string]any {
		if s == nil {
			return nil
		}
		ptr := reflect.ValueOf(s).Pointer()
		if ptr != 0 {
			if visited[ptr] {
				return nil
			}
			visited[ptr] = true
		}

		if prop == nil {
			if items, ok := s["items"].(map[string]any); ok {
				return items
			}
		} else {
			if props, ok := s["properties"].(map[string]any); ok {
				if declared, ok := props[*prop].(map[string]any); ok {
					return declared
				}
			}
			if additional, ok := s["additionalProperties"].(map[string]any); ok {
				return additional
			}
		}

		if ref, ok := s["$ref"].(string); ok {
			var found map[string]any
			if defName := CommonDefName(ref); defName != "" {
				found = resolve(h.lookupCommonDef(defName), true)
			} else if inCommonTypes && (strings.HasPrefix(ref, "#/$defs/") || strings.HasPrefix(ref, "#/definitions/")) {
				name := strings.TrimPrefix(ref, "#/$defs/")
				if strings.HasPrefix(ref, "#/definitions/") {
					name = strings.TrimPrefix(ref, "#/definitions/")
				}
				found = resolve(h.lookupCommonDef(name), true)
			} else if strings.HasPrefix(ref, "#/") {
				if target, ok := resolveJSONPointer(h.CatalogDoc, ref).(map[string]any); ok {
					found = resolve(target, false)
				}
			}
			if found != nil {
				return found
			}
		}

		for _, combinator := range []string{"allOf", "oneOf", "anyOf"} {
			if subs, ok := s[combinator].([]any); ok {
				for _, sub := range subs {
					if sm, ok := sub.(map[string]any); ok {
						if found := resolve(sm, inCommonTypes); found != nil {
							return found
						}
					}
				}
			}
		}
		return nil
	}

	return resolve(schema, false)
}
