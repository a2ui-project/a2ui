package a2uistream

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
)

const (
	openTag  = "<a2ui-json>"
	closeTag = "</a2ui-json>"
)

// ResponsePart is a segment of the LLM response.
// A part contains either conversational text, parsed A2UI messages, or both
// (text preceding a JSON block and the messages extracted from it).
type ResponsePart struct {
	Text     string               // conversational text
	Messages []a2ui.ServerMessage // A2UI v0.9 messages (nil if text-only)
	Payload  []map[string]any     // version-neutral A2UI messages (nil if text-only)
}

// Parser incrementally parses A2UI messages from text chunks.
//
// The parser handles text interleaved with A2UI JSON, where JSON blocks
// may be wrapped in <a2ui-json> tags or appear as bare JSON objects
// containing recognized A2UI message keys.
type Parser struct {
	buf        strings.Builder
	inTag      bool
	jsonBuf    strings.Builder
	braceDepth int
	inString   bool
	escaped    bool
	jsonStart  int // index in jsonBuf where current top-level object starts
}

// Reader parses A2UI response parts from an io.Reader.
type Reader struct {
	r      io.Reader
	parser *Parser
	buf    []byte
	queue  []ResponsePart
	done   bool
}

// NewParser creates a new streaming parser.
func NewParser() *Parser {
	return &Parser{}
}

// NewReader creates a parser that reads from r.
func NewReader(r io.Reader) *Reader {
	return &Reader{
		r:      r,
		parser: NewParser(),
		buf:    make([]byte, 32*1024),
	}
}

// Next returns the next parsed response part.
func (r *Reader) Next() (ResponsePart, error) {
	for len(r.queue) == 0 {
		if r.done {
			return ResponsePart{}, io.EOF
		}
		n, err := r.r.Read(r.buf)
		if n > 0 {
			parts, parseErr := r.parser.ProcessChunk(string(r.buf[:n]))
			if parseErr != nil {
				return ResponsePart{}, parseErr
			}
			r.queue = append(r.queue, parts...)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				return ResponsePart{}, err
			}
			r.done = true
			parts, parseErr := r.parser.Flush()
			if parseErr != nil {
				return ResponsePart{}, parseErr
			}
			r.queue = append(r.queue, parts...)
		}
	}
	part := r.queue[0]
	copy(r.queue, r.queue[1:])
	r.queue = r.queue[:len(r.queue)-1]
	return part, nil
}

// ProcessChunk feeds a chunk of text and returns any complete parts found.
func (p *Parser) ProcessChunk(chunk string) ([]ResponsePart, error) {
	p.buf.WriteString(chunk)
	return p.drain()
}

// Flush returns any remaining buffered content as a text part.
func (p *Parser) Flush() ([]ResponsePart, error) {
	// If we're inside a tag, try to parse whatever JSON we have.
	if p.inTag && p.jsonBuf.Len() > 0 {
		parts, err := p.finishJSON()
		if err != nil {
			return nil, err
		}
		p.inTag = false
		p.resetJSON()
		// Append any remaining buffer text.
		if p.buf.Len() > 0 {
			text := p.buf.String()
			p.buf.Reset()
			if len(parts) > 0 && parts[0].Messages == nil {
				parts[0].Text += text
			} else {
				parts = append(parts, ResponsePart{Text: text})
			}
		}
		return parts, nil
	}
	if p.buf.Len() == 0 {
		return nil, nil
	}
	text := p.buf.String()
	p.buf.Reset()
	return []ResponsePart{{Text: text}}, nil
}

// Reset clears all parser state for reuse.
func (p *Parser) Reset() {
	p.buf.Reset()
	p.inTag = false
	p.resetJSON()
}

func (p *Parser) resetJSON() {
	p.jsonBuf.Reset()
	p.braceDepth = 0
	p.inString = false
	p.escaped = false
	p.jsonStart = 0
}

func (p *Parser) drain() ([]ResponsePart, error) {
	var parts []ResponsePart
	for {
		if !p.inTag {
			got, done := p.scanForOpen(&parts)
			if done || !got {
				break
			}
		}
		if p.inTag {
			got, err := p.scanForClose(&parts)
			if err != nil {
				return parts, err
			}
			if !got {
				break
			}
		}
	}
	return parts, nil
}

