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

package agent_test

import (
	"testing"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// A v0.8 component instance is {"id", "weight", "component": {"<Type>": {...}}}.
// weight belongs to the instance wrapper (server_to_client.json), so a custom
// catalog whose component schema closes its properties must still accept it,
// as specification/v0_8/json/catalogs/minimal/examples/5_complex_layout.json
// does.
const v08ClosedTextFieldCatalog = `{
  "catalogId": "https://example.com/v08/closed.json",
  "components": {
    "Row": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "children": {
          "type": "object",
          "additionalProperties": false,
          "properties": {"explicitList": {"type": "array", "items": {"type": "string"}}}
        }
      },
      "required": ["children"]
    },
    "TextField": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "label": {
          "type": "object",
          "additionalProperties": false,
          "properties": {"literalString": {"type": "string"}, "path": {"type": "string"}}
        }
      },
      "required": ["label"]
    }
  }
}`

func v08WeightPayload(weight any) []core.AgentToRendererMessage {
	return []core.AgentToRendererMessage{
		{"surfaceUpdate": map[string]any{
			"surfaceId": "s",
			"components": []any{
				map[string]any{"id": "root", "component": map[string]any{
					"Row": map[string]any{"children": map[string]any{"explicitList": []any{"name"}}},
				}},
				map[string]any{"id": "name", "weight": weight, "component": map[string]any{
					"TextField": map[string]any{"label": map[string]any{"literalString": "Name"}},
				}},
			},
		}},
		{"beginRendering": map[string]any{
			"surfaceId": "s",
			"root":      "root",
			"catalogId": "https://example.com/v08/closed.json",
		}},
	}
}

func TestValidatePayloadV08InstanceWeightWithClosedCustomComponent(t *testing.T) {
	cat, err := core.CatalogFromJSONBytes([]byte(v08ClosedTextFieldCatalog), &core.CatalogLoadOptions{ProtocolVersion: core.Version0_8})
	if err != nil {
		t.Fatalf("CatalogFromJSONBytes: %v", err)
	}
	if err := agent.ValidatePayload([]*core.Catalog{cat}, v08WeightPayload(float64(1))); err != nil {
		t.Fatalf("ValidatePayload rejected an instance-level weight: %v", err)
	}
	// The wrapper schema still types weight as a number.
	if err := agent.ValidatePayload([]*core.Catalog{cat}, v08WeightPayload("heavy")); err == nil {
		t.Fatalf("ValidatePayload accepted a non-numeric weight")
	}
}
