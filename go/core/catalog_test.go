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

package core_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/a2ui-project/a2ui/go/core"
)

func repoRootDir(t testing.TB) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "conformance", "conformance_schema.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not locate conformance/conformance_schema.json above %s", dir)
		}
		dir = parent
	}
}

func normalizeSchemaForComparison(v any) any {
	switch typed := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for k, val := range typed {
			if (k == "required" || k == "enum") && isSliceOfStrings(val) {
				strs := sliceToStrings(val)
				sort.Strings(strs)
				arr := make([]any, len(strs))
				for i, s := range strs {
					arr[i] = s
				}
				out[k] = arr
				continue
			}
			out[k] = normalizeSchemaForComparison(val)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = normalizeSchemaForComparison(item)
		}
		return out
	default:
		return v
	}
}

func isSliceOfStrings(v any) bool {
	arr, ok := v.([]any)
	if !ok {
		return false
	}
	for _, item := range arr {
		if _, ok := item.(string); !ok {
			return false
		}
	}
	return true
}

func sliceToStrings(v any) []string {
	arr, _ := v.([]any)
	out := make([]string, len(arr))
	for i, item := range arr {
		out[i], _ = item.(string)
	}
	return out
}

func TestBuiltinCatalogsAndGoldenValidationSchemas(t *testing.T) {
	root := repoRootDir(t)
	cases := []struct {
		ver        core.ProtocolVersion
		sourceFile string
		goldenFile string
	}{
		{
			ver:        core.Version0_8,
			sourceFile: "specification/v0_8/json/standard_catalog_definition.json",
			goldenFile: "conformance/test_data/validation_schema/test_v08_basic_validation_schema.json",
		},
		{
			ver:        core.Version0_9,
			sourceFile: "specification/v0_9/catalogs/basic/catalog.json",
			goldenFile: "conformance/test_data/validation_schema/test_v09_basic_validation_schema.json",
		},
		{
			ver:        core.Version1_0,
			sourceFile: "catalogs/basic/v1/catalog.json",
			goldenFile: "conformance/test_data/validation_schema/test_v10_basic_validation_schema.json",
		},
	}

	for _, tc := range cases {
		cat, err := core.BasicCatalog(tc.ver)
		if err != nil {
			t.Fatalf("BasicCatalog(%s): %v", tc.ver, err)
		}
		srcBytes, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(tc.sourceFile)))
		if err != nil {
			t.Fatalf("ReadFile(%s): %v", tc.sourceFile, err)
		}
		wantDoc, err := core.ParseJSON(srcBytes)
		if err != nil {
			t.Fatalf("ParseJSON(%s): %v", tc.sourceFile, err)
		}
		gotDoc := cat.ToJSON()
		if !reflect.DeepEqual(normalizeSchemaForComparison(gotDoc), normalizeSchemaForComparison(wantDoc)) {
			t.Fatalf("BasicCatalog(%s).ToJSON() mismatch with %s", tc.ver, tc.sourceFile)
		}

		goldenBytes, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(tc.goldenFile)))
		if err != nil {
			t.Fatalf("ReadFile(%s): %v", tc.goldenFile, err)
		}
		wantGolden, err := core.ParseJSON(goldenBytes)
		if err != nil {
			t.Fatalf("ParseJSON(%s): %v", tc.goldenFile, err)
		}
		gotVal := cat.ValidationSchema()
		if !reflect.DeepEqual(normalizeSchemaForComparison(gotVal), normalizeSchemaForComparison(wantGolden)) {
			gotJSON, _ := json.MarshalIndent(gotVal, "", "  ")
			t.Fatalf("BasicCatalog(%s).ValidationSchema() mismatch with %s.\nGot:\n%s", tc.ver, tc.goldenFile, string(gotJSON[:min(len(gotJSON), 2000)]))
		}
	}

	mcpCat, err := core.MCPCatalog()
	if err != nil {
		t.Fatalf("MCPCatalog(): %v", err)
	}
	if mcpCat.CatalogID() == "" || len(mcpCat.ComponentNames()) == 0 {
		t.Fatalf("unexpected MCPCatalog: id=%q comps=%v", mcpCat.CatalogID(), mcpCat.ComponentNames())
	}
}

