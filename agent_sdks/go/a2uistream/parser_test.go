package a2uistream

import (
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
)

func TestPureText(t *testing.T) {
	p := NewParser()
	parts, err := p.ProcessChunk("Hello, world!")
	if err != nil {
		t.Fatal(err)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	parts = append(parts, flush...)
	text := collectText(parts)
	if text != "Hello, world!" {
		t.Errorf("got %q, want %q", text, "Hello, world!")
	}
	if msgs := collectMessages(parts); len(msgs) != 0 {
		t.Errorf("expected no messages, got %d", len(msgs))
	}
}

func TestV010CallFunctionPayload(t *testing.T) {
	input := `<a2ui-json>{"version":"v0.10","functionCallId":"call-1","wantResponse":true,"callFunction":{"call":"lookup","returnType":"string"}}</a2ui-json>`

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	parts = append(parts, flush...)

	if msgs := collectMessages(parts); len(msgs) != 0 {
		t.Fatalf("legacy messages = %d, want 0", len(msgs))
	}
	payload := collectPayload(parts)
	if len(payload) != 1 {
		t.Fatalf("payload count = %d, want 1", len(payload))
	}
	if got := payload[0]["functionCallId"]; got != "call-1" {
		t.Fatalf("functionCallId = %#v, want call-1", got)
	}
	if got := payload[0]["wantResponse"]; got != true {
		t.Fatalf("wantResponse = %#v, want true", got)
	}
	call, ok := payload[0]["callFunction"].(map[string]any)
	if !ok {
		t.Fatalf("callFunction = %#v, want object", payload[0]["callFunction"])
	}
	if got := call["call"]; got != "lookup" {
		t.Fatalf("callFunction.call = %#v, want lookup", got)
	}
}

func TestBareV010CallFunctionPayload(t *testing.T) {
	input := `before {"version":"v0.10","functionCallId":"call-1","callFunction":{"call":"lookup","returnType":"string"}} after`

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	parts = append(parts, flush...)

	if got := collectText(parts); got != "before  after" {
		t.Fatalf("text = %q, want %q", got, "before  after")
	}
	payload := collectPayload(parts)
	if len(payload) != 1 {
		t.Fatalf("payload count = %d, want 1", len(payload))
	}
	if got := payload[0]["functionCallId"]; got != "call-1" {
		t.Fatalf("functionCallId = %#v, want call-1", got)
	}
}

func TestVersionOnlyJSONRemainsText(t *testing.T) {
	p := NewParser()
	parts, err := p.ProcessChunk(`prefix {"version":"v0.10"} suffix`)
	if err != nil {
		t.Fatal(err)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	parts = append(parts, flush...)

	if text := collectText(parts); text != `prefix {"version":"v0.10"} suffix` {
		t.Fatalf("text = %q", text)
	}
	if payload := collectPayload(parts); len(payload) != 0 {
		t.Fatalf("expected no payload, got %d", len(payload))
	}
}

func TestReaderNext(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "reader",
			CatalogID: "cat",
		},
	}
	data, _ := json.Marshal(msg)
	reader := NewReader(strings.NewReader("Before <a2ui-json>" + string(data) + "</a2ui-json> after"))

	var parts []ResponsePart
	for {
		part, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, part)
	}
	if got := collectText(parts); got != "Before  after" {
		t.Fatalf("text = %q, want %q", got, "Before  after")
	}
	msgs := collectMessages(parts)
	if len(msgs) != 1 || msgs[0].CreateSurface == nil {
		t.Fatalf("unexpected messages: %+v", msgs)
	}
}

func TestSingleJSONMessage(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "s1",
			CatalogID: "cat1",
		},
	}
	data, _ := json.Marshal(msg)
	input := "<a2ui-json>" + string(data) + "</a2ui-json>"

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, _ := p.Flush()
	parts = append(parts, flush...)

	msgs := collectMessages(parts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].CreateSurface == nil {
		t.Fatal("expected CreateSurface message")
	}
	if msgs[0].CreateSurface.SurfaceID != "s1" {
		t.Errorf("surfaceId = %q, want %q", msgs[0].CreateSurface.SurfaceID, "s1")
	}
}

