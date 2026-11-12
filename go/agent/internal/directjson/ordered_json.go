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

package directjson

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

const (
	defsRefPrefix       = "#/$defs/"
	propertiesRefPrefix = "#/properties/"
)

// ExtractKeyOrder extracts RFC 6901 JSON Pointer -> ordered object keys from raw JSON bytes.
func ExtractKeyOrder(data []byte) (map[string][]string, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	order := make(map[string][]string)
	if err := walkTokens(dec, "", order); err != nil {
		return nil, err
	}
	return order, nil
}

// parseJSONObject decodes a JSON object with core.ParseJSON, which keeps integers and floats apart.
func parseJSONObject(data []byte) (map[string]any, error) {
	parsed, err := core.ParseJSON(data)
	if err != nil {
		return nil, err
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected a JSON object, got %T", parsed)
	}
	return obj, nil
}

func walkTokens(dec *json.Decoder, pointer string, order map[string][]string) error {
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
			kStr, ok := kTok.(string)
			if !ok {
				return fmt.Errorf("expected string key")
			}
			keys = append(keys, kStr)
			escaped := escapePtr(kStr)
			if err := walkTokens(dec, pointer+"/"+escaped, order); err != nil {
				return err
			}
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
		order[pointer] = keys
	case '[':
		idx := 0
		for dec.More() {
			if err := walkTokens(dec, fmt.Sprintf("%s/%d", pointer, idx), order); err != nil {
				return err
			}
			idx++
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
	}
	return nil
}

