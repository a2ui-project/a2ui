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
	"encoding/json"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// TestDirectJSONStreamKeepsEmptyLists checks that a streamed message whose value is
// an empty list reaches the renderer as [] (as ParseResponse delivers it), not as
// null, which would delete the data path instead of setting it.
func TestDirectJSONStreamKeepsEmptyLists(t *testing.T) {
	const prefix = `<a2ui-json>[{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}},`
	tests := []struct {
		name   string
		chunks []string
	}{
		{
			name:   "closed message in one chunk",
			chunks: []string{prefix + `{"version":"1.0","updateDataModel":{"surfaceId":"s1","path":"/items","value":[]}}]</a2ui-json>`},
		},
		{
			name: "list still open at a chunk boundary",
			chunks: []string{
				prefix + `{"version":"1.0","updateDataModel":{"surfaceId":"s1","path":"/items","value":[`,
				`{"a":`,
				`1}]}}]</a2ui-json>`,
			},
		},
	}
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	rp, err := agent.NewRequestProcessor([]*core.Catalog{basic}, &agent.RequestProcessorOptions{
		FormatFactory: agent.NewDirectJSONFormatFactory(nil),
	})
	if err != nil {
		t.Fatalf("NewRequestProcessor: %v", err)
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			stream, err := rp.OpenStream(nil)
			if err != nil {
				t.Fatalf("OpenStream: %v", err)
			}
			var parts []agent.StreamPart
			for _, chunk := range tc.chunks {
				got, err := stream.Feed(chunk)
				if err != nil {
					t.Fatalf("Feed(%q): %v", chunk, err)
				}
				parts = append(parts, got...)
			}
			closed, err := stream.Close()
			if err != nil {
				t.Fatalf("Close: %v", err)
			}
			parts = append(parts, closed...)
			for _, p := range parts {
				for _, msg := range p.A2UI {
					body, ok := msg["updateDataModel"].(map[string]any)
					if !ok {
						continue
					}
					if v, present := body["value"]; present && v == nil || isNilList(v) {
						raw, _ := json.Marshal(msg)
						t.Errorf("streamed message carries a null value: %s", raw)
					}
				}
			}
		})
	}
}

func isNilList(v any) bool {
	list, ok := v.([]any)
	return ok && list == nil
}
