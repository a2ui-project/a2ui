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

package a2aext_test

import (
	"context"
	"errors"
	"iter"
	"reflect"
	"slices"
	"testing"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

type fakeExtensionContext struct {
	requested []string
	activated []string
}

func (f *fakeExtensionContext) RequestedURIs() []string {
	return slices.Clone(f.requested)
}

func (f *fakeExtensionContext) Activate(ext *a2a.AgentExtension) {
	if ext != nil && !slices.Contains(f.activated, ext.URI) {
		f.activated = append(f.activated, ext.URI)
	}
}

type stubStream struct {
	chunks []string
	closed bool
}

func (s *stubStream) Feed(chunk string) ([]agent.StreamPart, error) {
	s.chunks = append(s.chunks, chunk)
	if chunk == "text" {
		return []agent.StreamPart{agent.NewStreamTextPart("hello")}, nil
	}
	return []agent.StreamPart{
		agent.NewStreamA2UIPart([]core.AgentToRendererMessage{
			{"version": "1.0", "deleteSurface": map[string]any{"surfaceId": "s1"}},
		}),
	}, nil
}

func (s *stubStream) Close() ([]agent.StreamPart, error) {
	s.closed = true
	return []agent.StreamPart{agent.NewStreamTextPart("done")}, nil
}

func (s *stubStream) State() *agent.RendererState { return nil }
func (s *stubStream) IsInBlock() bool             { return false }

type stubParser struct {
	parts []agent.ResponsePart
	err   error
}

func (p *stubParser) Catalogs() []*core.Catalog             { return nil }
func (p *stubParser) SupportsStreaming() bool               { return true }
func (p *stubParser) HasFormatContent(string, bool) bool    { return true }
func (p *stubParser) Wrap([]agent.RawResponsePart) string   { return "" }
func (p *stubParser) Unwrap(string) []agent.RawResponsePart { return nil }
func (p *stubParser) Compile(string, bool) ([]core.AgentToRendererMessage, error) {
	return nil, nil
}
func (p *stubParser) Decompile([]core.AgentToRendererMessage) (string, error) { return "", nil }
func (p *stubParser) WrapDecompiledBlocks([]string) string                    { return "" }
func (p *stubParser) OpenStream(*agent.StreamOptions) (agent.ResponseStream, error) {
	return &stubStream{}, nil
}
func (p *stubParser) ParseResponse(_ string, _ *agent.ParseOptions) ([]agent.ResponsePart, error) {
	return p.parts, p.err
}

func TestExtensionURIAndSelection(t *testing.T) {
	uri := a2aext.ExtensionURI(core.Version1_0)
	if uri != "https://a2ui.org/a2a-extension/a2ui/v1.0" {
		t.Fatalf("unexpected URI: %q", uri)
	}
	if ver := a2aext.ExtensionURIVersion(uri); ver != "1.0" {
		t.Fatalf("unexpected extracted version: %q", ver)
	}

	extCtx := &fakeExtensionContext{
		requested: []string{
			"https://a2ui.org/a2a-extension/a2ui/v0.9, https://a2ui.org/a2a-extension/a2ui/v1.0",
		},
	}
	card := &a2a.AgentCard{
		Capabilities: a2a.AgentCapabilities{
			Extensions: []a2a.AgentExtension{
				a2aext.AgentExtension(core.Version0_9, nil),
				a2aext.AgentExtension(core.Version1_0, &a2aext.AgentExtensionOptions{
					AcceptsInlineCatalogs: true,
					SupportedCatalogIDs:   []string{"cat-1"},
				}),
			},
		},
	}

	activatedVer, ok := a2aext.ActivateExtension(extCtx, nil, card)
	if !ok || activatedVer != core.Version1_0 {
		t.Fatalf("expected Version1_0 activated, got (%q, %v)", activatedVer, ok)
	}
	wantActivated := []string{"https://a2ui.org/a2a-extension/a2ui/v1.0"}
	if !reflect.DeepEqual(extCtx.activated, wantActivated) {
		t.Fatalf("ActivatedURIs = %v, want %v", extCtx.activated, wantActivated)
	}
}

func TestPartsAndMessageExtraction(t *testing.T) {
	msg1 := map[string]any{"version": "1.0", "deleteSurface": map[string]any{"surfaceId": "main"}}
	msg2 := map[string]any{"version": "v0.9", "deleteSurface": map[string]any{"surfaceId": "legacy"}}

	p1 := a2aext.CreateA2UIPart(msg1, "")
	p2 := a2aext.CreateA2UIPart(msg2, "")
	txt := a2a.TextPart{Text: "hello"}

	if !a2aext.IsA2UIPart(p1) || !a2aext.IsA2UIPart(p2) || a2aext.IsA2UIPart(txt) {
		t.Fatalf("unexpected IsA2UIPart classification")
	}
	dp1, ok := a2aext.A2UIDataPart(p1)
	if !ok || dp1.Metadata[a2aext.MIMETypeKey] != a2aext.A2UIMIMEType {
		t.Fatalf("expected v1.0 MIME type %q, got %v", a2aext.A2UIMIMEType, dp1)
	}
	dp2, ok := a2aext.A2UIDataPart(p2)
	if !ok || dp2.Metadata[a2aext.MIMETypeKey] != a2aext.DeprecatedA2UIMIMEType {
		t.Fatalf("expected v0.9 MIME type %q, got %v", a2aext.DeprecatedA2UIMIMEType, dp2)
	}

	a2aMsg := a2a.NewMessage(a2a.MessageRoleUser, txt, p1, p2)
	extracted := a2aext.A2UIMessagesFromMessage(a2aMsg)
	if len(extracted) != 2 || !reflect.DeepEqual(extracted[0], msg1) || !reflect.DeepEqual(extracted[1], msg2) {
		t.Fatalf("unexpected extracted messages: %#v", extracted)
	}

	created := a2aext.CreateA2UIParts([]core.AgentToRendererMessage{msg1}, core.Version1_0)
	if len(created) != 1 || !a2aext.IsA2UIPart(created[0]) {
		t.Fatalf("unexpected CreateA2UIParts output: %#v", created)
	}
}

func TestExtractA2UIJSONAndParseContentToParts(t *testing.T) {
	raw := "Intro text\n<a2ui-json>\n```json\n[{\"version\":\"1.0\",\"deleteSurface\":{\"surfaceId\":\"s1\"}}]\n```\n</a2ui-json>\nOutro"
	parts, err := a2aext.ExtractA2UIJSONToParts(raw, nil)
	if err != nil {
		t.Fatalf("ExtractA2UIJSONToParts: %v", err)
	}
	if len(parts) != 3 {
		t.Fatalf("expected 3 parts, got %d: %#v", len(parts), parts)
	}
	if tp, ok := parts[0].(a2a.TextPart); !ok || tp.Text != "Intro text" {
		t.Fatalf("unexpected first part: %#v", parts[0])
	}
	if !a2aext.IsA2UIPart(parts[1]) {
		t.Fatalf("expected A2UI part at index 1, got %#v", parts[1])
	}

	fallback, err := a2aext.ExtractA2UIJSONToParts("<a2ui-json>{bad json</a2ui-json>", &a2aext.ParseContentOptions{
		FallbackText: "Fallback message",
	})
	if err == nil {
		t.Fatalf("expected an error for malformed JSON")
	}
	if len(fallback) != 1 {
		t.Fatalf("expected fallback part, got %#v", fallback)
	}

	_, err = a2aext.ExtractA2UIJSONToParts("<a2ui-json>{\"deleteSurface\":", nil)
	var parseErr *core.ParseError
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected *core.ParseError for an unclosed block, got %T (%v)", err, err)
	}

	boom := core.NewParseError("boom")
	failed, err := a2aext.ParseContentToParts("bad", &stubParser{err: boom}, &a2aext.ParseContentOptions{
		FallbackText: "Parser fallback",
	})
	if !errors.Is(err, boom) {
		t.Fatalf("expected the parser error, got %v", err)
	}
	if len(failed) != 1 {
		t.Fatalf("expected parser fallback part, got %#v", failed)
	}
}

func TestStreamResponseToParts(t *testing.T) {
	st := &stubStream{}
	tokens := iter.Seq2[string, error](func(yield func(string, error) bool) {
		if !yield("text", nil) {
			return
		}
		yield("ui", nil)
	})

	var out []a2a.Part
	for part, err := range a2aext.StreamResponseToParts(context.Background(), st, tokens, core.Version1_0) {
		if err != nil {
			t.Fatalf("unexpected stream error: %v", err)
		}
		out = append(out, part)
	}
	if !st.closed || len(out) != 3 {
		t.Fatalf("expected closed stream with 3 parts, got closed=%v len=%d", st.closed, len(out))
	}
}