func escapePtr(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

// PruneMessagesSchema parses rawA2R, prunes it to allowedMessages (when non-nil),
// and returns both the pruned map and its authored keyOrder map.
func PruneMessagesSchema(
	rawA2R []byte,
	pv core.ProtocolVersion,
	allowedMessages []string,
	hasAllowed bool,
) (map[string]any, map[string][]string, error) {
	schema, err := parseJSONObject(rawA2R)
	if err != nil {
		return nil, nil, err
	}
	keyOrder, err := ExtractKeyOrder(rawA2R)
	if err != nil {
		return nil, nil, err
	}
	if !hasAllowed {
		return schema, keyOrder, nil
	}

	allowed := make(map[string]bool, len(allowedMessages))
	for _, m := range allowedMessages {
		allowed[m] = true
	}

	if pv == core.Version0_8 {
		if props, ok := schema["properties"].(map[string]any); ok {
			schema["properties"] = reachableDefs(props, allowed, propertiesRefPrefix)
		}
		return schema, keyOrder, nil
	}

	allowedDefs := make(map[string]bool, len(allowed))
	for m := range allowed {
		allowedDefs[m] = true
	}
	if defs, ok := schema["$defs"].(map[string]any); ok {
		for defName, defVal := range defs {
			if defMap, isMap := defVal.(map[string]any); isMap {
				if props, isProps := defMap["properties"].(map[string]any); isProps {
					for propKey := range props {
						if allowedDefs[propKey] {
							allowedDefs[defName] = true
							break
						}
					}
				}
			}
		}
	}

	if oneOf, ok := schema["oneOf"].([]any); ok {
		var kept []any
		var oldIndices []int
		for i, item := range oneOf {
			m, isMap := item.(map[string]any)
			if !isMap {
				continue
			}
			ref, isStr := m["$ref"].(string)
			if !isStr || !strings.HasPrefix(ref, defsRefPrefix) {
				continue
			}
			name := strings.TrimPrefix(ref, defsRefPrefix)
			if allowedDefs[name] {
				kept = append(kept, item)
				oldIndices = append(oldIndices, i)
			}
		}
		schema["oneOf"] = kept
		remapSliceKeyOrder(keyOrder, "/oneOf", oldIndices)
	}

	if defs, ok := schema["$defs"].(map[string]any); ok {
		schema["$defs"] = reachableDefs(defs, allowedDefs, defsRefPrefix)
	}
	return schema, keyOrder, nil
}

// PruneCommonTypesSchema parses rawCommon and retains only definitions reachable from referencingSchemas.
func PruneCommonTypesSchema(
	rawCommon []byte,
	referencingSchemas ...map[string]any,
) (map[string]any, map[string][]string, error) {
	if len(rawCommon) == 0 {
		return map[string]any{}, nil, nil
	}
	schema, err := parseJSONObject(rawCommon)
	if err != nil {
		return nil, nil, err
	}
	keyOrder, err := ExtractKeyOrder(rawCommon)
	if err != nil {
		return nil, nil, err
	}
	defs, ok := schema["$defs"].(map[string]any)
	if !ok {
		return schema, keyOrder, nil
	}
	roots := make(map[string]bool)
	for _, refSchema := range referencingSchemas {
		for ref := range collectRefs(refSchema) {
			if strings.Contains(ref, "common_types.json#/$defs/") || strings.HasPrefix(ref, defsRefPrefix) {
				parts := strings.Split(ref, defsRefPrefix)
				roots[parts[len(parts)-1]] = true
			}
		}
	}
	schema["$defs"] = reachableDefs(defs, roots, defsRefPrefix)
	return schema, keyOrder, nil
}

func remapSliceKeyOrder(keyOrder map[string][]string, slicePtr string, oldIndices []int) {
	if len(keyOrder) == 0 {
		return
	}
	updates := make(map[string][]string)
	for newIdx, oldIdx := range oldIndices {
		oldPrefix := fmt.Sprintf("%s/%d", slicePtr, oldIdx)
		newPrefix := fmt.Sprintf("%s/%d", slicePtr, newIdx)
		for k, v := range keyOrder {
			if k == oldPrefix || strings.HasPrefix(k, oldPrefix+"/") {
				updates[newPrefix+k[len(oldPrefix):]] = v
			}
		}
	}
	for k := range keyOrder {
		if strings.HasPrefix(k, slicePtr+"/") {
			delete(keyOrder, k)
		}
	}
	for k, v := range updates {
		keyOrder[k] = v
	}
}

func collectRefs(node any) map[string]bool {
	out := make(map[string]bool)
	collectRefsInto(node, out)
	return out
}

func collectRefsInto(node any, out map[string]bool) {
	switch v := node.(type) {
	case map[string]any:
		for k, item := range v {
			if k == "$ref" {
				if s, ok := item.(string); ok {
					out[s] = true
				}
			} else {
				collectRefsInto(item, out)
			}
		}
	case []any:
		for _, item := range v {
			collectRefsInto(item, out)
		}
	}
}

func reachableDefs(defs map[string]any, roots map[string]bool, refPrefix string) map[string]any {
	reachable := make(map[string]bool)
	queue := make([]string, 0, len(roots))
	for r := range roots {
		queue = append(queue, r)
	}
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if reachable[name] {
			continue
		}
		defVal, exists := defs[name]
		if !exists {
			continue
		}
		reachable[name] = true
		for ref := range collectRefs(defVal) {
			if strings.HasPrefix(ref, refPrefix) {
				queue = append(queue, strings.TrimPrefix(ref, refPrefix))
			}
		}
	}
	kept := make(map[string]any, len(reachable))
	for name, val := range defs {
		if reachable[name] {
			kept[name] = val
		}
	}
	return kept
}

