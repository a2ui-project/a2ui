package a2uistream

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// V08Part is a segment of a v0.8 response.
type V08Part struct {
	Text     string
	Messages []map[string]any
}

// V08Parser incrementally parses legacy A2UI v0.8 response chunks.
type V08Parser struct {
	buf        strings.Builder
	inTag      bool
	jsonBuf    strings.Builder
	rootID     string
	surfaceID  string
	components map[string]map[string]any
}

// V08Reader parses v0.8 response parts from an io.Reader.
type V08Reader struct {
	r      io.Reader
	parser *V08Parser
	buf    []byte
	queue  []V08Part
	done   bool
}

// NewV08Parser creates a legacy v0.8 streaming parser.
func NewV08Parser() *V08Parser {
	return &V08Parser{components: make(map[string]map[string]any)}
}

// NewV08Reader creates a v0.8 parser that reads from r.
func NewV08Reader(r io.Reader) *V08Reader {
	return &V08Reader{
		r:      r,
		parser: NewV08Parser(),
		buf:    make([]byte, 32*1024),
	}
}

// Next returns the next parsed v0.8 response part.
func (r *V08Reader) Next() (V08Part, error) {
	for len(r.queue) == 0 {
		if r.done {
			return V08Part{}, io.EOF
		}
		n, err := r.r.Read(r.buf)
		if n > 0 {
			parts, parseErr := r.parser.ProcessChunk(string(r.buf[:n]))
			if parseErr != nil {
				return V08Part{}, parseErr
			}
			r.queue = append(r.queue, parts...)
		}
		if err != nil {
			if err != io.EOF {
				return V08Part{}, err
			}
			r.done = true
			parts, parseErr := r.parser.Flush()
			if parseErr != nil {
				return V08Part{}, parseErr
			}
			r.queue = append(r.queue, parts...)
		}
	}
	part := r.queue[0]
	copy(r.queue, r.queue[1:])
	r.queue = r.queue[:len(r.queue)-1]
	return part, nil
}

// ProcessChunk feeds a response chunk and returns complete v0.8 parts.
func (p *V08Parser) ProcessChunk(chunk string) ([]V08Part, error) {
	p.buf.WriteString(chunk)
	return p.drain()
}

// Flush returns remaining text.
func (p *V08Parser) Flush() ([]V08Part, error) {
	if p.inTag && p.jsonBuf.Len() > 0 {
		parts, err := p.extractObjects()
		if err != nil {
			return nil, err
		}
		p.inTag = false
		p.jsonBuf.Reset()
		if p.buf.Len() > 0 {
			text := p.buf.String()
			p.buf.Reset()
			parts = append(parts, V08Part{Text: text})
		}
		return parts, nil
	}
	if p.buf.Len() == 0 {
		return nil, nil
	}
	text := p.buf.String()
	p.buf.Reset()
	return []V08Part{{Text: text}}, nil
}

func (p *V08Parser) drain() ([]V08Part, error) {
	var parts []V08Part
	for {
		if !p.inTag {
			found, done := p.scanV08Open(&parts)
			if done || !found {
				break
			}
		}
		if p.inTag {
			found, err := p.scanV08Close(&parts)
			if err != nil {
				return parts, err
			}
			if !found {
				break
			}
		}
	}
	return parts, nil
}

func (p *V08Parser) scanV08Open(parts *[]V08Part) (bool, bool) {
	s := p.buf.String()
	idx := strings.Index(s, openTag)
	if idx >= 0 {
		if idx > 0 {
			*parts = append(*parts, V08Part{Text: s[:idx]})
		}
		p.buf.Reset()
		p.buf.WriteString(s[idx+len(openTag):])
		p.inTag = true
		return true, false
	}
	keepLen := partialSuffix(s, openTag)
	if safeLen := len(s) - keepLen; safeLen > 0 {
		*parts = append(*parts, V08Part{Text: s[:safeLen]})
		p.buf.Reset()
		p.buf.WriteString(s[safeLen:])
	}
	return false, true
}

