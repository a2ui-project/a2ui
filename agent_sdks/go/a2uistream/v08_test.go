package a2uistream

import (
	"reflect"
	"strings"
	"testing"
)

func TestV08IncrementalYielding(t *testing.T) {
	p := NewV08Parser()
	assertV08Parts(t, processV08(t, p, "Here is your"), []V08Part{{Text: "Here is your"}})
	assertV08Parts(t, processV08(t, p, " response.<a2ui-json>["), []V08Part{{Text: " response."}})
	got := processV08(t, p, `{"beginRendering": {"surfaceId": "s1", "root": "root-column"}},`)
	assertV08Parts(t, got, []V08Part{{Messages: []map[string]any{{"beginRendering": map[string]any{"surfaceId": "s1", "root": "root-column"}}}}})
}

func TestV08ReachableComponents(t *testing.T) {
	p := NewV08Parser()
	assertV08Parts(t, processV08(t, p, `<a2ui-json>[{"beginRendering": {"root": "root", "surfaceId": "s1"}},`), []V08Part{
		{Messages: []map[string]any{{"beginRendering": map[string]any{"root": "root", "surfaceId": "s1"}}}},
	})
	if got := processV08(t, p, `{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "c1", "component": {"Text": {"text": {"literalString": "hello"}}}}`); len(got) != 0 {
		t.Fatalf("partial update yielded %#v, want none", got)
	}
	got := processV08(t, p, `, {"id": "root", "component": {"Card": {"child": "c1"}}}]}}</a2ui-json>`)
	want := []V08Part{{Messages: []map[string]any{{"surfaceUpdate": map[string]any{
		"surfaceId": "s1",
		"components": []map[string]any{
			{"id": "c1", "component": map[string]any{"Text": map[string]any{"text": map[string]any{"literalString": "hello"}}}},
			{"id": "root", "component": map[string]any{"Card": map[string]any{"child": "c1"}}},
		},
	}}}}}
	assertV08Parts(t, got, want)
}

func TestV08IgnoresOrphanComponent(t *testing.T) {
	p := NewV08Parser()
	processV08(t, p, `<a2ui-json>[{"beginRendering": {"root": "root", "surfaceId": "s1"}}, `)
	got := processV08(t, p, `{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "root", "component": {"Text": {"text": "root"}}}, {"id": "orphan", "component": {"Text": {"text": "orphan"}}}]}}] </a2ui-json>`)
	want := []V08Part{{Messages: []map[string]any{{"surfaceUpdate": map[string]any{
		"surfaceId": "s1",
		"components": []map[string]any{
			{"id": "root", "component": map[string]any{"Text": map[string]any{"text": "root"}}},
		},
	}}}}}
	assertV08Parts(t, got, want)
}

func TestV08CircularReferenceDetection(t *testing.T) {
	p := NewV08Parser()
	processV08(t, p, `<a2ui-json>[{"beginRendering": {"root": "c1", "surfaceId": "s1"}},`)
	_, err := p.ProcessChunk(`{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "c1", "component": {"Card": {"child": "c2"}}}]}},{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "c2", "component": {"Card": {"child": "c1"}}}]}}]}} </a2ui-json>`)
	if err == nil || !strings.Contains(err.Error(), "circular reference detected") {
		t.Fatalf("err = %v, want circular reference", err)
	}
}

func TestV08SplitTagHandling(t *testing.T) {
	p := NewV08Parser()
	assertV08Parts(t, processV08(t, p, "Talking <a2u"), []V08Part{{Text: "Talking "}})
	if got := processV08(t, p, "i-json>"); len(got) != 0 {
		t.Fatalf("split tag yielded %#v, want none", got)
	}
	got := processV08(t, p, `[{"beginRendering": {"root": "r", "surfaceId": "s"}}] </a2ui-json> End.`)
	want := []V08Part{
		{Messages: []map[string]any{{"beginRendering": map[string]any{"root": "r", "surfaceId": "s"}}}},
		{Text: " End."},
	}
	assertV08Parts(t, got, want)
}

func mustV08(t *testing.T, parts []V08Part, err error) []V08Part {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	return parts
}

func processV08(t *testing.T, p *V08Parser, chunk string) []V08Part {
	t.Helper()
	parts, err := p.ProcessChunk(chunk)
	return mustV08(t, parts, err)
}

func assertV08Parts(t *testing.T, got, want []V08Part) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parts = %#v, want %#v", got, want)
	}
}
