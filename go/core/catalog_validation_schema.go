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
	"regexp"
	"sort"
	"strings"
)

var (
	commonTypeRefPattern = regexp.MustCompile(`^(?:([^#]*common_types\.json))?#/\$defs/([^/]+)(/.*)?$`)
	externalDefRefRe     = regexp.MustCompile(`^[^#]+#/(?:\$defs|definitions)/([^/]+)(/.*)?$`)
	standardMixinRefRe   = regexp.MustCompile(`/(ComponentCommon|Checkable)$`)
)

var refAnnotationKeywords = map[string]bool{
	"description": true,
	"title":       true,
	"default":     true,
	"deprecated":  true,
	"readOnly":    true,
	"writeOnly":   true,
	"examples":    true,
}

var componentEnvelopeKeys = map[string]bool{
	"id":         true,
	"component":  true,
	"catalogId":  true,
	"@catalogId": true,
}

type subSchemaPiece struct {
	schema          map[string]any
	isStandardMixin bool
}

func standardDefsForVersion(ver ProtocolVersion) map[string]any {
	target := Version0_9
	if IsAtLeastVersion(string(ver), Version1_0) {
		target = Version1_0
	}
	commonMap, err := CommonTypesSchemaMap(target)
	if err != nil {
		return map[string]any{}
	}
	defs, _ := commonMap["$defs"].(map[string]any)
	if defs == nil {
		return map[string]any{}
	}
	return defs
}

func buildCatalogValidationSchema(c *Catalog) map[string]any {
	schema := map[string]any{
		"$schema":   jsonSchemaDraft202012,
		"catalogId": c.catalogID,
	}
	if c.declaresProtocolVersion && strings.TrimSpace(c.rawProtocolVersion) != "" {
		schema["protocolVersion"] = stripLeadingVBeforeDigit(strings.TrimSpace(c.rawProtocolVersion))
	}
	if c.instructions != "" {
		schema["instructions"] = c.instructions
	}

	isV10 := IsAtLeastVersion(string(c.protocolVersion), Version1_0)
	isV08 := c.protocolVersion == Version0_8
	standardDefs := standardDefsForVersion(c.protocolVersion)
	authoredDefs := map[string]any{}
	for k, v := range c.defs {
		authoredDefs[k] = v
	}
	rootDoc := map[string]any{"$defs": authoredDefs}

	defs := map[string]any{}

	// 1. Theme
	if len(c.themeSchema) > 0 {
		themeCopy, _ := CloneJSONValue(c.themeSchema).(map[string]any)
		if !isV08 {
			_, hasAdd := themeCopy["additionalProperties"]
			_, hasUneval := themeCopy["unevaluatedProperties"]
			if !hasAdd && !hasUneval {
				themeCopy["additionalProperties"] = true
			}
		}
		defs["theme"] = themeCopy
	}

	// 2. Components
	if len(c.componentOrder) == 0 {
		schema["components"] = map[string]any{}
	} else {
		compsOut := make(map[string]any, len(c.componentOrder))
		anyCompOneOf := make([]any, 0, len(c.componentOrder))
		for _, name := range c.componentOrder {
			comp := c.components[name]
			compsOut[name] = flattenSingleComponent(name, comp, standardDefs, rootDoc, isV10, isV08)
			anyCompOneOf = append(anyCompOneOf, map[string]any{
				"$ref": "#/components/" + escapeJSONPointerToken(name),
			})
		}
		schema["components"] = compsOut
		defs["anyComponent"] = map[string]any{
			"oneOf": anyCompOneOf,
			"discriminator": map[string]any{
				"propertyName": "component",
			},
		}
	}

	// 3. Functions (excluding @-prefixed system functions)
	var fnNames []string
	for _, name := range c.functionOrder {
		if !strings.HasPrefix(name, "@") {
			fnNames = append(fnNames, name)
		}
	}
	if len(fnNames) > 0 {
		fnSnap := c.snapshotFunctions()
		fnsOut := make(map[string]any, len(fnNames))
		anyFnOneOf := make([]any, 0, len(fnNames))
		for _, name := range fnNames {
			fn := fnSnap[name]
			fnsOut[name] = buildSingleFunctionValidationSchema(name, fn, standardDefs, authoredDefs, isV10)
			anyFnOneOf = append(anyFnOneOf, map[string]any{
				"$ref": "#/functions/" + escapeJSONPointerToken(name),
			})
		}
		schema["functions"] = fnsOut
		defs["anyFunction"] = map[string]any{
			"oneOf": anyFnOneOf,
		}
	}

	// 4. Localize external $defs references in schema and defs
	localizeBundleRefs(schema)
	localizeBundleRefs(defs)

	// 5. Fixed-point transitive $defs bundling
	for {
		before := len(defs)
		referenced := map[string]bool{}
		collectLocalDefRefs(schema, referenced)
		collectLocalDefRefs(defs, referenced)

		if referenced["DynamicString"] || referenced["DynamicNumber"] || referenced["DynamicBoolean"] || referenced["DynamicValue"] {
			referenced["DataBinding"] = true
			referenced["FunctionCall"] = true
		}

		refKeys := make([]string, 0, len(referenced))
		for k := range referenced {
			refKeys = append(refKeys, k)
		}
		sort.Strings(refKeys)

		for _, refName := range refKeys {
			if _, exists := defs[refName]; exists {
				continue
			}
			if stdDef, ok := standardDefs[refName]; ok {
				copied := CloneJSONValue(stdDef)
				localizeBundleRefs(copied)
				defs[refName] = copied
			} else if refName != "anyComponent" && refName != "anyFunction" && refName != "theme" {
				if authDef, ok := authoredDefs[refName]; ok {
					copied := CloneJSONValue(authDef)
					restoreSourceRefs(copied, standardDefs, false)
					localizeBundleRefs(copied)
					defs[refName] = copied
				}
			}
		}

		if referenced["anyFunction"] {
			if _, exists := defs["anyFunction"]; !exists {
				defs["anyFunction"] = map[string]any{"not": map[string]any{}}
			}
		}

		if len(defs) == before {
			break
		}
	}

	if len(defs) > 0 {
		schema["$defs"] = defs
	}
	return schema
}

