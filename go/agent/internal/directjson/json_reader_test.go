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
	"reflect"
	"testing"
)

func TestReadJSONToleranceAndCurlyQuotes(t *testing.T) {
	raw := "[\n  {\u201cversion\u201d: \u201c1.0\u201d, \u201ccreateSurface\u201d: {\u201csurfaceId\u201d: \u201cs1\n\u201d, \u201cdataModel\u201d: {\u201cnote\u201d: \u201cline1\nline2\t!\u201d,},},},\n]"
	got, err := ReadJSON(raw)
	if err != nil {
		t.Fatalf("ReadJSON failed: %v", err)
	}
	arr, ok := got.([]any)
	if !ok || len(arr) != 1 {
		t.Fatalf("expected 1-element array, got %#v", got)
	}
	msg := arr[0].(map[string]any)
	cs := msg["createSurface"].(map[string]any)
	if cs["surfaceId"] != "s1" {
		t.Fatalf("expected structural newline stripped from surfaceId, got %q", cs["surfaceId"])
	}
	dm := cs["dataModel"].(map[string]any)
	if dm["note"] != "line1\nline2\t!" {
		t.Fatalf("expected raw newline and tab preserved inside dataModel, got %q", dm["note"])
	}
}

func TestReadPartialMessageItemsProgressiveAndCache(t *testing.T) {
	prog := map[string]bool{"text": true, "url": true}
	whole := map[string]bool{"components": true}
	cache := NewPartialReadCache()

	full := `[{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"cat"}},{"version":"1.0","updateDataModel":{"surfaceId":"s1","path":"/","value":{"text":"Hello world","url":"https://example.com/path"}}}]`

	// Partial slice inside progressive "text" key heals the open string.
	idxText := len(`[{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"cat"}},{"version":"1.0","updateDataModel":{"surfaceId":"s1","path":"/","value":{"text":"Hel`)
	items1 := ReadPartialMessageItems(full, prog, whole, cache, 0, idxText)
	if len(items1) != 2 {
		t.Fatalf("expected 2 items at idxText, got %d", len(items1))
	}
	if !items1[0].Closed {
		t.Fatalf("expected first item closed")
	}
	if items1[1].Closed {
		t.Fatalf("expected second item open")
	}
	val1 := items1[1].Envelope.(map[string]any)["updateDataModel"].(map[string]any)["value"].(map[string]any)
	if val1["text"] != "Hel" {
		t.Fatalf("expected healed progressive text 'Hel', got %#v", val1["text"])
	}

	// Partial slice inside URL value does NOT heal partial URL string, withholding the open message while reusing closed message pointer.
	idxURL := len(`[{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"cat"}},{"version":"1.0","updateDataModel":{"surfaceId":"s1","path":"/","value":{"text":"Hello world","url":"https://example`)
	items2 := ReadPartialMessageItems(full, prog, whole, cache, 0, idxURL)
	if len(items2) != 1 {
		t.Fatalf("expected 1 closed item at idxURL (unhealed URL withholds open message), got %d", len(items2))
	}
	p1 := reflect.ValueOf(items1[0].Envelope.(map[string]any)).Pointer()
	p2 := reflect.ValueOf(items2[0].Envelope.(map[string]any)).Pointer()
	if p1 != p2 {
		t.Fatalf("expected PartialReadCache to reuse closed message map pointer")
	}

	// Full read marks cache complete.
	items3 := ReadPartialMessageItems(full, prog, whole, cache, 0, len(full))
	if !cache.Complete || len(items3) != 2 || !items3[1].Closed {
		t.Fatalf("expected complete read, got complete=%v items=%#v", cache.Complete, items3)
	}
}

func TestReadPartialMessageItemsCachedEmptyOpenListMatchesFreshRead(t *testing.T) {
	prog := map[string]bool{"text": true}
	whole := map[string]bool{"components": true}
	full := `{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[{"id":"root"`
	cache := NewPartialReadCache()
	for _, end := range []int{
		len(`{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[`),
		len(`{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[{`),
		len(full),
	} {
		cached := ReadPartialMessageItems(full, prog, whole, cache, 0, end)
		fresh := ReadPartialMessageItems(full, prog, whole, nil, 0, end)
		if !reflect.DeepEqual(cached, fresh) {
			t.Fatalf("ReadPartialMessageItems(%q) with cache = %#v, without = %#v", full[:end], cached, fresh)
		}
	}
}

func TestOrderedJSONEncodingUnescapedHTML(t *testing.T) {
	schema := map[string]any{
		"description": "Use <a2ui-json> & tags",
		"type":        "object",
	}
	order := map[string][]string{
		"": {"type", "description"},
	}
	got, err := MarshalOrderedCompact(schema, order)
	if err != nil {
		t.Fatalf("MarshalOrderedCompact failed: %v", err)
	}
	want := `{"type":"object","description":"Use <a2ui-json> & tags"}`
	if got != want {
		t.Fatalf("MarshalOrderedCompact mismatch:\ngot:  %s\nwant: %s", got, want)
	}
}
