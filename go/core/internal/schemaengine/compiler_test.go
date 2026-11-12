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

package schemaengine_test

import (
	"testing"

	"github.com/a2ui-project/a2ui/go/core/internal/schemaengine"
	"github.com/a2ui-project/a2ui/go/core/internal/specassets"
)

func TestOfflineLoaderRejectsNetwork(t *testing.T) {
	schema := map[string]any{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$ref":    "https://evil.example.com/remote.json",
	}
	_, err := schemaengine.CompileInline("https://a2ui.org/test.json", schema, nil)
	if err == nil {
		t.Fatal("expected offline error for unregistered remote $ref")
	}
	if !schemaengine.IsOfflineResourceError(err) {
		t.Fatalf("expected IsOfflineResourceError=true, got %T (%v)", err, err)
	}
}

func TestV10CommonTypesExtensionsAndUnevaluatedProperties(t *testing.T) {
	commonTypes, err := specassets.ReadJSONMap("specification/v1_0/json/common_types.json")
	if err != nil {
		t.Fatalf("ReadJSONMap: %v", err)
	}
	placeholderCatalog := map[string]any{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
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
	resources := map[string]any{
		"https://a2ui.org/specification/v1_0/common_types.json": commonTypes,
		"https://a2ui.org/specification/v1_0/catalog.json":      placeholderCatalog,
	}
	c := schemaengine.NewCompiler(resources)

	extSchema, err := c.Compile("https://a2ui.org/specification/v1_0/common_types.json#/$defs/Extensions")
	if err != nil {
		t.Fatalf("Compile Extensions: %v", err)
	}
	if err := extSchema.Validate(schemaengine.NormalizeJSON(map[string]any{"ünïcode": true, "_priv": 1})); err != nil {
		t.Fatalf("expected valid Extensions, got: %v", err)
	}
	if err := extSchema.Validate(schemaengine.NormalizeJSON(map[string]any{"has-dash": 1})); err == nil {
		t.Fatal("expected Extensions with 'has-dash' to fail")
	}

	fcSchema, err := c.Compile("https://a2ui.org/specification/v1_0/common_types.json#/$defs/FunctionCall")
	if err != nil {
		t.Fatalf("Compile FunctionCall: %v", err)
	}
	if err := fcSchema.Validate(schemaengine.NormalizeJSON(map[string]any{"@call": "openUrl", "args": map[string]any{"a": 1}})); err != nil {
		t.Fatalf("expected valid FunctionCall, got: %v", err)
	}
	if err := fcSchema.Validate(schemaengine.NormalizeJSON(map[string]any{"@call": "openUrl", "bogus": 1})); err == nil {
		t.Fatal("expected FunctionCall with bogus property to fail unevaluatedProperties")
	} else {
		issues := schemaengine.ExtractIssues(err)
		if len(issues) == 0 || issues[0].Code != "extra_field" {
			t.Fatalf("expected extra_field issue, got: %+v", issues)
		}
	}
}