func flattenSingleComponent(
	name string,
	comp ComponentAPI,
	standardDefs map[string]any,
	rootDoc map[string]any,
	isV10 bool,
	isV08 bool,
) map[string]any {
	source := comp.Schema
	if source == nil {
		source = map[string]any{}
	}
	pieces := collectSourceSubSchemas(source, standardDefs, rootDoc, map[string]bool{})

	var description string
	hasDesc := false
	props := map[string]any{}
	ownEnvelopeKeys := map[string]bool{}
	reqSet := map[string]bool{}

	for _, piece := range pieces {
		if !piece.isStandardMixin {
			if d, ok := piece.schema["description"].(string); ok {
				description = d
				hasDesc = true
			}
		}
		if pMap, ok := piece.schema["properties"].(map[string]any); ok {
			for k, v := range pMap {
				props[k] = v
				if !piece.isStandardMixin {
					ownEnvelopeKeys[k] = true
				}
			}
		}
		if reqArr, ok := toStringSlice(piece.schema["required"]); ok {
			for _, r := range reqArr {
				reqSet[r] = true
			}
		}
	}

	isEnvKey := func(k string) bool {
		if !componentEnvelopeKeys[k] {
			return false
		}
		if k == "catalogId" && ownEnvelopeKeys["catalogId"] {
			return false
		}
		return true
	}

	innerProps := map[string]any{}
	idObj := map[string]any{}
	localizeStandardRef(idObj, "ComponentId", standardDefs, "")
	innerProps["id"] = idObj

	for k, v := range props {
		if isEnvKey(k) {
			continue
		}
		copied := CloneJSONValue(v)
		restoreSourceRefs(copied, standardDefs, true)
		innerProps[k] = copied
	}
	innerProps["component"] = map[string]any{"const": name}

	var sortedReq []string
	for r := range reqSet {
		if !isEnvKey(r) {
			sortedReq = append(sortedReq, r)
		}
	}
	sort.Strings(sortedReq)
	innerRequired := make([]any, 0, len(sortedReq)+2)
	innerRequired = append(innerRequired, "id")
	for _, r := range sortedReq {
		innerRequired = append(innerRequired, r)
	}
	innerRequired = append(innerRequired, "component")

	var closure any
	hasClosure := false
	if v, ok := source["unevaluatedProperties"]; ok {
		closure = CloneJSONValue(v)
		hasClosure = true
	} else if v, ok := source["additionalProperties"]; ok {
		closure = CloneJSONValue(v)
		hasClosure = true
	} else if !isV10 && !isV08 {
		closure = false
		hasClosure = true
	}

	out := map[string]any{
		"type":       "object",
		"properties": innerProps,
		"required":   innerRequired,
	}
	if hasDesc {
		out["description"] = description
	}
	if hasClosure {
		out["unevaluatedProperties"] = closure
	}
	if len(comp.AllowedParents) > 0 {
		out["allowedParents"] = stringsToAnySlice(comp.AllowedParents)
	}
	if len(comp.AllowedChildren) > 0 {
		out["allowedChildren"] = stringsToAnySlice(comp.AllowedChildren)
	}
	return out
}