// MarshalOrderedCompact serializes val into compact JSON (no whitespace, HTML escaping disabled)
// preserving object key order from keyOrder where present.
func MarshalOrderedCompact(val any, keyOrder map[string][]string) (string, error) {
	var buf bytes.Buffer
	if err := writeOrderedJSON(&buf, val, "", keyOrder, "", 0, nil); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// MarshalCatalogCompact serializes cat.ToJSON() into compact JSON preserving cat.KeyOrder()
// as well as ComponentNames() and FunctionNames() ordering.
func MarshalCatalogCompact(cat *core.Catalog) (string, error) {
	doc := cat.ToJSON()
	ko := cat.KeyOrder()
	if ko == nil {
		ko = make(map[string][]string)
	}
	if _, hasRoot := ko[""]; !hasRoot {
		ko[""] = []string{"$schema", "$id", "protocolVersion", "title", "description", "instructions", "catalogId", "components", "functions", "theme", "styles", "$defs"}
	}
	if compNames := cat.ComponentNames(); len(compNames) > 0 {
		ko["/components"] = compNames
	}
	if fnNames := cat.FunctionNames(); len(fnNames) > 0 {
		ko["/functions"] = fnNames
	}
	return MarshalOrderedCompact(doc, ko)
}

// MarshalMessagesIndented serializes messages as 2-space pretty-printed JSON matching Python's
// DirectJsonDecompiler output (with canonical envelope and component field ordering).
func MarshalMessagesIndented(messages []core.AgentToRendererMessage, catalogs []*core.Catalog) (string, error) {
	items := make([]any, len(messages))
	for i, m := range messages {
		items[i] = map[string]any(m)
	}
	var buf bytes.Buffer
	if err := writeOrderedJSON(&buf, items, "", nil, "  ", 0, catalogs); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func writeOrderedJSON(
	buf *bytes.Buffer,
	val any,
	pointer string,
	keyOrder map[string][]string,
	indent string,
	depth int,
	catalogs []*core.Catalog,
) error {
	switch v := val.(type) {
	case nil:
		buf.WriteString("null")
		return nil
	case bool:
		if v {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
		return nil
	case string:
		return writeRawJSONPrimitive(buf, v)
	case int, int64, int32, float64, float32, json.Number:
		return writeRawJSONPrimitive(buf, v)
	case []any:
		if len(v) == 0 {
			buf.WriteString("[]")
			return nil
		}
		buf.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				buf.WriteByte(',')
			}
			if indent != "" {
				buf.WriteByte('\n')
				buf.WriteString(strings.Repeat(indent, depth+1))
			}
			if err := writeOrderedJSON(buf, item, fmt.Sprintf("%s/%d", pointer, i), keyOrder, indent, depth+1, catalogs); err != nil {
				return err
			}
		}
		if indent != "" {
			buf.WriteByte('\n')
			buf.WriteString(strings.Repeat(indent, depth))
		}
		buf.WriteByte(']')
		return nil
	case map[string]any:
		if len(v) == 0 {
			buf.WriteString("{}")
			return nil
		}
		keys := resolveMapKeys(v, pointer, keyOrder, catalogs)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			if indent != "" {
				buf.WriteByte('\n')
				buf.WriteString(strings.Repeat(indent, depth+1))
			}
			if err := writeRawJSONPrimitive(buf, k); err != nil {
				return err
			}
			if indent != "" {
				buf.WriteString(": ")
			} else {
				buf.WriteByte(':')
			}
			childPtr := pointer + "/" + escapePtr(k)
			if err := writeOrderedJSON(buf, v[k], childPtr, keyOrder, indent, depth+1, catalogs); err != nil {
				return err
			}
		}
		if indent != "" {
			buf.WriteByte('\n')
			buf.WriteString(strings.Repeat(indent, depth))
		}
		buf.WriteByte('}')
		return nil
	default:
		// Handle typed slices/maps if present in user dataModel values.
		raw, err := marshalWithoutHTMLEscape(v)
		if err != nil {
			return err
		}
		generic, err := core.ParseJSON(raw)
		if err != nil {
			return err
		}
		return writeOrderedJSON(buf, generic, pointer, keyOrder, indent, depth, catalogs)
	}
}