func TestWrappedInTags(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		UpdateDataModel: &a2ui.UpdateDataModel{
			SurfaceID: "s1",
			Value:     map[string]any{"name": "Alice"},
		},
	}
	data, _ := json.Marshal(msg)
	input := "Here is the UI: <a2ui-json>" + string(data) + "</a2ui-json> Done."

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, _ := p.Flush()
	parts = append(parts, flush...)

	text := collectText(parts)
	if text != "Here is the UI:  Done." {
		t.Errorf("text = %q, want %q", text, "Here is the UI:  Done.")
	}
	msgs := collectMessages(parts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].UpdateDataModel == nil {
		t.Fatal("expected UpdateDataModel message")
	}
}

func TestMixedTextAndJSON(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		DeleteSurface: &a2ui.DeleteSurface{
			SurfaceID: "s1",
		},
	}
	data, _ := json.Marshal(msg)
	input := "Removing surface now.\n<a2ui-json>" + string(data) + "</a2ui-json>\nAll done."

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, _ := p.Flush()
	parts = append(parts, flush...)

	msgs := collectMessages(parts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].DeleteSurface == nil {
		t.Fatal("expected DeleteSurface message")
	}
}

func TestChunkedInput(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "chunked",
			CatalogID: "cat",
		},
	}
	data, _ := json.Marshal(msg)
	full := "<a2ui-json>" + string(data) + "</a2ui-json>"

	// Split the input into small chunks.
	p := NewParser()
	var allParts []ResponsePart
	for i := 0; i < len(full); i += 7 {
		end := i + 7
		if end > len(full) {
			end = len(full)
		}
		parts, err := p.ProcessChunk(full[i:end])
		if err != nil {
			t.Fatal(err)
		}
		allParts = append(allParts, parts...)
	}
	flush, _ := p.Flush()
	allParts = append(allParts, flush...)

	msgs := collectMessages(allParts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].CreateSurface == nil || msgs[0].CreateSurface.SurfaceID != "chunked" {
		t.Errorf("unexpected message: %+v", msgs[0])
	}
}

func TestBareJSONMessage(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		DeleteSurface: &a2ui.DeleteSurface{
			SurfaceID: "s1",
		},
	}
	data, _ := json.Marshal(msg)

	p := NewParser()
	parts, err := p.ProcessChunk(string(data))
	if err != nil {
		t.Fatal(err)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	parts = append(parts, flush...)

	msgs := collectMessages(parts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].DeleteSurface == nil || msgs[0].DeleteSurface.SurfaceID != "s1" {
		t.Fatalf("unexpected message: %+v", msgs[0])
	}
}

func TestChunkedBareJSONMessage(t *testing.T) {
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "bare",
			CatalogID: "cat",
		},
	}
	data, _ := json.Marshal(msg)

	p := NewParser()
	var allParts []ResponsePart
	for i := 0; i < len(data); i += 5 {
		end := i + 5
		if end > len(data) {
			end = len(data)
		}
		parts, err := p.ProcessChunk(string(data[i:end]))
		if err != nil {
			t.Fatal(err)
		}
		allParts = append(allParts, parts...)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	allParts = append(allParts, flush...)

	msgs := collectMessages(allParts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].CreateSurface == nil || msgs[0].CreateSurface.SurfaceID != "bare" {
		t.Fatalf("unexpected message: %+v", msgs[0])
	}
}

func TestNonMessageJSONRemainsText(t *testing.T) {
	p := NewParser()
	parts, err := p.ProcessChunk(`prefix {"hello":"world"} suffix`)
	if err != nil {
		t.Fatal(err)
	}
	flush, err := p.Flush()
	if err != nil {
		t.Fatal(err)
	}
	parts = append(parts, flush...)

	if text := collectText(parts); text != `prefix {"hello":"world"} suffix` {
		t.Fatalf("text = %q", text)
	}
	if msgs := collectMessages(parts); len(msgs) != 0 {
		t.Fatalf("expected no messages, got %d", len(msgs))
	}
}

