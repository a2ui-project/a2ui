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
	"sort"
	"strings"
)

// ChildReference represents an extracted structural child component reference and its property path.
type ChildReference struct {
	ID   string
	Path string
}

// IsChildProp reports whether key is a declared single or list child reference property.
func (s ComponentRefSpec) IsChildProp(key string) bool {
	for _, k := range s.SingleRefs {
		if k == key {
			return true
		}
	}
	for _, k := range s.ListRefs {
		if k == key {
			return true
		}
	}
	return false
}

// ExtractChildReferences extracts all (componentID, propertyPath) pairs from props according to s.
func (s ComponentRefSpec) ExtractChildReferences(props map[string]any) []ChildReference {
	if len(props) == 0 {
		return nil
	}
	var out []ChildReference
	for _, key := range s.SingleRefs {
		val, ok := props[key]
		if !ok {
			continue
		}
		for _, sub := range extractChildRefsFromValue(val) {
			full := key
			if sub.Path != "" {
				full = key + "." + sub.Path
			}
			out = append(out, ChildReference{ID: sub.ID, Path: full})
		}
	}
	for _, key := range s.ListRefs {
		val, ok := props[key]
		if !ok {
			continue
		}
		switch typed := val.(type) {
		case []any:
			nestedKeys := s.NestedSingleRefs[key]
			for idx, item := range typed {
				switch elem := item.(type) {
				case string:
					if elem != "" {
						out = append(out, ChildReference{ID: elem, Path: fmt.Sprintf("%s[%d]", key, idx)})
					}
				case map[string]any:
					if cid, ok := elem["componentId"].(string); ok && cid != "" {
						out = append(out, ChildReference{
							ID:   cid,
							Path: fmt.Sprintf("%s[%d].componentId", key, idx),
						})
					} else if len(nestedKeys) > 0 {
						for _, subK := range nestedKeys {
							subVal, exists := elem[subK]
							if !exists {
								continue
							}
							for _, sub := range extractChildRefsFromValue(subVal) {
								prefix := fmt.Sprintf("%s[%d].%s", key, idx, subK)
								full := prefix
								if strings.HasPrefix(sub.Path, "[") {
									full = prefix + sub.Path
								} else if sub.Path != "" {
									full = prefix + "." + sub.Path
								}
								out = append(out, ChildReference{ID: sub.ID, Path: full})
							}
						}
					} else {
						for _, sub := range extractChildRefsFromValue(elem) {
							full := fmt.Sprintf("%s[%d]", key, idx)
							if sub.Path != "" {
								full = full + "." + sub.Path
							}
							out = append(out, ChildReference{ID: sub.ID, Path: full})
						}
					}
				}
			}
		case []string:
			for idx, elem := range typed {
				if elem != "" {
					out = append(out, ChildReference{ID: elem, Path: fmt.Sprintf("%s[%d]", key, idx)})
				}
			}
		case string:
			if typed != "" {
				out = append(out, ChildReference{ID: typed, Path: key})
			}
		case map[string]any:
			if cid, ok := typed["componentId"].(string); ok && cid != "" {
				out = append(out, ChildReference{ID: cid, Path: key + ".componentId"})
			} else {
				for _, sub := range extractChildRefsFromValue(typed) {
					full := key
					if sub.Path != "" {
						full = key + "." + sub.Path
					}
					out = append(out, ChildReference{ID: sub.ID, Path: full})
				}
			}
		}
	}
	return out
}

func extractChildRefsFromValue(val any) []ChildReference {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case string:
		if v != "" {
			return []ChildReference{{ID: v, Path: ""}}
		}
	case []string:
		var out []ChildReference
		for idx, item := range v {
			if item != "" {
				out = append(out, ChildReference{ID: item, Path: fmt.Sprintf("[%d]", idx)})
			}
		}
		return out
	case []any:
		var out []ChildReference
		for idx, item := range v {
			for _, sub := range extractChildRefsFromValue(item) {
				p := fmt.Sprintf("[%d]", idx)
				if sub.Path != "" {
					p = p + "." + sub.Path
				}
				out = append(out, ChildReference{ID: sub.ID, Path: p})
			}
		}
		return out
	case map[string]any:
		if cid, ok := v["componentId"].(string); ok && cid != "" {
			return []ChildReference{{ID: cid, Path: "componentId"}}
		}
		if ch, ok := v["child"].(string); ok && ch != "" {
			return []ChildReference{{ID: ch, Path: "child"}}
		}
		// Sort keys for deterministic extraction when traversing unknown nested maps.
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var out []ChildReference
		for _, k := range keys {
			for _, sub := range extractChildRefsFromValue(v[k]) {
				p := k
				if sub.Path != "" {
					p = k + "." + sub.Path
				}
				out = append(out, ChildReference{ID: sub.ID, Path: p})
			}
		}
		return out
	}
	return nil
}

