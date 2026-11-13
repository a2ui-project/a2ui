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
	"encoding/json"
	"fmt"
	"maps"
	"reflect"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

func schemaAllowsDatabinding(schema map[string]any) bool {
	if schema == nil {
		return false
	}
	if ref, ok := schema["$ref"].(string); ok {
		if strings.Contains(ref, "DataBinding") || strings.Contains(ref, "Dynamic") {
			return true
		}
	}
	if props, ok := schema["properties"].(map[string]any); ok {
		_, hasPath := props["path"]
		_, hasAtPath := props["@path"]
		_, hasCompID := props["componentId"]
		if (hasPath || hasAtPath) && !hasCompID {
			return true
		}
	}
	if items, ok := schema["items"].(map[string]any); ok && schemaAllowsDatabinding(items) {
		return true
	}
	for _, key := range []string{"allOf", "oneOf", "anyOf"} {
		if subs, ok := schema[key].([]any); ok {
			for _, sub := range subs {
				if sm, ok := sub.(map[string]any); ok && schemaAllowsDatabinding(sm) {
					return true
				}
			}
		}
	}
	return false
}

func describeExpressValue(val any) string {
	switch v := val.(type) {
	case *CallNode:
		return fmt.Sprintf("a call to %s(...)", v.Name)
	case CheckNode:
		return fmt.Sprintf("a check (?%s)", v.Name)
	case VariableNode:
		return fmt.Sprintf("the variable %s", v.Name)
	case PathNode:
		return fmt.Sprintf("the data binding $%s", v.Path)
	case SkippedNode:
		return "'_'"
	case map[string]any:
		return "a map literal"
	case []any:
		return "a list"
	case nil:
		return "null"
	case bool:
		if v {
			return "the boolean true"
		}
		return "the boolean false"
	case int, int64, float64:
		b, _ := json.Marshal(v)
		return "the number " + string(b)
	case string:
		b, _ := json.Marshal(v)
		return "the string " + string(b)
	default:
		return fmt.Sprintf("a %T", val)
	}
}

func bindingPath(v any, pathKey string) (string, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return "", false
	}
	if _, hasCompID := m["componentId"]; hasCompID {
		return "", false
	}
	p, ok := m[pathKey].(string)
	return p, ok
}

func resolvesToPath(node any, rawSymbols map[string]any) bool {
	seen := make(map[string]bool)
	cur := node
	for {
		vn, ok := cur.(VariableNode)
		if !ok {
			break
		}
		if seen[vn.Name] {
			return false
		}
		next, exists := rawSymbols[vn.Name]
		if !exists {
			return false
		}
		seen[vn.Name] = true
		cur = next
	}
	_, isPath := cur.(PathNode)
	return isPath
}

func hasDatabinding(node any, rawSymbols map[string]any, seen map[string]bool) bool {
	switch v := node.(type) {
	case PathNode:
		return true
	case VariableNode:
		if seen[v.Name] {
			return false
		}
		sym, ok := rawSymbols[v.Name]
		if !ok {
			return false
		}
		nextSeen := maps.Clone(seen)
		if nextSeen == nil {
			nextSeen = make(map[string]bool)
		}
		nextSeen[v.Name] = true
		return hasDatabinding(sym, rawSymbols, nextSeen)
	case map[string]any:
		for _, mv := range v {
			if hasDatabinding(mv, rawSymbols, seen) {
				return true
			}
		}
		return false
	case []any:
		for _, item := range v {
			if hasDatabinding(item, rawSymbols, seen) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func isCheckExpression(val any) bool {
	if _, ok := val.(CheckNode); ok {
		return true
	}
	list, ok := val.([]any)
	if !ok || len(list) == 0 {
		return false
	}
	for _, item := range list {
		if !isCheckExpression(item) {
			return false
		}
	}
	return true
}

func callArg(node *CallNode, index int, key string) (any, bool) {
	if v, ok := node.Kwarg(key); ok {
		return v, true
	}
	if index < len(node.Args) {
		return node.Args[index], true
	}
	return nil, false
}

func stringCallArg(node *CallNode, index int, key, statement string) (string, bool, error) {
	val, present := callArg(node, index, key)
	if !present || val == nil {
		return "", false, nil
	}
	s, ok := val.(string)
	if !ok {
		return "", false, NewValidationError(
			fmt.Sprintf("%s() argument '%s' must be a string, got: %v", statement, key, val),
			"",
		)
	}
	return s, true, nil
}

func isNumericASTLiteral(v any) bool {
	switch v.(type) {
	case int, int64, float64:
		return true
	default:
		return false
	}
}

func enumContainsValue(enumVals []any, candidate any) bool {
	for _, ev := range enumVals {
		if reflect.DeepEqual(ev, candidate) {
			return true
		}
		// Handle int64 vs float64 comparison for numeric enums.
		if f1, ok1 := asFloat64(ev); ok1 {
			if f2, ok2 := asFloat64(candidate); ok2 && f1 == f2 {
				return true
			}
		}
	}
	return false
}

func asFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, true
	default:
		return 0, false
	}
}

func capitalizeCheckName(s string) string {
	if s == "" {
		return ""
	}
	r, width := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + strings.ToLower(s[width:])
}

func validateExtensionsMap(extensions any, target string, ctx *compileContext) (map[string]any, error) {
	if !ctx.atLeastV10 {
		return nil, NewValidationError(
			fmt.Sprintf("%s sets extensions, which needs A2UI v1.0 or later (target version is %s).", target, ctx.version),
			"",
		)
	}
	extMap, ok := extensions.(map[string]any)
	if !ok {
		return nil, NewValidationError(
			fmt.Sprintf("%s extensions must be a map, got: %v", target, extensions),
			"",
		)
	}
	for _, k := range schemahelper.OrderedKeys(extMap) {
		if !core.IsValidUAX31Identifier(k) {
			return nil, NewValidationError(
				fmt.Sprintf("%s extension key %q is not a valid UAX 31 identifier.", target, k),
				"",
			)
		}
	}
	return extMap, nil
}
