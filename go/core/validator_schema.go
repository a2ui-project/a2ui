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
	"regexp"
	"strings"
)

// Helpers for envelope & error rebasing

func componentEnvelopeKeysFor(atLeastV10 bool) []string {
	if atLeastV10 {
		return []string{"id", "component", "catalogId", "metadata"}
	}
	return []string{"id", "component"}
}

func schemaDeclaresProperty(schema any, propName string) bool {
	m, ok := schema.(map[string]any)
	if !ok {
		return false
	}
	if hasKey(m, "$ref") {
		return true
	}
	if props, ok := m["properties"].(map[string]any); ok && hasKey(props, propName) {
		return true
	}
	for _, comb := range []string{"allOf", "anyOf", "oneOf"} {
		if arr, ok := m[comb].([]any); ok {
			for _, sub := range arr {
				if schemaDeclaresProperty(sub, propName) {
					return true
				}
			}
		}
	}
	return false
}

func getDeclaredComponentProperties(cat *Catalog, compType string) map[string]bool {
	out := map[string]bool{}
	if cat == nil || compType == "" {
		return out
	}
	resolved := cat.ResolvedComponentSchema(compType)
	if resolved == nil {
		return out
	}
	var walk func(s any)
	walk = func(s any) {
		m, ok := s.(map[string]any)
		if !ok {
			return
		}
		if props, ok := m["properties"].(map[string]any); ok {
			for k := range props {
				out[k] = true
			}
		}
		for _, comb := range []string{"allOf", "anyOf", "oneOf"} {
			if arr, ok := m[comb].([]any); ok {
				for _, sub := range arr {
					walk(sub)
				}
			}
		}
	}
	walk(resolved)
	return out
}

// CustomEnvelopeProperties returns which of catalogId, metadata, accessibility, and checks
// componentType declares as its own properties rather than inheriting them from the
// ComponentCommon or Checkable mixins. On a v1.0 surface, a bare key that is not custom is
// read as the legacy form of its @-prefixed envelope mixin.
func (c *Catalog) CustomEnvelopeProperties(componentType string) map[string]bool {
	return getCustomEnvelopeProperties(c, componentType, true)
}

func getCustomEnvelopeProperties(cat *Catalog, compType string, atLeastV10 bool) map[string]bool {
	out := map[string]bool{}
	if !atLeastV10 || cat == nil || compType == "" {
		return out
	}
	comp, ok := cat.components[compType]
	if !ok || comp.Schema == nil {
		return out
	}
	// Walk every properties block the component declares, following local $refs (other than the
	// standard ComponentCommon/Checkable mixins) and allOf/anyOf/oneOf branches.
	visited := map[string]bool{}
	var walk func(s map[string]any)
	walk = func(s map[string]any) {
		if s == nil {
			return
		}
		if props, ok := s["properties"].(map[string]any); ok {
			hasInlineID := hasKey(props, "id")
			for _, candidate := range []string{"metadata", "catalogId", "accessibility", "checks"} {
				if pSchema, exists := props[candidate]; exists && !isStandardMixinPropShape(candidate, pSchema, hasInlineID) {
					out[candidate] = true
				}
			}
		}
		if ref, ok := s["$ref"].(string); ok {
			if defName := localDefRefName(ref); defName != "" && defName != "ComponentCommon" && defName != "Checkable" && !visited[defName] {
				if def, ok := cat.defs[defName].(map[string]any); ok {
					visited[defName] = true
					walk(def)
				}
			}
		}
		for _, comb := range []string{"allOf", "anyOf", "oneOf"} {
			if branches, ok := s[comb].([]any); ok {
				for _, b := range branches {
					if bm, ok := b.(map[string]any); ok {
						walk(bm)
					}
				}
			}
		}
	}
	walk(comp.Schema)
	return out
}

// localDefRefName returns the $defs entry name a reference points into, or "" if it points elsewhere.
func localDefRefName(ref string) string {
	idx := strings.Index(ref, "#/$defs/")
	if idx < 0 {
		return ""
	}
	rest := ref[idx+len("#/$defs/"):]
	if slash := strings.IndexByte(rest, '/'); slash >= 0 {
		rest = rest[:slash]
	}
	return unescapeJSONPointerToken(rest)
}