func isSingleChildRefURI(ref string) bool {
	return strings.HasSuffix(ref, "/ComponentId") ||
		strings.HasSuffix(ref, "/Child") ||
		strings.HasSuffix(ref, "/ChildComponentId")
}

func isChildListRefURI(ref string) bool {
	return strings.HasSuffix(ref, "/ChildList") ||
		strings.HasSuffix(ref, "/TemplateChildList") ||
		strings.HasSuffix(ref, "/ChildrenItem") ||
		strings.HasSuffix(ref, "/TemplateItem")
}

func isSingleChildJSONSchema(schema any) bool {
	m, ok := schema.(map[string]any)
	if !ok {
		return false
	}
	if ref, ok := m["$ref"].(string); ok && isSingleChildRefURI(ref) {
		return true
	}
	for _, comb := range []string{"allOf", "oneOf", "anyOf"} {
		if arr, ok := m[comb].([]any); ok {
			for _, sub := range arr {
				if isSingleChildJSONSchema(sub) {
					return true
				}
			}
		}
	}
	return false
}

func isChildListJSONSchema(schema any) bool {
	m, ok := schema.(map[string]any)
	if !ok {
		return false
	}
	if ref, ok := m["$ref"].(string); ok && isChildListRefURI(ref) {
		return true
	}
	for _, comb := range []string{"allOf", "oneOf", "anyOf"} {
		if arr, ok := m[comb].([]any); ok {
			for _, sub := range arr {
				if isChildListJSONSchema(sub) {
					return true
				}
			}
		}
	}
	if props, ok := m["properties"].(map[string]any); ok {
		if _, hasExp := props["explicitList"]; hasExp {
			return true
		}
		if _, hasTpl := props["template"]; hasTpl {
			return true
		}
		if _, hasCID := props["componentId"]; hasCID {
			_, hasPath := props["path"]
			_, hasDB := props["dataBinding"]
			if hasPath || hasDB {
				return true
			}
		}
	}
	return false
}

func resolveRefForAnalysis(ref string, localSchema, catalogSchema map[string]any, visited map[string]bool) map[string]any {
	if !strings.HasPrefix(ref, "#/") {
		return nil
	}
	if visited[ref] {
		return nil
	}
	visited[ref] = true
	parts := strings.Split(ref[2:], "/")
	for i := range parts {
		parts[i] = unescapeJSONPointerToken(parts[i])
	}
	if len(parts) > 1 && parts[0] == "$defs" && localSchema != nil {
		if defs, ok := localSchema["$defs"].(map[string]any); ok {
			cur := any(defs)
			for _, p := range parts[1:] {
				m, ok := cur.(map[string]any)
				if !ok {
					cur = nil
					break
				}
				cur = m[p]
			}
			if res, ok := cur.(map[string]any); ok {
				return res
			}
		}
	}
	if catalogSchema != nil {
		cur := any(catalogSchema)
		for _, p := range parts {
			m, ok := cur.(map[string]any)
			if !ok {
				cur = nil
				break
			}
			cur = m[p]
		}
		if res, ok := cur.(map[string]any); ok {
			return res
		}
	}
	return nil
}