func collectSourceSubSchemas(
	schema map[string]any,
	standardDefs map[string]any,
	rootDoc map[string]any,
	visited map[string]bool,
) []subSchemaPiece {
	var mixins, local, inline []subSchemaPiece
	if allOf, ok := schema["allOf"].([]any); ok {
		for _, rawSub := range allOf {
			sub, ok := rawSub.(map[string]any)
			if !ok {
				continue
			}
			ref, hasRef := sub["$ref"].(string)
			if !hasRef {
				inline = append(inline, collectSourceSubSchemas(sub, standardDefs, rootDoc, visited)...)
				continue
			}
			var mixinName string
			if m := standardMixinRefRe.FindStringSubmatch(ref); len(m) == 2 {
				mixinName = m[1]
			}
			if mixinName == "" && strings.HasPrefix(ref, "#/") {
				if target, ok := queryJSONPointer(rootDoc, ref).(map[string]any); ok {
					if !visited[ref] {
						visited[ref] = true
						local = append(local, collectSourceSubSchemas(target, standardDefs, rootDoc, visited)...)
					}
					continue
				}
			}
			name := mixinName
			if name == "" {
				if m := externalDefRefRe.FindStringSubmatch(ref); len(m) == 3 && m[2] == "" {
					name = m[1]
				}
			}
			if name != "" {
				if stdMixin, ok := standardDefs[name].(map[string]any); ok {
					if stdProps, ok := stdMixin["properties"].(map[string]any); ok {
						pieceSchema := map[string]any{
							"properties": CloneJSONValue(stdProps),
						}
						if stdReq, hasReq := stdMixin["required"]; hasReq {
							pieceSchema["required"] = CloneJSONValue(stdReq)
						}
						mixins = append(mixins, subSchemaPiece{
							schema:          pieceSchema,
							isStandardMixin: true,
						})
					}
				}
			}
		}
	}
	pieces := make([]subSchemaPiece, 0, len(mixins)+len(local)+len(inline)+1)
	pieces = append(pieces, mixins...)
	pieces = append(pieces, local...)
	pieces = append(pieces, inline...)
	_, hasProps := schema["properties"]
	_, hasDesc := schema["description"]
	if hasProps || hasDesc {
		pieces = append(pieces, subSchemaPiece{schema: schema})
	}
	return pieces
}