func (p *V08Parser) scanV08Close(parts *[]V08Part) (bool, error) {
	s := p.buf.String()
	idx := strings.Index(s, closeTag)
	if idx >= 0 {
		p.jsonBuf.WriteString(s[:idx])
		jsonParts, err := p.extractObjects()
		if err != nil {
			return false, err
		}
		*parts = append(*parts, jsonParts...)
		p.inTag = false
		p.jsonBuf.Reset()
		p.buf.Reset()
		p.buf.WriteString(s[idx+len(closeTag):])
		return true, nil
	}
	keepLen := partialSuffix(s, closeTag)
	if safeLen := len(s) - keepLen; safeLen > 0 {
		p.jsonBuf.WriteString(s[:safeLen])
		p.buf.Reset()
		p.buf.WriteString(s[safeLen:])
		jsonParts, err := p.extractObjects()
		if err != nil {
			return false, err
		}
		*parts = append(*parts, jsonParts...)
	}
	return false, nil
}

func (p *V08Parser) extractObjects() ([]V08Part, error) {
	raw := p.jsonBuf.String()
	var parts []V08Part
	consumed := 0
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
				var msg map[string]any
				if err := json.Unmarshal([]byte(raw[start:i+1]), &msg); err != nil {
					return nil, err
				}
				part, err := p.handleV08Message(msg)
				if err != nil {
					return nil, err
				}
				if len(part.Messages) > 0 {
					parts = append(parts, part)
				}
				consumed = i + 1
				start = -1
			}
		}
	}
	if consumed > 0 {
		p.jsonBuf.Reset()
		p.jsonBuf.WriteString(raw[consumed:])
	}
	return parts, nil
}

func (p *V08Parser) handleV08Message(msg map[string]any) (V08Part, error) {
	if begin, ok := msg["beginRendering"].(map[string]any); ok {
		p.surfaceID, _ = begin["surfaceId"].(string)
		p.rootID, _ = begin["root"].(string)
		return V08Part{Messages: []map[string]any{msg}}, nil
	}
	if update, ok := msg["surfaceUpdate"].(map[string]any); ok {
		if sid, _ := update["surfaceId"].(string); sid != "" {
			p.surfaceID = sid
		}
		for _, comp := range v08Components(update["components"]) {
			if id, _ := comp["id"].(string); id != "" {
				p.components[id] = comp
			}
		}
		if p.rootID == "" {
			return V08Part{}, nil
		}
		reachable, err := p.reachableComponents()
		if err != nil {
			return V08Part{}, err
		}
		if len(reachable) == 0 {
			return V08Part{}, nil
		}
		return V08Part{Messages: []map[string]any{{"surfaceUpdate": map[string]any{
			"surfaceId":  p.surfaceID,
			"components": reachable,
		}}}}, nil
	}
	if _, ok := msg["dataModelUpdate"]; ok {
		return V08Part{Messages: []map[string]any{msg}}, nil
	}
	if _, ok := msg["deleteSurface"]; ok {
		return V08Part{Messages: []map[string]any{msg}}, nil
	}
	return V08Part{}, nil
}

func (p *V08Parser) reachableComponents() ([]map[string]any, error) {
	seen := make(map[string]bool)
	stack := make(map[string]bool)
	var out []map[string]any
	var visit func(string) error
	visit = func(id string) error {
		if stack[id] {
			if id == p.rootID && len(stack) == 1 {
				return fmt.Errorf("self-reference detected")
			}
			return fmt.Errorf("circular reference detected")
		}
		if seen[id] {
			return nil
		}
		comp := p.components[id]
		if comp == nil {
			return nil
		}
		stack[id] = true
		for _, ref := range v08Refs(comp) {
			if err := visit(ref); err != nil {
				return err
			}
		}
		stack[id] = false
		seen[id] = true
		out = append(out, comp)
		return nil
	}
	if err := visit(p.rootID); err != nil {
		return nil, err
	}
	return out, nil
}

func v08Components(v any) []map[string]any {
	items, _ := v.([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if comp, ok := item.(map[string]any); ok {
			out = append(out, comp)
		}
	}
	return out
}

func v08Refs(comp map[string]any) []string {
	body, _ := comp["component"].(map[string]any)
	var refs []string
	for _, raw := range body {
		obj, _ := raw.(map[string]any)
		if child, _ := obj["child"].(string); child != "" {
			refs = append(refs, child)
		}
		if children, ok := obj["children"].(map[string]any); ok {
			refs = append(refs, stringSlice(children["explicitList"])...)
		}
	}
	return refs
}

func stringSlice(v any) []string {
	items, _ := v.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