func TestMultipleMessagesInOneBlock(t *testing.T) {
	msg1 := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "s1",
			CatalogID: "cat",
		},
	}
	msg2 := a2ui.ServerMessage{
		Version: "v0.9",
		UpdateComponents: &a2ui.UpdateComponents{
			SurfaceID: "s1",
			Components: []a2ui.Component{
				{
					ID:   "root",
					Text: &a2ui.TextComponent{Text: a2ui.StringLiteral("hi")},
				},
			},
		},
	}
	d1, _ := json.Marshal(msg1)
	d2, _ := json.Marshal(msg2)
	input := "<a2ui-json>" + string(d1) + string(d2) + "</a2ui-json>"

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, _ := p.Flush()
	parts = append(parts, flush...)

	msgs := collectMessages(parts)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[0].CreateSurface == nil {
		t.Error("first message should be CreateSurface")
	}
	if msgs[1].UpdateComponents == nil {
		t.Error("second message should be UpdateComponents")
	}
}

func TestMultipleBlocks(t *testing.T) {
	msg1 := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "s1",
			CatalogID: "cat",
		},
	}
	msg2 := a2ui.ServerMessage{
		Version: "v0.9",
		DeleteSurface: &a2ui.DeleteSurface{
			SurfaceID: "s1",
		},
	}
	d1, _ := json.Marshal(msg1)
	d2, _ := json.Marshal(msg2)
	input := "First: <a2ui-json>" + string(d1) + "</a2ui-json> Middle <a2ui-json>" + string(d2) + "</a2ui-json> End"

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, _ := p.Flush()
	parts = append(parts, flush...)

	msgs := collectMessages(parts)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
}

func TestEscapedBracesInStrings(t *testing.T) {
	// A message where a string value contains braces — the parser must not
	// be confused by them.
	msg := a2ui.ServerMessage{
		Version: "v0.9",
		UpdateDataModel: &a2ui.UpdateDataModel{
			SurfaceID: "s1",
			Value:     map[string]any{"code": "if (x) { y }"},
		},
	}
	data, _ := json.Marshal(msg)
	input := "<a2ui-json>" + string(data) + "</a2ui-json>"

	p := NewParser()
	parts, err := p.ProcessChunk(input)
	if err != nil {
		t.Fatal(err)
	}
	flush, _ := p.Flush()
	parts = append(parts, flush...)

	msgs := collectMessages(parts)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].UpdateDataModel == nil {
		t.Fatal("expected UpdateDataModel")
	}
}

func TestResetAndReuse(t *testing.T) {
	p := NewParser()

	msg := a2ui.ServerMessage{
		Version: "v0.9",
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "s1",
			CatalogID: "cat",
		},
	}
	data, _ := json.Marshal(msg)

	input := "<a2ui-json>" + string(data) + "</a2ui-json>"
	parts, _ := p.ProcessChunk(input)
	flush, _ := p.Flush()
	parts = append(parts, flush...)
	if len(collectMessages(parts)) != 1 {
		t.Fatal("expected 1 message before reset")
	}

	p.Reset()

	parts, _ = p.ProcessChunk(input)
	flush, _ = p.Flush()
	parts = append(parts, flush...)
	if len(collectMessages(parts)) != 1 {
		t.Fatal("expected 1 message after reset")
	}
}

func collectText(parts []ResponsePart) string {
	var b string
	for _, p := range parts {
		b += p.Text
	}
	return b
}

func collectMessages(parts []ResponsePart) []a2ui.ServerMessage {
	var msgs []a2ui.ServerMessage
	for _, p := range parts {
		msgs = append(msgs, p.Messages...)
	}
	return msgs
}

func collectPayload(parts []ResponsePart) []map[string]any {
	var payload []map[string]any
	for _, p := range parts {
		payload = append(payload, p.Payload...)
	}
	return payload
}