func buildSingleFunctionValidationSchema(
	name string,
	fn FunctionAPI,
	standardDefs map[string]any,
	authoredDefs map[string]any,
	isV10 bool,
) map[string]any {
	argsSchema := extractAuthoredFunctionArgs(fn.Schema)
	restoreSourceRefs(argsSchema, standardDefs, false)
	if argsSchema["type"] == "object" {
		additional, hasAdd := argsSchema["additionalProperties"]
		delete(argsSchema, "additionalProperties")
		if _, hasUneval := argsSchema["unevaluatedProperties"]; !hasUneval {
			if hasAdd {
				argsSchema["unevaluatedProperties"] = additional
			} else {
				argsSchema["unevaluatedProperties"] = false
			}
		}
	}

	hasReqArgs := schemaRequiresArgs(argsSchema, authoredDefs, map[string]bool{})
	callKey := "call"
	if isV10 {
		callKey = "@call"
	}
	req := []any{callKey}
	if hasReqArgs {
		req = []any{callKey, "args"}
	}

	retType := string(fn.ReturnType)
	if retType == "" {
		retType = string(ReturnTypeAny)
	}

	if isV10 {
		out := map[string]any{
			"type":       "object",
			"returnType": retType,
			"properties": map[string]any{
				"@call": map[string]any{"const": name},
				"args":  argsSchema,
			},
			"required": req,
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
			"args":       argsSchema,
			"returnType": map[string]any{"const": retType},
		},
		"required":              req,
		"unevaluatedProperties": false,
	}
	if fn.Description != "" {
		out["description"] = fn.Description
	}
	return out
}