// isStandardMixinPropShape reports whether propSchema is the standard ComponentCommon/Checkable schema for name.
// A bare catalogId or metadata declared inline is the standard mixin only beside an inline id and in the standard shape.
func isStandardMixinPropShape(name string, propSchema any, hasInlineID bool) bool {
	pm, ok := propSchema.(map[string]any)
	if !ok {
		return false
	}
	ref, _ := pm["$ref"].(string)
	switch name {
	case "accessibility":
		return strings.HasSuffix(ref, "/AccessibilityAttributes")
	case "checks":
		if strings.HasSuffix(ref, "/Checkable") {
			return true
		}
		items, _ := pm["items"].(map[string]any)
		itemRef, _ := items["$ref"].(string)
		return strings.HasSuffix(itemRef, "/CheckRule")
	case "catalogId":
		return hasInlineID && pm["type"] == "string"
	case "metadata":
		if strings.HasSuffix(ref, "/ComponentCommonMetadata") {
			return true
		}
		mp, ok := pm["properties"].(map[string]any)
		return hasInlineID && pm["type"] == "object" && ok && len(mp) == 1 && hasKey(mp, "extensions")
	}
	return false
}

func isComponentCheckable(cat *Catalog, compType string) bool {
	if cat == nil || compType == "" {
		return false
	}
	comp, ok := cat.components[compType]
	if !ok || comp.Schema == nil {
		return false
	}
	var walk func(node any) bool
	walk = func(node any) bool {
		m, ok := node.(map[string]any)
		if !ok {
			return false
		}
		if ref, ok := m["$ref"].(string); ok && strings.HasSuffix(ref, "/Checkable") {
			return true
		}
		if props, ok := m["properties"].(map[string]any); ok && (hasKey(props, "checks") || hasKey(props, "@checks")) {
			return true
		}
		if allOf, ok := m["allOf"].([]any); ok {
			for _, sub := range allOf {
				if walk(sub) {
					return true
				}
			}
		}
		return false
	}
	if walk(comp.Schema) {
		return true
	}
	valSchema := cat.validationSchema()
	if cm, ok := valSchema["components"].(map[string]any); ok {
		if cs, ok := cm[compType].(map[string]any); ok {
			if props, ok := cs["properties"].(map[string]any); ok && (hasKey(props, "checks") || hasKey(props, "@checks")) {
				return true
			}
		}
	}
	return false
}

func rebaseFunctionErrorDetails(ve *ValidationError, fnName, callPath, fallbackCode string) []ErrorDetail {
	fnPrefix := "functions." + fnName
	details := ve.Details
	if len(details) == 0 {
		details = []ErrorDetail{{Path: fnPrefix, Code: fallbackCode, Message: ve.Error()}}
	}
	out := make([]ErrorDetail, 0, len(details))
	for _, d := range details {
		var dp string
		if d.Path == fnPrefix {
			dp = callPath
		} else if strings.HasPrefix(d.Path, fnPrefix+".") {
			dp = callPath + ".args" + d.Path[len(fnPrefix):]
		} else if d.Path == "" {
			dp = callPath
		} else {
			dp = callPath + "." + d.Path
		}
		out = append(out, ErrorDetail{
			Path:      dp,
			Code:      d.Code,
			Message:   d.Message,
			SurfaceID: d.SurfaceID,
		})
	}
	return out
}

var (
	missingFieldMsgRe = regexp.MustCompile(`^'([^']+)' is a required property`)
	extraFieldMsgRe   = regexp.MustCompile(`\('([^']+)' was unexpected\)`)
)

func extractDetailErrorPath(d ErrorDetail) string {
	dp := d.Path
	if d.Code == "missing_field" {
		if m := missingFieldMsgRe.FindStringSubmatch(d.Message); len(m) == 2 {
			if dp != "" {
				return dp + "." + m[1]
			}
			return m[1]
		}
	} else if d.Code == "extra_field" {
		if m := extraFieldMsgRe.FindStringSubmatch(d.Message); len(m) == 2 {
			if dp != "" {
				return dp + "." + m[1]
			}
			return m[1]
		}
	}
	return dp
}

