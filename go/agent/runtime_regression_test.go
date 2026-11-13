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
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func TestRendererStateRollbackRestoresComponentMetadataSurfaceFieldsAndTopologyBound(t *testing.T) {
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	extraCat, err := basic.Derive(core.DeriveOptions{
		CatalogID:  "https://example.com/extra/v1",
		Components: []any{"Text"},
	})
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}

	state, err := agent.NewRendererState([]*core.Catalog{basic, extraCat})
	if err != nil {
		t.Fatalf("NewRendererState: %v", err)
	}

	initialMeta := map[string]any{"extensions": map[string]any{"tag": "v1"}}
	if _, err := state.Apply([]core.AgentToRendererMessage{
		{
			"version": "1.0",
			"createSurface": map[string]any{
				"surfaceId": "s1",
				"catalogId": basic.CatalogID(),
			},
		},
		{
			"version": "1.0",
			"updateComponents": map[string]any{
				"surfaceId": "s1",
				"components": []map[string]any{
					{"id": "root", "component": "Column", "children": []string{"t1", "t2"}},
					{"id": "t1", "component": "Text", "text": "one", "@metadata": initialMeta},
					{"id": "t2", "component": "Text", "@catalogId": extraCat.CatalogID(), "text": "two"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("initial Apply: %v", err)
	}

	surf := state.Surface("s1")
	surf.Locale = "fr-FR"
	surf.AvailableCatalogs[extraCat.CatalogID()] = extraCat

	t1 := surf.ComponentsModel.Get("t1")
	updatedEvents := 0
	metaEvents := 0
	t1.SubscribeUpdated(func(*core.ComponentModel) { updatedEvents++ })
	t1.SubscribeMetadataChanged(func(map[string]any) { metaEvents++ })

	errAbort := errors.New("abort")
	// 1. Rollback in-place component update restores Properties + Metadata and fires listeners.
	_ = state.Transaction(func() error {
		if _, err := state.Apply([]core.AgentToRendererMessage{
			{
				"version": "1.0",
				"updateComponents": map[string]any{
					"surfaceId": "s1",
					"components": []any{
						map[string]any{
							"id":        "t1",
							"component": "Text",
							"text":      "mutated",
							"@metadata": map[string]any{"extensions": map[string]any{"tag": "v2"}},
						},
					},
				},
			},
		}); err != nil {
			t.Fatalf("tx Apply: %v", err)
		}
		return errAbort
	})

	if t1.Properties["text"] != "one" {
		t.Fatalf("after rollback t1.Properties[text] = %v, want \"one\"", t1.Properties["text"])
	}
	if !reflect.DeepEqual(t1.Metadata, initialMeta) {
		t.Fatalf("after rollback t1.Metadata = %#v, want %#v", t1.Metadata, initialMeta)
	}
	if updatedEvents < 2 || metaEvents < 2 {
		t.Fatalf("expected updatedEvents>=2 and metaEvents>=2 across apply+rollback, got (%d, %d)", updatedEvents, metaEvents)
	}

	// 2. DropProvisionalComponent (and rolling it back) preserves Metadata.
	state.MarkChecked([]string{"s1"})
	_ = state.Transaction(func() error {
		if _, err := state.Apply([]core.AgentToRendererMessage{
			{
				"version": "1.0",
				"updateComponents": map[string]any{
					"surfaceId": "s1",
					"components": []any{
						map[string]any{
							"id":        "t1",
							"component": "Text",
							"text":      "provisional",
							"@metadata": map[string]any{"extensions": map[string]any{"tag": "prov"}},
						},
					},
				},
			},
		}); err != nil {
			t.Fatalf("provisional Apply: %v", err)
		}
		state.DropProvisionalComponent("s1", "t1")
		dropped := state.Surface("s1").ComponentsModel.Get("t1")
		if !reflect.DeepEqual(dropped.Metadata, initialMeta) {
			t.Fatalf("DropProvisionalComponent Metadata = %#v, want %#v", dropped.Metadata, initialMeta)
		}
		return nil
	})

	// 3. Rollback of deleteSurface preserves Locale, ProtocolVersion, AvailableCatalogs, and component Metadata.
	_ = state.Transaction(func() error {
		if _, err := state.Apply([]core.AgentToRendererMessage{
			{"version": "1.0", "deleteSurface": map[string]any{"surfaceId": "s1"}},
		}); err != nil {
			t.Fatalf("deleteSurface Apply: %v", err)
		}
		return errAbort
	})

	restoredSurf := state.Surface("s1")
	if restoredSurf == nil {
		t.Fatal("expected surface s1 to be restored after deleteSurface rollback")
	}
	if restoredSurf.Locale != "fr-FR" {
		t.Fatalf("restoredSurf.Locale = %q, want \"fr-FR\"", restoredSurf.Locale)
	}
	if restoredSurf.ProtocolVersion != core.Version1_0 {
		t.Fatalf("restoredSurf.ProtocolVersion = %q, want %q", restoredSurf.ProtocolVersion, core.Version1_0)
	}
	if restoredSurf.AvailableCatalogs[extraCat.CatalogID()] != extraCat {
		t.Fatalf("restoredSurf.AvailableCatalogs missing extraCat: %#v", restoredSurf.AvailableCatalogs)
	}
	restoredT1 := restoredSurf.ComponentsModel.Get("t1")
	if restoredT1 == nil || !reflect.DeepEqual(restoredT1.Metadata, initialMeta) {
		t.Fatalf("restored t1 Metadata = %#v, want %#v", restoredT1, initialMeta)
	}

	// 4. Rollback invalidates SurfaceComponentsModel topology bound cache.
	chainState, err := agent.NewRendererState([]*core.Catalog{basic})
	if err != nil {
		t.Fatalf("NewRendererState: %v", err)
	}
	comps := make([]any, 50)
	for i := 0; i < 49; i++ {
		id := fmt.Sprintf("z%02d", i)
		if i == 0 {
			id = "root"
		}
		comps[i] = map[string]any{"id": id, "component": "Column", "children": []any{fmt.Sprintf("z%02d", i+1)}}
	}
	comps[49] = map[string]any{"id": "z49", "component": "Text", "text": "leaf"}
	if _, err := chainState.Apply([]core.AgentToRendererMessage{
		{"version": "1.0", "createSurface": map[string]any{"surfaceId": "s1", "catalogId": basic.CatalogID()}},
		{"version": "1.0", "updateComponents": map[string]any{"surfaceId": "s1", "components": comps}},
	}); err != nil {
		t.Fatalf("chain Apply: %v", err)
	}
	// Inside a rolled-back transaction, sever root -> z01 and update z49 so the cached bound records z01..z49 detached from root.
	_ = chainState.Transaction(func() error {
		if _, err := chainState.Apply([]core.AgentToRendererMessage{
			{
				"version": "1.0",
				"updateComponents": map[string]any{
					"surfaceId":  "s1",
					"components": []any{map[string]any{"id": "root", "component": "Column", "children": []any{}}},
				},
			},
			{
				"version": "1.0",
				"updateComponents": map[string]any{
					"surfaceId":  "s1",
					"components": []any{map[string]any{"id": "z49", "component": "Text", "text": "short"}},
				},
			},
		}); err != nil {
			t.Fatalf("shorten Apply: %v", err)
		}
		return errAbort
	})
	// After rollback, root -> z01 -> ... -> z49 is back at depth 49; adding z49 -> z50 -> z51 reaches depth 51 > MaxComponentGraphDepth (50).
	_, err = chainState.Apply([]core.AgentToRendererMessage{
		{
			"version": "1.0",
			"updateComponents": map[string]any{
				"surfaceId": "s1",
				"components": []any{
					map[string]any{"id": "z49", "component": "Column", "children": []any{"z50"}},
					map[string]any{"id": "z50", "component": "Column", "children": []any{"z51"}},
					map[string]any{"id": "z51", "component": "Text", "text": "too deep"},
				},
			},
		},
	})
	if err == nil {
		t.Fatal("expected depth error after rollback invalidated shortened topology bound")
	}
}

func assertValidUTF8Recursive(t *testing.T, v any, where string) {
	t.Helper()
	switch val := v.(type) {
	case string:
		if !utf8.ValidString(val) {
			t.Fatalf("%s emitted invalid UTF-8 string: %x", where, val)
		}
	case map[string]any:
		for k, item := range val {
			if !utf8.ValidString(k) {
				t.Fatalf("%s emitted invalid UTF-8 map key: %x", where, k)
			}
			assertValidUTF8Recursive(t, item, where+"."+k)
		}
	case core.AgentToRendererMessage:
		assertValidUTF8Recursive(t, map[string]any(val), where)
	case []any:
		for i, item := range val {
			assertValidUTF8Recursive(t, item, fmt.Sprintf("%s[%d]", where, i))
		}
	}
}

func TestByteByByteUTF8StreamingNeverEmitsInvalidUTF8(t *testing.T) {
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}

	t.Run("DirectJSON", func(t *testing.T) {
		parser, err := agent.NewDirectJSONParser([]*core.Catalog{basic}, &agent.DirectJSONFormatOptions{
			ProgressiveKeys: []string{"text"},
		})
		if err != nil {
			t.Fatalf("NewDirectJSONParser: %v", err)
		}
		full := "Bonjour café 中文 🎉\n" +
			`<a2ui-json>[` +
			`{"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"` + basic.CatalogID() + `"}},` +
			`{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Text","text":"Привет café 中文 🎉🚀"}]}}` +
			`]</a2ui-json>` +
			"\nAprès bloc — résumé 🚀!"

		stream, err := parser.OpenStream(nil)
		if err != nil {
			t.Fatalf("OpenStream: %v", err)
		}
		var streamedText strings.Builder
		for i := 0; i < len(full); i++ {
			parts, err := stream.Feed(full[i : i+1])
			if err != nil {
				t.Fatalf("Feed byte %d (%#x): %v", i, full[i], err)
			}
			for _, p := range parts {
				if p.IsText() {
					if !utf8.ValidString(p.Text) {
						t.Fatalf("byte %d emitted invalid UTF-8 text: %x", i, p.Text)
					}
					streamedText.WriteString(p.Text)
				}
				for _, m := range p.A2UI {
					assertValidUTF8Recursive(t, m, fmt.Sprintf("DirectJSON byte %d", i))
				}
			}
		}
		tail, err := stream.Close()
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
		for _, p := range tail {
			if p.IsText() {
				if !utf8.ValidString(p.Text) {
					t.Fatalf("Close emitted invalid UTF-8 text: %x", p.Text)
				}
				streamedText.WriteString(p.Text)
			}
			for _, m := range p.A2UI {
				assertValidUTF8Recursive(t, m, "DirectJSON Close")
			}
		}

		wantParts, err := parser.ParseResponse(full, nil)
		if err != nil {
			t.Fatalf("ParseResponse: %v", err)
		}
		var wantText strings.Builder
		for _, wp := range wantParts {
			if wp.IsText() {
				wantText.WriteString(wp.Text)
			}
		}
		if streamedText.String() != wantText.String() {
			t.Fatalf("streamed text = %q, want %q", streamedText.String(), wantText.String())
		}
		gotComp := stream.State().Surface("s1").ComponentsModel.Get("root")
		if gotComp.Properties["text"] != "Привет café 中文 🎉🚀" {
			t.Fatalf("final root text = %q, want %q", gotComp.Properties["text"], "Привет café 中文 🎉🚀")
		}
	})

	t.Run("Express", func(t *testing.T) {
		parser, err := agent.NewExpressParser([]*core.Catalog{basic}, &agent.ExpressFormatOptions{
			ProgressiveKeys: []string{"text"},
		})
		if err != nil {
			t.Fatalf("NewExpressParser: %v", err)
		}
		full := "Intro café 中文 🎉\n" +
			"<a2ui>\n" +
			"surface(\"s1\")\n" +
			"root = Text(\"\"\"Quote \"café\" 中文 🎉🚀\"\"\")\n" +
			"</a2ui>\u00a0Outro — 🚀!"

		stream, err := parser.OpenStream(nil)
		if err != nil {
			t.Fatalf("OpenStream: %v", err)
		}
		var streamedText strings.Builder
		for i := 0; i < len(full); i++ {
			parts, err := stream.Feed(full[i : i+1])
			if err != nil {
				t.Fatalf("Feed byte %d (%#x): %v", i, full[i], err)
			}
			for _, p := range parts {
				if p.IsText() {
					if !utf8.ValidString(p.Text) {
						t.Fatalf("byte %d emitted invalid UTF-8 text: %x", i, p.Text)
					}
					streamedText.WriteString(p.Text)
				}
				for _, m := range p.A2UI {
					assertValidUTF8Recursive(t, m, fmt.Sprintf("Express byte %d", i))
				}
			}
		}
		tail, err := stream.Close()
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
		for _, p := range tail {
			if p.IsText() {
				if !utf8.ValidString(p.Text) {
					t.Fatalf("Close emitted invalid UTF-8 text: %x", p.Text)
				}
				streamedText.WriteString(p.Text)
			}
			for _, m := range p.A2UI {
				assertValidUTF8Recursive(t, m, "Express Close")
			}
		}

		wantParts, err := parser.ParseResponse(full, nil)
		if err != nil {
			t.Fatalf("ParseResponse: %v", err)
		}
		var wantText strings.Builder
		for _, wp := range wantParts {
			if wp.IsText() {
				wantText.WriteString(wp.Text)
			}
		}
		if streamedText.String() != wantText.String() {
			t.Fatalf("streamed text = %q, want %q", streamedText.String(), wantText.String())
		}
		gotComp := stream.State().Surface("s1").ComponentsModel.Get("root")
		if gotComp.Properties["text"] != `Quote "café" 中文 🎉🚀` {
			t.Fatalf("final root text = %q, want %q", gotComp.Properties["text"], `Quote "café" 中文 🎉🚀`)
		}
	})
}

func TestRendererFunctionCallsAndSkillFrontmatterSupportNarrowIntsJSONNumberAndTypedContainers(t *testing.T) {
	calls, err := agent.NewRendererFunctionCalls(nil)
	if err != nil {
		t.Fatalf("NewRendererFunctionCalls: %v", err)
	}
	defer calls.Dispose("")

	var nilIntPtr *int
	var nilStrSlice []string
	env, _, err := calls.Call(agent.CallRendererRequest{
		CatalogID: "https://example.com/cat",
		Name:      "doWork",
		Args: map[string]any{
			"i8":       int8(-3),
			"u16":      uint16(1024),
			"bigId":    json.Number("9007199254740993"),
			"tags":     []string{"a", "b"},
			"meta":     map[string]int{"count": 2},
			"nullPtr":  nilIntPtr,
			"nullList": nilStrSlice,
		},
	})
	if err != nil {
		t.Fatalf("calls.Call failed: %v", err)
	}
	body, _ := env["callRendererFunction"].(map[string]any)
	cf, _ := body["callFunction"].(map[string]any)
	args, _ := cf["args"].(map[string]any)
	if args["bigId"] != int64(9007199254740993) {
		t.Fatalf("args[bigId] = (%T) %v, want int64(9007199254740993)", args["bigId"], args["bigId"])
	}
	if !reflect.DeepEqual(args["tags"], []any{"a", "b"}) {
		t.Fatalf("args[tags] = %#v, want []any{\"a\", \"b\"}", args["tags"])
	}
	if !reflect.DeepEqual(args["meta"], map[string]any{"count": 2}) {
		t.Fatalf("args[meta] = %#v, want map[string]any{\"count\": 2}", args["meta"])
	}
	if args["nullPtr"] != nil || args["nullList"] != nil {
		t.Fatalf("expected nil pointer/slice to normalize to nil, got (%#v, %#v)", args["nullPtr"], args["nullList"])
	}

	if _, _, err := calls.Call(agent.CallRendererRequest{
		CatalogID: "https://example.com/cat",
		Name:      "doWork",
		Args:      map[string]any{"bad": json.Number("NaN")},
	}); err == nil {
		t.Fatal("expected calls.Call to reject json.Number(\"NaN\")")
	}
	if _, _, err := calls.Call(agent.CallRendererRequest{
		CatalogID: "https://example.com/cat",
		Name:      "doWork",
		Args:      map[string]any{"rawBytes": []byte{1, 2}},
	}); err == nil {
		t.Fatal("expected calls.Call to reject []byte")
	}

	sk, err := agent.NewSkill(agent.Skill{
		Name:        "test-skill",
		Description: "Test frontmatter",
		Content:     "Body",
		Metadata: map[string]any{
			"i8":   int8(-4),
			"u16":  uint16(42),
			"jint": json.Number("99"),
			"jflt": json.Number("2.5"),
			"nums": []int{1, 2},
			"kv":   map[string]uint8{"b": 2, "a": 1},
		},
	})
	if err != nil {
		t.Fatalf("NewSkill: %v", err)
	}
	rendered := sk.ToMarkdown()
	for _, wantSub := range []string{
		"i8: -4",
		"jflt: 2.5",
		"jint: 99",
		"  kv:\n    a: 1\n    b: 2",
		"  nums:\n  - 1\n  - 2",
		"u16: 42",
	} {
		if !strings.Contains(rendered, wantSub) {
			t.Fatalf("sk.Render() missing %q in:\n%s", wantSub, rendered)
		}
	}
}

func TestExtractRawDirectJSONParts(t *testing.T) {
	// 1. Case-insensitive tags, markdown fences, backticks, smart quotes, trailing commas,
	// unescaped newlines inside strings, single object vs array, and catalog-free custom envelopes.
	raw := "  Hello there!  \n" +
		"```json\n" +
		"<A2UI-JSON>\n" +
		"{\n" +
		"  \u201ccustomEnvelope\u201d: {\n" +
		"    \u201cnote\u201d: \u201cline1\nline2\u201d,\n" +
		"  },\n" +
		"}\n" +
		"</A2UI-JSON>\n" +
		"```\n" +
		"   \n" +
		"`<a2ui-json>[{\"version\":\"1.0\",\"deleteSurface\":{\"surfaceId\":\"s1\"}},]</a2ui-json>`"

	parts, err := agent.ExtractRawDirectJSONParts(raw)
	if err != nil {
		t.Fatalf("ExtractRawDirectJSONParts failed: %v", err)
	}
	if len(parts) != 3 {
		t.Fatalf("len(parts) = %d, want 3: %#v", len(parts), parts)
	}
	if !parts[0].IsText() || parts[0].Text != "Hello there!" {
		t.Fatalf("parts[0] = %#v, want text \"Hello there!\"", parts[0])
	}
	if !parts[1].IsA2UI() || len(parts[1].A2UI) != 1 {
		t.Fatalf("parts[1] = %#v, want 1 A2UI message", parts[1])
	}
	ce, _ := parts[1].A2UI[0]["customEnvelope"].(map[string]any)
	if ce["note"] != "line1\nline2" {
		t.Fatalf("customEnvelope.note = %q, want \"line1\\nline2\"", ce["note"])
	}
	if !parts[2].IsA2UI() || len(parts[2].A2UI) != 1 {
		t.Fatalf("parts[2] = %#v, want 1 A2UI message", parts[2])
	}

	// 2. Missing open tag recovery.
	recovered, err := agent.ExtractRawDirectJSONParts("Sure:\n[{\"version\":\"1.0\",\"deleteSurface\":{\"surfaceId\":\"s2\"}}]\n</a2ui-json>")
	if err != nil {
		t.Fatalf("missing-open-tag recovery failed: %v", err)
	}
	if len(recovered) != 2 || !recovered[0].IsText() || !recovered[1].IsA2UI() {
		t.Fatalf("unexpected recovered parts: %#v", recovered)
	}

	// 3. Error cases: unclosed block, empty block, malformed JSON, non-object element.
	for _, bad := range []string{
		"prefix <a2ui-json>{\"a\": 1}",
		"prefix <a2ui-json>   </a2ui-json>",
		"prefix <a2ui-json>{not json}</a2ui-json>",
		"prefix <a2ui-json>[42]</a2ui-json>",
		"prefix <a2ui-json>\"scalar\"</a2ui-json>",
	} {
		if _, err := agent.ExtractRawDirectJSONParts(bad); err == nil {
			t.Fatalf("expected error for %q, got nil", bad)
		} else {
			var hp agent.PartialResultsCarrier
			if !errors.As(err, &hp) || len(hp.PartialResults()) != 1 || hp.PartialResults()[0].Text != "prefix" {
				t.Fatalf("expected PartialResults([\"prefix\"]) on error for %q, got %v", bad, err)
			}
		}
	}
}