// analyzeChildRefSchema inspects a component's JSON Schema and returns its ComponentRefSpec.
func analyzeChildRefSchema(schema map[string]any, catalogSchema map[string]any) ComponentRefSpec {
	if schema == nil {
		return ComponentRefSpec{}
	}
	singleSet := map[string]bool{}
	listSet := map[string]bool{}
	nestedMap := map[string]map[string]bool{}

	var inspect func(sub map[string]any, visited map[string]bool)
	inspect = func(sub map[string]any, visited map[string]bool) {
		if sub == nil {
			return
		}
		for _, comb := range []string{"allOf", "anyOf", "oneOf"} {
			if arr, ok := sub[comb].([]any); ok {
				for _, b := range arr {
					if bm, ok := b.(map[string]any); ok {
						inspect(bm, visited)
					}
				}
			}
		}
		if ref, ok := sub["$ref"].(string); ok {
			if resolved := resolveRefForAnalysis(ref, schema, catalogSchema, visited); resolved != nil {
				inspect(resolved, visited)
			}
		}
		props, ok := sub["properties"].(map[string]any)
		if !ok {
			return
		}
		for propName, rawPropSchema := range props {
			if propName == "id" || propName == "component" {
				continue
			}
			if isSingleChildJSONSchema(rawPropSchema) {
				singleSet[propName] = true
				continue
			}
			if isChildListJSONSchema(rawPropSchema) {
				listSet[propName] = true
				continue
			}
			target, ok := rawPropSchema.(map[string]any)
			if !ok {
				continue
			}
			if ref, ok := target["$ref"].(string); ok {
				if resolved := resolveRefForAnalysis(ref, schema, catalogSchema, map[string]bool{}); resolved != nil {
					target = resolved
				}
			}
			_, hasItems := target["items"]
			if target["type"] == "array" || hasItems {
				items, ok := target["items"].(map[string]any)
				if !ok {
					continue
				}
				if isSingleChildJSONSchema(items) || isChildListJSONSchema(items) {
					listSet[propName] = true
					continue
				}
				if ref, ok := items["$ref"].(string); ok {
					if resolvedItems := resolveRefForAnalysis(ref, schema, catalogSchema, map[string]bool{}); resolvedItems != nil {
						items = resolvedItems
					}
				}
				if isSingleChildJSONSchema(items) || isChildListJSONSchema(items) {
					listSet[propName] = true
					continue
				}
				if itemProps, ok := items["properties"].(map[string]any); ok {
					for subK, subSchema := range itemProps {
						if isSingleChildJSONSchema(subSchema) || isChildListJSONSchema(subSchema) {
							listSet[propName] = true
							if nestedMap[propName] == nil {
								nestedMap[propName] = map[string]bool{}
							}
							nestedMap[propName][subK] = true
						}
					}
				}
			}
		}
	}

	inspect(schema, map[string]bool{})

	spec := ComponentRefSpec{}
	for k := range singleSet {
		spec.SingleRefs = append(spec.SingleRefs, k)
	}
	sort.Strings(spec.SingleRefs)
	for k := range listSet {
		spec.ListRefs = append(spec.ListRefs, k)
	}
	sort.Strings(spec.ListRefs)
	if len(nestedMap) > 0 {
		spec.NestedSingleRefs = make(map[string][]string, len(nestedMap))
		for k, subSet := range nestedMap {
			var list []string
			for subK := range subSet {
				list = append(list, subK)
			}
			sort.Strings(list)
			spec.NestedSingleRefs[k] = list
		}
	}
	return spec
}

func buildCatalogRefMap(c *Catalog) map[string]ComponentRefSpec {
	out := make(map[string]ComponentRefSpec, len(c.components))
	valSchema := c.validationSchema()
	for _, name := range c.componentOrder {
		resolved := c.ResolvedComponentSchema(name)
		if resolved == nil {
			resolved = c.components[name].Schema
		}
		out[name] = analyzeChildRefSchema(resolved, valSchema)
	}
	// v0.8 catalogs lack formal $ref annotations on child properties; populate known v0.8 basic layout slots if empty.
	if c.protocolVersion == Version0_8 {
		for name, spec := range out {
			if len(spec.SingleRefs) > 0 || len(spec.ListRefs) > 0 {
				continue
			}
			comp := c.components[name]
			props, _ := comp.Schema["properties"].(map[string]any)
			if len(props) == 0 {
				continue
			}
			updated := spec
			for propName, rawP := range props {
				pm, _ := rawP.(map[string]any)
				switch propName {
				case "child", "contentChild", "entryPointChild":
					updated.SingleRefs = append(updated.SingleRefs, propName)
				case "children":
					updated.ListRefs = append(updated.ListRefs, propName)
				case "tabItems":
					if items, ok := pm["items"].(map[string]any); ok {
						if ip, ok := items["properties"].(map[string]any); ok {
							if _, hasChild := ip["child"]; hasChild {
								updated.ListRefs = append(updated.ListRefs, propName)
								if updated.NestedSingleRefs == nil {
									updated.NestedSingleRefs = map[string][]string{}
								}
								updated.NestedSingleRefs[propName] = []string{"child"}
							}
						}
					}
				}
			}
			sort.Strings(updated.SingleRefs)
			sort.Strings(updated.ListRefs)
			out[name] = updated
		}
	}
	return out
}