// scanForOpen looks for <a2ui-json> in the buffer.
// Returns (found, done). done=true means we should stop draining.
func (p *Parser) scanForOpen(parts *[]ResponsePart) (bool, bool) {
	s := p.buf.String()
	tagIdx := strings.Index(s, openTag)
	limit := len(s)
	if tagIdx >= 0 {
		limit = tagIdx
	}
	for searchFrom := 0; searchFrom < limit; {
		rel := strings.IndexByte(s[searchFrom:limit], '{')
		if rel < 0 {
			break
		}
		idx := searchFrom + rel
		if !isBareJSONBoundary(s, idx) {
			searchFrom = idx + 1
			continue
		}
		candidate := s[idx:]
		if !possibleBareMessagePrefix(candidate) {
			searchFrom = idx + 1
			continue
		}
		end, complete := scanJSONObject(candidate)
		if !complete {
			if idx > 0 {
				*parts = append(*parts, ResponsePart{Text: s[:idx]})
				p.buf.Reset()
				p.buf.WriteString(candidate)
			}
			return false, true
		}
		obj := candidate[:end]
		msg, hasMessage := parseMessage(obj)
		payload, hasPayload := parsePayloadObject(obj)
		if hasMessage || hasPayload {
			if idx > 0 {
				*parts = append(*parts, ResponsePart{Text: s[:idx]})
			}
			part := ResponsePart{}
			if hasMessage {
				part.Messages = []a2ui.ServerMessage{msg}
			}
			if hasPayload {
				part.Payload = []map[string]any{payload}
			}
			*parts = append(*parts, part)
			p.buf.Reset()
			p.buf.WriteString(candidate[end:])
			return true, false
		}
		searchFrom = idx + 1
	}
	if tagIdx >= 0 {
		if tagIdx > 0 {
			*parts = append(*parts, ResponsePart{Text: s[:tagIdx]})
		}
		p.buf.Reset()
		p.buf.WriteString(s[tagIdx+len(openTag):])
		p.inTag = true
		p.resetJSON()
		return true, false
	}
	// Keep potential partial tag prefix in the buffer.
	keepLen := partialSuffix(s, openTag)
	if safeLen := len(s) - keepLen; safeLen > 0 {
		*parts = append(*parts, ResponsePart{Text: s[:safeLen]})
		p.buf.Reset()
		p.buf.WriteString(s[safeLen:])
	}
	return false, true
}

// scanForClose looks for </a2ui-json> in the buffer while processing JSON.
func (p *Parser) scanForClose(parts *[]ResponsePart) (bool, error) {
	s := p.buf.String()
	idx := strings.Index(s, closeTag)
	if idx >= 0 {
		// Process everything before the close tag as JSON.
		p.feedJSON(s[:idx])
		jsonParts, err := p.finishJSON()
		if err != nil {
			return false, err
		}
		*parts = append(*parts, jsonParts...)
		p.inTag = false
		p.resetJSON()
		p.buf.Reset()
		p.buf.WriteString(s[idx+len(closeTag):])
		return true, nil
	}
	// No close tag found yet. Process what we can, keeping a safe suffix.
	keepLen := partialSuffix(s, closeTag)
	if safeLen := len(s) - keepLen; safeLen > 0 {
		p.feedJSON(s[:safeLen])
		p.buf.Reset()
		p.buf.WriteString(s[safeLen:])
	}
	return false, nil
}

// feedJSON processes characters of JSON content, tracking brace depth and
// extracting complete top-level objects.
func (p *Parser) feedJSON(s string) {
	for _, c := range s {
		if p.inString {
			p.jsonBuf.WriteRune(c)
			if p.escaped {
				p.escaped = false
				continue
			}
			switch c {
			case '\\':
				p.escaped = true
			case '"':
				p.inString = false
			}
			continue
		}

		switch c {
		case '"':
			p.inString = true
			p.jsonBuf.WriteRune(c)
		case '{':
			if p.braceDepth == 0 {
				p.jsonStart = p.jsonBuf.Len()
			}
			p.braceDepth++
			p.jsonBuf.WriteRune(c)
		case '}':
			p.braceDepth--
			p.jsonBuf.WriteRune(c)
			// Object complete — handled in finishJSON or next drain.
		default:
			if p.braceDepth > 0 {
				p.jsonBuf.WriteRune(c)
			}
		}
	}
}

// finishJSON extracts all complete JSON objects from the json buffer.
func (p *Parser) finishJSON() ([]ResponsePart, error) {
	return p.extractObjects()
}