// fanOutRefCatalog returns a catalog whose $defs form a DAG in which each of depth entries
// references the next one twice, so inlining every reference separately yields 2^depth copies.
func fanOutRefCatalog(depth int) []byte {
	defs := make([]string, 0, depth+1)
	for i := 0; i < depth; i++ {
		defs = append(defs, fmt.Sprintf(`"d%d": {"allOf": [{"$ref": "#/$defs/d%d"}, {"$ref": "#/$defs/d%d"}]}`, i, i+1, i+1))
	}
	defs = append(defs, fmt.Sprintf(`"d%d": {"type": "string"}`, depth))
	return []byte(fmt.Sprintf(`{"catalogId": "c", "protocolVersion": "1.0",
		"components": {"A": {"type": "object", "properties": {"x": {"$ref": "#/$defs/d0"}}}},
		"functions": {"f": {"type": "object", "properties": {"@call": {"const": "f"}, "args": {"$ref": "#/$defs/d0"}}}},
		"$defs": {%s}}`, strings.Join(defs, ",")))
}

func countSchemaNodes(v any) int {
	n := 1
	switch typed := v.(type) {
	case map[string]any:
		for _, item := range typed {
			n += countSchemaNodes(item)
		}
	case []any:
		for _, item := range typed {
			n += countSchemaNodes(item)
		}
	}
	return n
}

func TestResolvedSchemasBoundReferenceExpansion(t *testing.T) {
	tests := []struct {
		name    string
		depth   int
		resolve func(cat *core.Catalog) map[string]any
	}{
		{"small component DAG is fully inlined", 4, func(cat *core.Catalog) map[string]any { return cat.ResolvedComponentSchema("A") }},
		{"component", 48, func(cat *core.Catalog) map[string]any { return cat.ResolvedComponentSchema("A") }},
		{"function", 48, func(cat *core.Catalog) map[string]any { return cat.ResolvedFunctionSchema("f") }},
		{"reference map", 48, func(cat *core.Catalog) map[string]any {
			_ = cat.ComponentRefMap()
			return cat.ResolvedComponentSchema("A")
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cat, err := core.CatalogFromJSONBytes(fanOutRefCatalog(tc.depth), nil)
			if err != nil {
				t.Fatalf("CatalogFromJSONBytes: %v", err)
			}
			done := make(chan map[string]any, 1)
			go func() { done <- tc.resolve(cat) }()
			var resolved map[string]any
			select {
			case resolved = <-done:
			case <-time.After(10 * time.Second):
				t.Fatalf("resolving a %d-level fan-out $ref DAG did not finish within 10s", tc.depth)
			}
			nodes := countSchemaNodes(resolved)
			if nodes > 1<<18 {
				t.Fatalf("resolved schema has %d nodes, want a bounded expansion", nodes)
			}
			if tc.depth < 8 {
				if raw, _ := json.Marshal(resolved); strings.Contains(string(raw), "$ref") {
					t.Fatalf("small DAG was not fully inlined: %s", raw)
				}
			}
		})
	}
}

func TestCatalogFromJSONRejectsNullComponents(t *testing.T) {
	tests := []struct {
		name string
		load func() (*core.Catalog, error)
	}{
		{
			name: "json bytes null components",
			load: func() (*core.Catalog, error) {
				return core.CatalogFromJSONBytes([]byte(`{"catalogId":"c","protocolVersion":"1.0","components":null}`), nil)
			},
		},
		{
			name: "map untyped nil components",
			load: func() (*core.Catalog, error) {
				return core.CatalogFromJSON(map[string]any{"catalogId": "c", "protocolVersion": "1.0", "components": nil}, nil)
			},
		},
		{
			name: "map non-object components slice",
			load: func() (*core.Catalog, error) {
				return core.CatalogFromJSON(map[string]any{"catalogId": "c", "protocolVersion": "1.0", "components": []any{}}, nil)
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tc.load()
			var catErr *core.CatalogError
			if !errors.As(err, &catErr) {
				t.Fatalf("expected *core.CatalogError, got %T (%v)", err, err)
			}
		})
	}
}