func resolveComponentErrorPath(d ErrorDetail, compID string, index *int) string {
	dp := extractDetailErrorPath(d)
	compKey := compID
	if compKey == "" {
		compKey = "unknown"
	}
	prefix := "components." + compKey
	if index != nil {
		if dp == prefix {
			return fmt.Sprintf("/components/%d", *index)
		}
		if strings.HasPrefix(dp, prefix+".") {
			rest := dp[len(prefix)+1:]
			return toJSONPointer(fmt.Sprintf("components.%d.%s", *index, rest))
		}
	}
	return toJSONPointer(dp)
}

func raiseComponentValidationErrors(errors []ErrorDetail, compID string, index *int, surfaceID string) *ValidationError {
	if surfaceID != "" {
		for i := range errors {
			if errors[i].SurfaceID == "" {
				errors[i].SurfaceID = surfaceID
			}
		}
	}
	var lines []string
	for _, d := range errors {
		lines = append(lines, fmt.Sprintf("%s: %s", d.Path, d.Message))
	}
	ve := NewValidationError(strings.Join(lines, "\n"), errors...)
	ve.Path = resolveComponentErrorPath(errors[0], compID, index)
	ve.SurfaceID = surfaceID
	return ve
}

var bracketIndexRe = regexp.MustCompile(`\[(\d+)\]`)

func toJSONPointer(dotPath string) string {
	if dotPath == "" {
		return ""
	}
	if strings.HasPrefix(dotPath, "/") {
		return dotPath
	}
	norm := bracketIndexRe.ReplaceAllString(dotPath, ".$1")
	parts := strings.Split(norm, ".")
	var escaped []string
	for _, p := range parts {
		if p == "" {
			continue
		}
		escaped = append(escaped, escapeJSONPointerToken(p))
	}
	if len(escaped) == 0 {
		return "/"
	}
	return "/" + strings.Join(escaped, "/")
}

func applyObjectDefaults(target map[string]any, schema map[string]any, defs map[string]any, visited map[string]bool) {
	if target == nil || schema == nil {
		return
	}
	if ref, ok := schema["$ref"].(string); ok && !visited[ref] {
		next := copyBoolMap(visited)
		next[ref] = true
		if resolved := resolveLocalDefMap(ref, defs); resolved != nil {
			applyObjectDefaults(target, resolved, defs, next)
		}
	}
	if allOf, ok := schema["allOf"].([]any); ok {
		for _, b := range allOf {
			if bm, ok := b.(map[string]any); ok {
				applyObjectDefaults(target, bm, defs, visited)
			}
		}
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		return
	}
	for propName, rawSpec := range props {
		spec, ok := rawSpec.(map[string]any)
		if !ok {
			continue
		}
		if !hasKey(target, propName) {
			if defVal, hasDef := extractPropertyDefault(spec, defs, map[string]bool{}); hasDef {
				target[propName] = CloneJSONValue(defVal)
			}
		}
		if subTarget, ok := target[propName].(map[string]any); ok {
			applyObjectDefaults(subTarget, spec, defs, visited)
		}
	}
}

func extractPropertyDefault(spec map[string]any, defs map[string]any, visited map[string]bool) (any, bool) {
	if def, ok := spec["default"]; ok {
		return def, true
	}
	if ref, ok := spec["$ref"].(string); ok && !visited[ref] {
		visited[ref] = true
		if resolved := resolveLocalDefMap(ref, defs); resolved != nil {
			if d, ok := extractPropertyDefault(resolved, defs, visited); ok {
				return d, true
			}
		}
	}
	if allOf, ok := spec["allOf"].([]any); ok {
		for _, b := range allOf {
			if bm, ok := b.(map[string]any); ok {
				if d, ok := extractPropertyDefault(bm, defs, visited); ok {
					return d, true
				}
			}
		}
	}
	return nil, false
}

func resolveLocalDefMap(ref string, defs map[string]any) map[string]any {
	if !strings.HasPrefix(ref, "#/$defs/") || defs == nil {
		return nil
	}
	parts := strings.Split(ref[len("#/$defs/"):], "/")
	cur := defs[unescapeJSONPointerToken(parts[0])]
	for _, p := range parts[1:] {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[unescapeJSONPointerToken(p)]
	}
	res, _ := cur.(map[string]any)
	return res
}

func copyBoolMap(m map[string]bool) map[string]bool {
	out := make(map[string]bool, len(m)+1)
	for k, v := range m {
		out[k] = v
	}
	return out
}
