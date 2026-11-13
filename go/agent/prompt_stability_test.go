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

package agent

import (
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

const statCardCatalog = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "catalogId": "https://example.com/stat_card_catalog.json",
  "protocolVersion": "1.0",
  "components": {
    "StatCard": {
      "type": "object",
      "allOf": [
        {"$ref": "common_types.json#/$defs/ComponentCommon"},
        {
          "type": "object",
          "properties": {
            "component": {"const": "StatCard"},
            "title": {"type": "string"},
            "stats": {
              "type": "object",
              "properties": {
                "zeta": {"type": "number", "description": "Listed first"},
                "alpha": {"type": "number", "description": "Listed second"}
              }
            }
          },
          "required": ["component", "title"]
        }
      ],
      "unevaluatedProperties": false
    }
  }
}`

// TestPromptSnippetIndependentOfOtherWork checks that a long-lived processor keeps
// rendering its catalog in document order while other requests decode and compile
// many JSON objects.
func TestPromptSnippetIndependentOfOtherWork(t *testing.T) {
	cat, err := core.CatalogFromJSONBytes([]byte(statCardCatalog), nil)
	if err != nil {
		t.Fatalf("CatalogFromJSONBytes: %v", err)
	}
	proc, err := NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		t.Fatalf("NewRequestProcessor: %v", err)
	}
	before, err := proc.PromptSnippet()
	if err != nil {
		t.Fatalf("PromptSnippet: %v", err)
	}
	zeta, alpha := strings.Index(before, "* zeta"), strings.Index(before, "* alpha")
	if zeta < 0 || alpha < 0 || zeta > alpha {
		t.Fatalf("prompt does not list the stats keys in document order (zeta at %d, alpha at %d):\n%s", zeta, alpha, before)
	}

	// Every JSON object that the SDK decodes or builds records its key order, so other
	// requests register maps continuously.
	for i := range 200_000 {
		schemahelper.SetMapKeyOrder(map[string]any{"value": i}, []string{"value"})
	}

	after, err := proc.PromptSnippet()
	if err != nil {
		t.Fatalf("PromptSnippet: %v", err)
	}
	if after != before {
		t.Errorf("PromptSnippet changed after unrelated work:\nbefore:\n%s\nafter:\n%s", before, after)
	}
}