func resolveMapKeys(
	m map[string]any,
	pointer string,
	keyOrder map[string][]string,
	catalogs []*core.Catalog,
) []string {
	var preferred []string
	if keyOrder != nil {
		if ord, ok := keyOrder[pointer]; ok {
			preferred = ord
		}
	}
	if len(preferred) == 0 {
		preferred = canonicalMessageKeys(m, pointer, catalogs)
	}

	seen := make(map[string]bool, len(m))
	keys := make([]string, 0, len(m))
	for _, k := range preferred {
		if _, exists := m[k]; exists && !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	if len(keys) < len(m) {
		rest := make([]string, 0, len(m)-len(keys))
		for k := range m {
			if !seen[k] {
				rest = append(rest, k)
			}
		}
		sort.Strings(rest)
		keys = append(keys, rest...)
	}
	return keys
}

func canonicalMessageKeys(m map[string]any, pointer string, catalogs []*core.Catalog) []string {
	// Top-level message envelope in array (/0, /1, ...).
	if strings.Count(pointer, "/") == 1 {
		return []string{
			"version",
			"createSurface",
			"updateComponents",
			"updateDataModel",
			"deleteSurface",
			"callRendererFunction",
			"agentFunctionResponse",
			"beginRendering",
			"surfaceUpdate",
			"dataModelUpdate",
		}
	}
	switch {
	case strings.HasSuffix(pointer, "/createSurface"):
		return []string{"surfaceId", "catalogId", "theme", "sendDataModel", "components", "dataModel", "metadata"}
	case strings.HasSuffix(pointer, "/updateComponents"), strings.HasSuffix(pointer, "/surfaceUpdate"):
		return []string{"surfaceId", "components"}
	case strings.HasSuffix(pointer, "/updateDataModel"):
		return []string{"surfaceId", "path", "value"}
	case strings.HasSuffix(pointer, "/deleteSurface"):
		return []string{"surfaceId"}
	case strings.HasSuffix(pointer, "/callRendererFunction"):
		return []string{"surfaceId", "functionCallId", "callFunction"}
	case strings.HasSuffix(pointer, "/agentFunctionResponse"):
		return []string{"functionCallId", "value", "error"}
	case strings.HasSuffix(pointer, "/beginRendering"):
		return []string{"surfaceId", "catalogId", "root", "styles"}
	}

	// Component entry inside /components/<idx>.
	if _, hasID := m["id"]; hasID {
		if compType, hasComp := m["component"].(string); hasComp {
			order := []string{"id", "component", "catalogId"}
			order = append(order, lookupCatalogComponentPropOrder(compType, m["catalogId"], catalogs)...)
			order = append(order, "weight", "checks", "accessibility", "metadata")
			return order
		}
	}
	if _, hasAtCall := m["@call"]; hasAtCall {
		return []string{"@call", "catalogId", "args"}
	}
	if _, hasCall := m["call"]; hasCall {
		if _, hasArgs := m["args"]; hasArgs {
			return []string{"call", "args", "returnType"}
		}
	}
	if _, hasCompID := m["componentId"]; hasCompID {
		if _, hasPath := m["path"]; hasPath && len(m) == 2 {
			return []string{"componentId", "path"}
		}
	}
	if _, hasEvent := m["event"]; hasEvent && len(m) == 1 {
		return []string{"event"}
	}
	if strings.HasSuffix(pointer, "/event") {
		return []string{"name", "context", "userMessage"}
	}
	return nil
}

func lookupCatalogComponentPropOrder(compType string, rawCatID any, catalogs []*core.Catalog) []string {
	catID, _ := rawCatID.(string)
	ptr := "/components/" + escapePtr(compType) + "/properties"
	for _, cat := range catalogs {
		if cat == nil {
			continue
		}
		if catID != "" && cat.CatalogID() != catID {
			continue
		}
		if ko := cat.KeyOrder(); ko != nil {
			if props, ok := ko[ptr]; ok {
				return props
			}
		}
	}
	return nil
}

func writeRawJSONPrimitive(buf *bytes.Buffer, v any) error {
	b, err := marshalWithoutHTMLEscape(v)
	if err != nil {
		return err
	}
	buf.Write(b)
	return nil
}

func marshalWithoutHTMLEscape(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	out := b.Bytes()
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	return out, nil
}
