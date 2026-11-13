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
	"reflect"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/core"
)

// The tests in this file cover how v1.0 components carry the envelope mixins
// (@catalogId, @metadata, @accessibility, @checks) beyond what the conformance
// suites pin. They mirror tests in python/a2ui_agent/tests/express/test_catalogs_and_updates.py.

func catalogFromJSON(t *testing.T, raw string) *core.Catalog {
	t.Helper()
	cat, err := core.CatalogFromJSONBytes([]byte(raw), nil)
	if err != nil {
		t.Fatalf("CatalogFromJSONBytes: %v", err)
	}
	return cat
}

// asJSONValue round-trips v through JSON so maps and slices compare by value.
func asJSONValue(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	return out
}

func firstCreateSurfaceComponent(t *testing.T, msgs []core.AgentToRendererMessage) map[string]any {
	t.Helper()
	if len(msgs) == 0 {
		t.Fatal("no messages")
	}
	create, _ := msgs[0]["createSurface"].(map[string]any)
	components, _ := create["components"].([]any)
	if len(components) == 0 {
		t.Fatalf("createSurface has no components: %v", msgs[0])
	}
	comp, _ := components[0].(map[string]any)
	return comp
}

const envelopeTestCatalogs = `{
  "primary": {
    "catalogId": "test/primary",
    "protocolVersion": "1.0",
    "components": {
      "Panel": {
        "type": "object",
        "allOf": [
          { "$ref": "common_types.json#/$defs/ComponentCommon" },
          { "$ref": "common_types.json#/$defs/Checkable" },
          { "type": "object", "properties": { "component": { "const": "Panel" }, "title": { "type": "string" } }, "required": ["component"] }
        ]
      }
    },
    "functions": {
      "sharedFn": {
        "returnType": "boolean",
        "properties": { "args": { "type": "object", "properties": { "first": { "type": "string" } }, "required": ["first"] } }
      }
    }
  },
  "custom": {
    "catalogId": "test/custom",
    "protocolVersion": "1.0",
    "components": {
      "Badge": {
        "type": "object",
        "properties": {
          "component": { "const": "Badge" },
          "count": { "type": "number" },
          "metadata": { "type": "string" },
          "catalogId": { "type": "string" }
        },
        "required": ["component", "count"]
      }
    },
    "functions": {}
  }
}`

func envelopeTestCatalog(t *testing.T, name string) *core.Catalog {
	t.Helper()
	var docs map[string]json.RawMessage
	if err := json.Unmarshal([]byte(envelopeTestCatalogs), &docs); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	return catalogFromJSON(t, string(docs[name]))
}

func TestDecompileReadsLegacyBareEnvelopeKeysOnV10(t *testing.T) {
	primary := envelopeTestCatalog(t, "primary")
	custom := envelopeTestCatalog(t, "custom")
	catalogs := []*core.Catalog{primary, custom}
	decompiler, err := NewDecompiler(catalogs, "")
	if err != nil {
		t.Fatalf("NewDecompiler: %v", err)
	}
	compiler, err := NewCompiler(catalogs, "")
	if err != nil {
		t.Fatalf("NewCompiler: %v", err)
	}

	// v1.0 payloads written before the @ envelope cutover use bare keys.
	legacy := []core.AgentToRendererMessage{{
		"version": "1.0",
		"createSurface": map[string]any{
			"surfaceId": "s1",
			"components": []any{map[string]any{
				"id":        "root",
				"component": "Panel",
				"catalogId": "test/primary",
				"metadata":  map[string]any{"extensions": map[string]any{"trace": "t1"}},
				"checks": []any{map[string]any{
					"condition": map[string]any{
						"@call":     "sharedFn",
						"catalogId": "test/primary",
						"args":      map[string]any{"first": "x"},
					},
					"message": "Custom",
				}},
			}},
		},
	}}
	dsl, err := decompiler.Decompile(legacy, false)
	if err != nil {
		t.Fatalf("Decompile: %v", err)
	}
	if !strings.Contains(dsl, `extensions={trace: "t1"}`) {
		t.Errorf("decompiled DSL lacks the component extensions:\n%s", dsl)
	}
	if !strings.Contains(dsl, `"Custom"`) {
		t.Errorf("decompiled DSL lacks the check message:\n%s", dsl)
	}

	recompiled, err := compiler.Compile(dsl, "main", true, "")
	if err != nil {
		t.Fatalf("Compile(%q): %v", dsl, err)
	}
	comp := firstCreateSurfaceComponent(t, recompiled)
	if got := comp["@catalogId"]; got != "test/primary" {
		t.Errorf("@catalogId = %v, want test/primary", got)
	}
	if got, want := asJSONValue(t, comp["@metadata"]), asJSONValue(t, map[string]any{"extensions": map[string]any{"trace": "t1"}}); !reflect.DeepEqual(got, want) {
		t.Errorf("@metadata = %v, want %v", got, want)
	}
	checks, _ := comp["@checks"].([]any)
	if len(checks) != 1 {
		t.Fatalf("@checks = %v, want one check", comp["@checks"])
	}
	for _, bare := range []string{"catalogId", "metadata", "checks"} {
		if _, ok := comp[bare]; ok {
			t.Errorf("recompiled component still has the bare %q key: %v", bare, comp)
		}
	}
}

