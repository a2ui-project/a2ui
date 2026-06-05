package a2uistream

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// PayloadPart is a generic A2UI response segment.
//
// It is useful before binding a payload to a specific protocol version.
type PayloadPart struct {
	Text    string
	Payload []map[string]any
}

// HasParts reports whether s contains a complete A2UI JSON tag pair.
func HasParts(s string) bool {
	open := strings.Index(s, openTag)
	if open < 0 {
		return false
	}
	return strings.Contains(s[open+len(openTag):], closeTag)
}

// ParseResponse parses tagged A2UI JSON blocks from s.
func ParseResponse(s string) ([]PayloadPart, error) {
	var parts []PayloadPart
	lastEnd := 0
	for {
		open := strings.Index(s[lastEnd:], openTag)
		if open < 0 {
			break
		}
		open += lastEnd
		close := strings.Index(s[open+len(openTag):], closeTag)
		if close < 0 {
			break
		}
		close += open + len(openTag)
		text := strings.TrimSpace(s[lastEnd:open])
		raw := strings.TrimSpace(s[open+len(openTag) : close])
		if raw == "" {
			return nil, fmt.Errorf("a2uistream: A2UI JSON part is empty")
		}
		payload, err := FixPayload(raw)
		if err != nil {
			return nil, fmt.Errorf("a2uistream: failed to parse A2UI JSON: %w", err)
		}
		parts = append(parts, PayloadPart{Text: text, Payload: payload})
		lastEnd = close + len(closeTag)
	}
	if len(parts) == 0 {
		return nil, fmt.Errorf("a2uistream: A2UI tags %q and %q not found in response", openTag, closeTag)
	}
	if trailing := strings.TrimSpace(s[lastEnd:]); trailing != "" {
		parts = append(parts, PayloadPart{Text: trailing})
	}
	return parts, nil
}

// FixPayload parses common LLM-produced JSON payload shapes.
//
// It normalizes smart quotes, removes trailing commas, and wraps a single
// object in a list. The returned slice contains one map per payload object.
func FixPayload(s string) ([]map[string]any, error) {
	s = strings.TrimSpace(stripMarkdownFence(normalizeSmartQuotes(s)))
	s = removeTrailingCommas(s)
	if strings.HasPrefix(s, "{") {
		s = "[" + s + "]"
	}
	var out []map[string]any
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber()
	if err := dec.Decode(&out); err != nil {
		return nil, fmt.Errorf("a2uistream: parse payload: %w", err)
	}
	if strings.TrimSpace(s) == "" {
		return nil, fmt.Errorf("a2uistream: empty payload")
	}
	return out, nil
}

func normalizeSmartQuotes(s string) string {
	replacer := strings.NewReplacer(
		"\u201c", `"`,
		"\u201d", `"`,
		"\u2018", `'`,
		"\u2019", `'`,
	)
	return replacer.Replace(s)
}

func stripMarkdownFence(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	lines := strings.Split(s, "\n")
	if len(lines) < 2 {
		return s
	}
	if strings.HasPrefix(strings.TrimSpace(lines[len(lines)-1]), "```") {
		return strings.Join(lines[1:len(lines)-1], "\n")
	}
	return s
}

func removeTrailingCommas(s string) string {
	var out bytes.Buffer
	inString := false
	escaped := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inString {
			out.WriteByte(c)
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
			out.WriteByte(c)
		case ',':
			j := i + 1
			for j < len(s) && isJSONSpace(s[j]) {
				j++
			}
			if j < len(s) && (s[j] == '}' || s[j] == ']') {
				continue
			}
			out.WriteByte(c)
		default:
			out.WriteByte(c)
		}
	}
	return out.String()
}