func extractAuthoredFunctionArgs(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	props, hasProps := source["properties"].(map[string]any)
	var explicit any
	hasExplicit := false
	if hasProps {
		if a, ok := props["args"]; ok {
			explicit = a
			hasExplicit = true
		}
	}
	if !hasExplicit {
		if a, ok := source["args"]; ok {
			explicit = a
			hasExplicit = true
		} else if p, ok := source["parameters"]; ok {
			explicit = p
			hasExplicit = true
		}
	}
	if hasExplicit {
		expMap, ok := explicit.(map[string]any)
		if !ok {
			return map[string]any{}
		}
		if isShorthandParamMap(expMap) {
			wrapped := map[string]any{
				"type":       "object",
				"properties": CloneJSONValue(expMap),
			}
			if r, ok := source["required"]; ok {
				wrapped["required"] = CloneJSONValue(r)
			}
			if ap, ok := source["additionalProperties"]; ok {
				wrapped["additionalProperties"] = CloneJSONValue(ap)
			}
			return wrapped
		}
		copied, _ := CloneJSONValue(expMap).(map[string]any)
		return copied
	}
	isCallSchema := hasProps && (hasKey(props, "call") || hasKey(props, "@call") || hasKey(props, "function"))
	if isCallSchema {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	out := map[string]any{}
	for k, v := range source {
		switch k {
		case "description", "title", "name", "returnType", "allowedCallers", "requiresUserActivation":
			continue
		default:
			out[k] = CloneJSONValue(v)
		}
	}
	if len(out) == 0 {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	return out
}

var jsonSchemaStructuralKeys = map[string]bool{
	"type": true, "properties": true, "required": true, "additionalProperties": true,
	"unevaluatedProperties": true, "$ref": true, "allOf": true, "anyOf": true,
	"oneOf": true, "not": true, "enum": true, "const": true, "patternProperties": true,
}

func isShorthandParamMap(m map[string]any) bool {
	if len(m) == 0 {
		return false
	}
	for k, v := range m {
		if jsonSchemaStructuralKeys[k] {
			return false
		}
		_, isMap := v.(map[string]any)
		_, isBool := v.(bool)
		if !isMap && !isBool {
			return false
		}
	}
	return true
}

func schemaRequiresArgs(node map[string]any, defs map[string]any, seen map[string]bool) bool {
	if node == nil {
		return false
	}
	if req, ok := toStringSlice(node["required"]); ok && len(req) > 0 {
		return true
	}
	if ref, ok := node["$ref"].(string); ok && strings.HasPrefix(ref, "#/$defs/") && !seen[ref] {
		seen[ref] = true
		defName := unescapeJSONPointerToken(strings.Split(ref[len("#/$defs/"):], "/")[0])
		if target, ok := defs[defName].(map[string]any); ok {
			if schemaRequiresArgs(target, defs, seen) {
				return true
			}
		}
	}
	if allOf, ok := node["allOf"].([]any); ok {
		for _, item := range allOf {
			if m, ok := item.(map[string]any); ok && schemaRequiresArgs(m, defs, seen) {
				return true
			}
		}
	}
	for _, comb := range []string{"oneOf", "anyOf"} {
		if branches, ok := node[comb].([]any); ok && len(branches) > 0 {
			allReq := true
			for _, item := range branches {
				m, ok := item.(map[string]any)
				if !ok || !schemaRequiresArgs(m, defs, seen) {
					allReq = false
					break
				}
			}
			if allReq {
				return true
			}
		}
	}
	return false
}

func localizeStandardRef(node map[string]any, name string, standardDefs map[string]any, pointer string) {
	node["$ref"] = "#/$defs/" + name + pointer
	if pointer != "" {
		return
	}
	if _, hasDesc := node["description"]; hasDesc {
		return
	}
	if def, ok := standardDefs[name].(map[string]any); ok {
		if desc, ok := def["description"].(string); ok {
			node["description"] = desc
		}
	}
}

func restoreSourceRefs(node any, standardDefs map[string]any, annotationsOnly bool) {
	switch typed := node.(type) {
	case []any:
		for _, item := range typed {
			restoreSourceRefs(item, standardDefs, annotationsOnly)
		}
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok {
			if m := commonTypeRefPattern.FindStringSubmatch(ref); len(m) == 4 {
				doc, name, ptr := m[1], m[2], m[3]
				_, inStd := standardDefs[name]
				if doc != "" || inStd {
					if annotationsOnly {
						for k := range typed {
							if k != "$ref" && !refAnnotationKeywords[k] {
								delete(typed, k)
							}
						}
						localizeStandardRef(typed, name, standardDefs, ptr)
						return
					}
					localizeStandardRef(typed, name, standardDefs, ptr)
				}
			}
		}
		for _, v := range typed {
			restoreSourceRefs(v, standardDefs, annotationsOnly)
		}
	}
}

func localizeBundleRefs(node any) {
	switch typed := node.(type) {
	case []any:
		for _, item := range typed {
			localizeBundleRefs(item)
		}
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok && !strings.HasPrefix(ref, "#") {
			if m := externalDefRefRe.FindStringSubmatch(ref); len(m) == 3 {
				typed["$ref"] = "#/$defs/" + m[1] + m[2]
			}
		}
		for _, v := range typed {
			localizeBundleRefs(v)
		}
	}
}

func collectLocalDefRefs(node any, out map[string]bool) {
	switch typed := node.(type) {
	case []any:
		for _, item := range typed {
			collectLocalDefRefs(item, out)
		}
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok && strings.HasPrefix(ref, "#/$defs/") {
			seg := strings.Split(ref[len("#/$defs/"):], "/")[0]
			out[unescapeJSONPointerToken(seg)] = true
		}
		for _, v := range typed {
			collectLocalDefRefs(v, out)
		}
	}
}

func stripLeadingVBeforeDigit(s string) string {
	if len(s) >= 2 && (s[0] == 'v' || s[0] == 'V') && s[1] >= '0' && s[1] <= '9' {
		return s[1:]
	}
	return s
}

func hasKey(m map[string]any, k string) bool {
	_, ok := m[k]
	return ok
}

func toStringSlice(v any) ([]string, bool) {
	switch s := v.(type) {
	case []string:
		return append([]string(nil), s...), true
	case []any:
		out := make([]string, 0, len(s))
		for _, item := range s {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		return out, true
	}
	return nil, false
}

func stringsToAnySlice(s []string) []any {
	out := make([]any, len(s))
	for i, item := range s {
		out[i] = item
	}
	return out
}