func TestCustomPropertiesNamedAfterEnvelopeMixinsRoundTrip(t *testing.T) {
	primary := envelopeTestCatalog(t, "primary")
	custom := envelopeTestCatalog(t, "custom")
	catalogs := []*core.Catalog{primary, custom}
	messages := []core.AgentToRendererMessage{{
		"version": "1.0",
		"createSurface": map[string]any{
			"surfaceId": "s1",
			"components": []any{map[string]any{
				"id":         "root",
				"component":  "Badge",
				"@catalogId": "test/custom",
				"count":      42,
				"metadata":   "custom-meta",
				"catalogId":  "custom-cat",
				"@metadata":  map[string]any{"extensions": map[string]any{"source": "agent"}},
			}},
		},
	}}
	for _, useKeywordArgs := range []bool{false, true} {
		decompiler, err := NewDecompiler(catalogs, "")
		if err != nil {
			t.Fatalf("NewDecompiler: %v", err)
		}
		dsl, err := decompiler.Decompile(messages, useKeywordArgs)
		if err != nil {
			t.Fatalf("Decompile(useKeywordArgs=%t): %v", useKeywordArgs, err)
		}
		// The custom catalogId is positional, because catalogId= names the catalog.
		if !strings.Contains(dsl, `"custom-meta", "custom-cat"`) {
			t.Errorf("useKeywordArgs=%t: custom properties are not positional:\n%s", useKeywordArgs, dsl)
		}
		if !strings.Contains(dsl, `extensions={source: "agent"}`) {
			t.Errorf("useKeywordArgs=%t: decompiled DSL lacks the extensions:\n%s", useKeywordArgs, dsl)
		}
		compiler, err := NewCompiler(catalogs, "")
		if err != nil {
			t.Fatalf("NewCompiler: %v", err)
		}
		recompiled, err := compiler.Compile(dsl, "main", true, "")
		if err != nil {
			t.Fatalf("Compile(%q): %v", dsl, err)
		}
		if got, want := asJSONValue(t, recompiled), asJSONValue(t, messages); !reflect.DeepEqual(got, want) {
			t.Errorf("useKeywordArgs=%t: round trip changed the messages:\ngot  %v\nwant %v", useKeywordArgs, got, want)
		}
	}
}

func TestCustomChecksPropertyOnCheckableComponent(t *testing.T) {
	cat := catalogFromJSON(t, `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "catalogId": "test/checkable_custom",
  "protocolVersion": "1.0",
  "components": {
    "ScoreInput": {
      "type": "object",
      "allOf": [
        { "$ref": "common_types.json#/$defs/ComponentCommon" },
        { "$ref": "common_types.json#/$defs/Checkable" },
        {
          "type": "object",
          "properties": {
            "component": { "const": "ScoreInput" },
            "checks": { "type": "integer" },
            "value": { "$ref": "common_types.json#/$defs/DynamicString" }
          },
          "required": ["component", "checks"]
        }
      ],
      "unevaluatedProperties": false
    }
  },
  "functions": {
    "nonEmpty": {
      "returnType": "boolean",
      "properties": { "args": { "type": "object", "properties": { "value": { "type": "string" } }, "required": ["value"] } }
    }
  }
}`)
	catalogs := []*core.Catalog{cat}
	compiler, err := NewCompiler(catalogs, "")
	if err != nil {
		t.Fatalf("NewCompiler: %v", err)
	}
	if _, err := compiler.Compile("root = ScoreInput()", "main", true, ""); err == nil || !strings.Contains(err.Error(), "missing required property 'checks'") {
		t.Errorf("Compile(ScoreInput()) error = %v, want a missing required property 'checks' error", err)
	}

	src := `root = ScoreInput(3, $/score, ?nonEmpty("Required"))`
	compiled, err := compiler.Compile(src, "main", true, "")
	if err != nil {
		t.Fatalf("Compile(%q): %v", src, err)
	}
	want := map[string]any{
		"id":        "root",
		"component": "ScoreInput",
		"checks":    3,
		"value":     map[string]any{"@path": "/score"},
		"@checks": []any{map[string]any{
			"condition": map[string]any{"@call": "nonEmpty", "args": map[string]any{"value": map[string]any{"@path": "/score"}}},
			"message":   "Required",
		}},
	}
	if got := firstCreateSurfaceComponent(t, compiled); !reflect.DeepEqual(asJSONValue(t, got), asJSONValue(t, want)) {
		t.Errorf("compiled component = %v, want %v", got, want)
	}

	decompiler, err := NewDecompiler(catalogs, "1.0")
	if err != nil {
		t.Fatalf("NewDecompiler: %v", err)
	}
	dsl, err := decompiler.Decompile(compiled, false)
	if err != nil {
		t.Fatalf("Decompile: %v", err)
	}
	if wantDSL := "surface(\"main\")\n" + src; dsl != wantDSL {
		t.Errorf("Decompile = %q, want %q", dsl, wantDSL)
	}

	surfaceCatID := "test/checkable_custom"
	_, err = decompiler.componentCatalogID(map[string]any{"id": "root", "component": "ScoreInput", "@catalogId": ""}, &surfaceCatID)
	if err == nil || !strings.Contains(err.Error(), "invalid '@catalogId'") {
		t.Errorf("componentCatalogID(empty @catalogId) error = %v, want an invalid '@catalogId' error", err)
	}
}