// extractObjects scans the jsonBuf for complete top-level JSON objects
// and parses them as ServerMessages.
func (p *Parser) extractObjects() ([]ResponsePart, error) {
	raw := p.jsonBuf.String()
	var msgs []a2ui.ServerMessage
	var payload []map[string]any

	depth := 0
	inStr := false
	esc := false
	start := -1

	for i, c := range raw {
		if inStr {
			if esc {
				esc = false
				continue
			}
			switch c {
			case '\\':
				esc = true
			case '"':
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			depth--
			if depth == 0 && start >= 0 {
				obj := raw[start : i+1]
				msg, hasMessage := parseMessage(obj)
				if hasMessage {
					msgs = append(msgs, msg)
				}
				if p, ok := parsePayloadObject(obj); ok {
					payload = append(payload, p)
				}
				start = -1
			}
		}
	}

	if len(msgs) == 0 && len(payload) == 0 {
		return nil, nil
	}
	return []ResponsePart{{Messages: msgs, Payload: payload}}, nil
}

// isA2UIMessage returns true if the message has at least one recognized payload.
func isA2UIMessage(m a2ui.ServerMessage) bool {
	return m.CreateSurface != nil ||
		m.UpdateComponents != nil ||
		m.UpdateDataModel != nil ||
		m.DeleteSurface != nil
}

func parseMessage(obj string) (a2ui.ServerMessage, bool) {
	var msg a2ui.ServerMessage
	if err := json.Unmarshal([]byte(obj), &msg); err != nil || !isA2UIMessage(msg) {
		return a2ui.ServerMessage{}, false
	}
	return msg, true
}

func parsePayloadObject(obj string) (map[string]any, bool) {
	dec := json.NewDecoder(bytes.NewReader([]byte(obj)))
	dec.UseNumber()
	var payload map[string]any
	if err := dec.Decode(&payload); err != nil || !isA2UIPayload(payload) {
		return nil, false
	}
	return payload, true
}

func isA2UIPayload(payload map[string]any) bool {
	for _, key := range payloadMessageKeys {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	return false
}

// partialSuffix returns the length of the longest suffix of s that
// is a prefix of tag. This prevents splitting a tag across chunks.
func partialSuffix(s, tag string) int {
	maxCheck := len(tag) - 1
	if maxCheck > len(s) {
		maxCheck = len(s)
	}
	for i := maxCheck; i > 0; i-- {
		if strings.HasSuffix(s, tag[:i]) {
			return i
		}
	}
	return 0
}

var bareMessageKeys = []string{
	"version",
	"functionCallId",
	"actionId",
	"wantResponse",
	"createSurface",
	"updateComponents",
	"updateDataModel",
	"deleteSurface",
	"callFunction",
	"actionResponse",
}

var payloadMessageKeys = []string{
	"createSurface",
	"updateComponents",
	"updateDataModel",
	"deleteSurface",
	"callFunction",
	"actionResponse",
}

func isBareJSONBoundary(s string, idx int) bool {
	if idx == 0 {
		return true
	}
	switch s[idx-1] {
	case ' ', '\t', '\n', '\r':
		return true
	default:
		return false
	}
}

func possibleBareMessagePrefix(s string) bool {
	if s == "" || s[0] != '{' {
		return false
	}
	i := 1
	for i < len(s) && isJSONSpace(s[i]) {
		i++
	}
	if i == len(s) {
		return true
	}
	if s[i] != '"' {
		return false
	}
	i++
	start := i
	for i < len(s) && isJSONKeyChar(s[i]) {
		i++
	}
	fragment := s[start:i]
	if i == len(s) || s[i] != '"' {
		return hasKnownKeyPrefix(fragment)
	}
	if !isKnownKey(fragment) {
		return false
	}
	i++
	for i < len(s) && isJSONSpace(s[i]) {
		i++
	}
	return i == len(s) || s[i] == ':'
}

func scanJSONObject(s string) (int, bool) {
	if s == "" || s[0] != '{' {
		return 0, false
	}
	depth := 0
	inString := false
	escaped := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			switch c {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}
		switch c {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1, true
			}
		}
	}
	return 0, false
}

func hasKnownKeyPrefix(fragment string) bool {
	if fragment == "" {
		return true
	}
	for _, key := range bareMessageKeys {
		if strings.HasPrefix(key, fragment) {
			return true
		}
	}
	return false
}

func isKnownKey(fragment string) bool {
	for _, key := range bareMessageKeys {
		if key == fragment {
			return true
		}
	}
	return false
}

func isJSONKeyChar(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

func isJSONSpace(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r':
		return true
	default:
		return false
	}
}
