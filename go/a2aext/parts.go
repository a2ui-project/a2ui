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

package a2aext

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"maps"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

var (
	jsonPayloadStartRe  = regexp.MustCompile(`(?m)^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\x{201c}|\x{201d}|\}|$))`)
	a2uiJSONOpenTagRe   = regexp.MustCompile(`(?i)<a2ui-json(?:\s[^>]*)?>`)
	a2uiJSONCloseTagRe  = regexp.MustCompile(`(?i)</a2ui-json\s*>`)
	inlineFencedBlockRe = regexp.MustCompile("(?i)^([ \\t]*)`{3,}[a-zA-Z0-9_-]*[ \\t]*(<a2ui-json(?:\\s[^>]*)?>.*</a2ui-json\\s*>)[ \\t]*`{3,}[ \\t]*$")
)

// ParseContentOptions configures ParseContentToParts and ExtractA2UIJSONToParts.
type ParseContentOptions struct {
	// FallbackText is returned as a TextPart when no other part could be built.
	FallbackText string
	// Version selects the DataPart MIME type. When empty, each message's "version" is used.
	Version core.ProtocolVersion
	// State is the RendererState that ParseContentToParts validates against, if any.
	State *agent.RendererState
}

// CreateA2UIPart wraps an A2UI message in an A2A DataPart tagged with the version's MIME type.
// When version is empty, the message's own "version" is used. v0.8, v0.9, and messages without
// any version use DeprecatedA2UIMIMEType ("application/json+a2ui"); later versions use
// A2UIMIMEType ("application/a2ui+json").
func CreateA2UIPart(message core.AgentToRendererMessage, version core.ProtocolVersion) a2a.Part {
	mime := mimeTypeFor(message, version)
	return a2a.DataPart{
		Data:     map[string]any(normalizeWireMessage(message)),
		Metadata: map[string]any{MIMETypeKey: mime},
	}
}

func mimeTypeFor(message core.AgentToRendererMessage, version core.ProtocolVersion) string {
	raw := strings.TrimSpace(string(version))
	if raw == "" {
		raw, _ = message["version"].(string)
		raw = strings.TrimSpace(raw)
	}
	if raw == "" {
		return DeprecatedA2UIMIMEType
	}
	if v, ok := core.ParseSemVer(raw); ok && v.Major == 0 && v.Patch == 0 && (v.Minor == 8 || v.Minor == 9) {
		return DeprecatedA2UIMIMEType
	}
	return A2UIMIMEType
}

// IsA2UIPart reports whether part is an A2A DataPart carrying an A2UI MIME type.
func IsA2UIPart(part a2a.Part) bool {
	dp, ok := extractDataPart(part)
	if !ok {
		return false
	}
	mime, _ := dp.Metadata[MIMETypeKey].(string)
	return mime == A2UIMIMEType || mime == DeprecatedA2UIMIMEType
}

// A2UIDataPart returns the DataPart inside part when IsA2UIPart(part) is true.
func A2UIDataPart(part a2a.Part) (*a2a.DataPart, bool) {
	if !IsA2UIPart(part) {
		return nil, false
	}
	dp, _ := extractDataPart(part)
	return &dp, true
}

// A2UIMessages returns the Data maps of the A2UI DataParts in parts, in order.
func A2UIMessages(parts []a2a.Part) []map[string]any {
	out := make([]map[string]any, 0, len(parts))
	for _, part := range parts {
		if dp, ok := A2UIDataPart(part); ok {
			out = append(out, dp.Data)
		}
	}
	return out
}

// A2UIMessagesFromMessage returns the Data maps of the A2UI DataParts in message.
func A2UIMessagesFromMessage(message *a2a.Message) []map[string]any {
	if message == nil {
		return nil
	}
	return A2UIMessages(message.Parts)
}

// CreateA2UIParts wraps outbound A2UI messages, such as RPC replies, in A2A DataParts.
func CreateA2UIParts(messages []core.AgentToRendererMessage, version core.ProtocolVersion) []a2a.Part {
	out := make([]a2a.Part, 0, len(messages))
	for _, msg := range messages {
		out = append(out, CreateA2UIPart(msg, version))
	}
	return out
}

// ToA2AParts converts parsed ResponseParts into A2A TextParts and DataParts, dropping empty text.
func ToA2AParts(responseParts []agent.ResponsePart, version core.ProtocolVersion) []a2a.Part {
	var out []a2a.Part
	for _, part := range responseParts {
		if part.IsText() {
			if part.Text != "" {
				out = append(out, a2a.TextPart{Text: part.Text})
			}
			continue
		}
		for _, msg := range part.A2UI {
			out = append(out, CreateA2UIPart(msg, version))
		}
	}
	return out
}

// StreamPartsToA2AParts converts the non-error StreamParts of a ResponseStream into A2A parts.
func StreamPartsToA2AParts(streamParts []agent.StreamPart, version core.ProtocolVersion) []a2a.Part {
	var out []a2a.Part
	for _, sp := range streamParts {
		if rp, ok := sp.ToResponsePart(); ok {
			out = append(out, ToA2AParts([]agent.ResponsePart{rp}, version)...)
		}
	}
	return out
}

// StreamResponseToParts feeds tokens through stream and yields A2A parts as they become
// available, closing stream after the last token.
func StreamResponseToParts(ctx context.Context, stream agent.ResponseStream, tokens iter.Seq2[string, error], version core.ProtocolVersion) iter.Seq2[a2a.Part, error] {
	return func(yield func(a2a.Part, error) bool) {
		for sp, err := range agent.StreamChunks(ctx, stream, tokens) {
			if err != nil {
				yield(nil, err)
				return
			}
			for _, part := range StreamPartsToA2AParts([]agent.StreamPart{sp}, version) {
				if !yield(part, nil) {
					return
				}
			}
		}
	}
}

// ParseContentToParts parses and validates a complete LLM response into A2A parts with parser.
//
// If parsing fails, it returns the error together with the fallback parts, so callers can
// either send those or retry the turn. When no part remains, opts.FallbackText (if set) is
// returned as a single TextPart.
func ParseContentToParts(content string, parser agent.Parser, opts *ParseContentOptions) ([]a2a.Part, error) {
	var resolved ParseContentOptions
	if opts != nil {
		resolved = *opts
	}
	var parts []a2a.Part
	var parseErr error
	if parser != nil {
		parsed, err := parser.ParseResponse(content, &agent.ParseOptions{State: resolved.State})
		if err != nil {
			parseErr = err
		} else {
			parts = ToA2AParts(parsed, resolved.Version)
		}
	}
	return withFallback(parts, resolved.FallbackText), parseErr
}

// ExtractA2UIJSONToParts splits conversational text and <a2ui-json> blocks into A2A parts
// without a Catalog or Parser.
//
// Unclosed or malformed blocks are skipped and reported in the returned error, which joins
// one error per skipped block. The parts built from the other blocks are still returned, and
// opts.FallbackText (if set) is returned as a single TextPart when no part remains.
func ExtractA2UIJSONToParts(content string, opts *ParseContentOptions) ([]a2a.Part, error) {
	var resolved ParseContentOptions
	if opts != nil {
		resolved = *opts
	}
	var parts []a2a.Part
	var errs []error
	for _, seg := range tokenizeJSONBlocks(content) {
		if seg.isText {
			if trimmed := strings.TrimSpace(seg.text); trimmed != "" {
				parts = append(parts, a2a.TextPart{Text: trimmed})
			}
			continue
		}
		if !seg.isFinal {
			errs = append(errs, core.NewParseError("the A2UI JSON block is not closed"))
			continue
		}
		messages, err := parseRawJSONMessages(seg.raw)
		if err != nil {
			errs = append(errs, fmt.Errorf("parse A2UI JSON block: %w", err))
			continue
		}
		for _, msg := range messages {
			parts = append(parts, CreateA2UIPart(msg, resolved.Version))
		}
	}
	return withFallback(parts, resolved.FallbackText), errors.Join(errs...)
}

func withFallback(parts []a2a.Part, fallbackText string) []a2a.Part {
	if len(parts) == 0 && fallbackText != "" {
		return []a2a.Part{a2a.TextPart{Text: fallbackText}}
	}
	return parts
}

func normalizeWireMessage(msg core.AgentToRendererMessage) core.AgentToRendererMessage {
	cloned := maps.Clone(msg)
	if msgVer, ok := cloned["version"].(string); ok && msgVer == "v0.8" {
		delete(cloned, "version")
	}
	return cloned
}

type jsonSegment struct {
	isText  bool
	text    string
	raw     string
	isFinal bool
}

func appendTextSegment(segments *[]jsonSegment, text string) {
	if text == "" {
		return
	}
	if n := len(*segments); n > 0 && (*segments)[n-1].isText {
		(*segments)[n-1].text += text
		return
	}
	*segments = append(*segments, jsonSegment{isText: true, text: text, isFinal: true})
}

func tokenizeJSONBlocks(content string) []jsonSegment {
	content = unwrapOuterFencedA2UIBlocks(content)
	var segments []jsonSegment
	pos := 0
	for pos < len(content) {
		rest := content[pos:]
		openLoc := a2uiJSONOpenTagRe.FindStringIndex(rest)
		closeLoc := a2uiJSONCloseTagRe.FindStringIndex(rest)

		if openLoc == nil && closeLoc == nil {
			appendTextSegment(&segments, rest)
			break
		}

		if closeLoc != nil && (openLoc == nil || closeLoc[0] < openLoc[0]) {
			prefix := rest[:closeLoc[0]]
			rec, unclosedTicks := findRecoveredJSONBlockStart(prefix)
			if rec >= 0 {
				if rec > 0 {
					appendTextSegment(&segments, prefix[:rec])
				}
				segments = append(segments, jsonSegment{raw: prefix[rec:], isFinal: true})
				pos += closeLoc[1]
				if unclosedTicks > 0 {
					pos += consumeClosingFenceAfterTag(content[pos:], unclosedTicks)
				}
			} else {
				appendTextSegment(&segments, rest[:closeLoc[1]])
				pos += closeLoc[1]
			}
			continue
		}

		if openLoc[0] > 0 {
			appendTextSegment(&segments, rest[:openLoc[0]])
		}
		bodyStart := pos + openLoc[1]
		closeStart, closeEnd := findCloseTagOutsideJSONStrings(content[bodyStart:])
		if closeStart < 0 {
			segments = append(segments, jsonSegment{raw: content[bodyStart:], isFinal: false})
			break
		}
		segments = append(segments, jsonSegment{raw: content[bodyStart : bodyStart+closeStart], isFinal: true})
		pos = bodyStart + closeEnd
	}
	return segments
}

func unwrapOuterFencedA2UIBlocks(content string) string {
	var out strings.Builder
	out.Grow(len(content))

	inFence := false
	fenceTicks := 0
	fenceOpenLine := ""
	var bodyBuf strings.Builder

	for pos := 0; pos < len(content); {
		nl := strings.IndexByte(content[pos:], '\n')
		var line string
		if nl < 0 {
			line = content[pos:]
			pos = len(content)
		} else {
			line = content[pos : pos+nl+1]
			pos += nl + 1
		}

		if !inFence {
			rawLine, ending := splitLineEnding(line)
			if sub := inlineFencedBlockRe.FindStringSubmatch(rawLine); sub != nil {
				out.WriteString(sub[1])
				out.WriteString(sub[2])
				out.WriteString(ending)
				continue
			}
			if ticks, ok := parseFenceOpenLine(rawLine); ok {
				inFence = true
				fenceTicks = ticks
				fenceOpenLine = line
				bodyBuf.Reset()
				continue
			}
			out.WriteString(line)
			continue
		}

		rawLine, _ := splitLineEnding(line)
		if parseFenceCloseLine(rawLine, fenceTicks) {
			body := bodyBuf.String()
			if isA2UIWrappedFenceBody(body) {
				out.WriteString(body)
			} else {
				out.WriteString(fenceOpenLine)
				out.WriteString(body)
				out.WriteString(line)
			}
			inFence = false
			fenceTicks = 0
			fenceOpenLine = ""
			bodyBuf.Reset()
			continue
		}
		bodyBuf.WriteString(line)
	}

	if inFence {
		body := bodyBuf.String()
		if isA2UIWrappedFenceBody(body) {
			out.WriteString(body)
		} else {
			out.WriteString(fenceOpenLine)
			out.WriteString(body)
		}
	}
	return out.String()
}

func isA2UIWrappedFenceBody(body string) bool {
	trimmed := strings.TrimSpace(body)
	loc := a2uiJSONOpenTagRe.FindStringIndex(trimmed)
	if loc == nil || loc[0] != 0 {
		return false
	}
	pos := 0
	for pos < len(trimmed) {
		openLoc := a2uiJSONOpenTagRe.FindStringIndex(trimmed[pos:])
		if openLoc == nil {
			return strings.TrimSpace(trimmed[pos:]) == ""
		}
		if strings.TrimSpace(trimmed[pos:pos+openLoc[0]]) != "" {
			return false
		}
		bodyStart := pos + openLoc[1]
		_, closeEnd := findCloseTagOutsideJSONStrings(trimmed[bodyStart:])
		if closeEnd < 0 {
			return true
		}
		pos = bodyStart + closeEnd
	}
	return true
}

func splitLineEnding(line string) (raw, ending string) {
	if strings.HasSuffix(line, "\r\n") {
		return line[:len(line)-2], "\r\n"
	}
	if strings.HasSuffix(line, "\n") {
		return line[:len(line)-1], "\n"
	}
	return line, ""
}

func parseFenceOpenLine(rawLine string) (int, bool) {
	trimmed := strings.TrimLeft(rawLine, " \t")
	ticks := 0
	for ticks < len(trimmed) && trimmed[ticks] == '`' {
		ticks++
	}
	if ticks < 3 {
		return 0, false
	}
	if strings.ContainsRune(trimmed[ticks:], '`') {
		return 0, false
	}
	return ticks, true
}

func parseFenceCloseLine(rawLine string, minTicks int) bool {
	trimmed := strings.TrimLeft(rawLine, " \t")
	ticks := 0
	for ticks < len(trimmed) && trimmed[ticks] == '`' {
		ticks++
	}
	if ticks < minTicks {
		return false
	}
	return strings.Trim(trimmed[ticks:], " \t") == ""
}

func consumeClosingFenceAfterTag(rest string, minTicks int) int {
	i := 0
	for i < len(rest) && (rest[i] == ' ' || rest[i] == '\t') {
		i++
	}
	if i < len(rest) && rest[i] == '\r' {
		i++
	}
	if i < len(rest) && rest[i] == '\n' {
		i++
	}
	nl := strings.IndexByte(rest[i:], '\n')
	var line string
	var end int
	if nl < 0 {
		line = rest[i:]
		end = len(rest)
	} else {
		line = rest[i : i+nl+1]
		end = i + nl + 1
	}
	rawLine, _ := splitLineEnding(line)
	if parseFenceCloseLine(rawLine, minTicks) {
		return end
	}
	return 0
}

func findRecoveredJSONBlockStart(prefix string) (int, int) {
	inFence := false
	fenceTicks := 0
	openStart := -1
	bodyStart := -1
	hasNewlineAfterOpen := false

	lastClosedOpen := -1
	lastClosedBody := ""
	lastClosedEnd := 0

	for pos := 0; pos < len(prefix); {
		lineStart := pos
		nl := strings.IndexByte(prefix[pos:], '\n')
		var line string
		hadNL := false
		if nl < 0 {
			line = prefix[pos:]
			pos = len(prefix)
		} else {
			line = prefix[pos : pos+nl+1]
			pos += nl + 1
			hadNL = true
		}
		rawLine, _ := splitLineEnding(line)
		if !inFence {
			if ticks, ok := parseFenceOpenLine(rawLine); ok {
				inFence = true
				fenceTicks = ticks
				openStart = lineStart
				bodyStart = pos
				hasNewlineAfterOpen = hadNL
			}
			continue
		}
		if parseFenceCloseLine(rawLine, fenceTicks) {
			inFence = false
			lastClosedOpen = openStart
			lastClosedBody = prefix[bodyStart:lineStart]
			lastClosedEnd = pos
			fenceTicks = 0
		}
	}

	if inFence && hasNewlineAfterOpen {
		return openStart, fenceTicks
	}
	if !inFence && lastClosedOpen >= 0 && strings.TrimSpace(prefix[lastClosedEnd:]) == "" {
		if jsonPayloadStartRe.MatchString(lastClosedBody) {
			return lastClosedOpen, 0
		}
	}
	tail := prefix[lastClosedEnd:]
	loc := jsonPayloadStartRe.FindStringIndex(tail)
	if loc == nil {
		return -1, 0
	}
	return lastClosedEnd + loc[0], 0
}

func findCloseTagOutsideJSONStrings(s string) (int, int) {
	const closePrefix = "</a2ui-json"
	inString := false
	escaped := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}
		if ch == '"' {
			inString = true
			continue
		}
		if ch == '<' && len(s)-i > len(closePrefix) && strings.EqualFold(s[i:i+len(closePrefix)], closePrefix) {
			j := i + len(closePrefix)
			for j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r') {
				j++
			}
			if j < len(s) && s[j] == '>' {
				return i, j + 1
			}
		}
	}
	return -1, -1
}

func parseRawJSONMessages(raw string) ([]core.AgentToRendererMessage, error) {
	cleaned := stripMarkdownFence(strings.TrimSpace(raw))
	var val any
	if err := json.Unmarshal([]byte(cleaned), &val); err != nil {
		healed := healSimpleJSON(cleaned)
		if err2 := json.Unmarshal([]byte(healed), &val); err2 != nil {
			return nil, err
		}
	}
	switch v := val.(type) {
	case map[string]any:
		return []core.AgentToRendererMessage{core.AgentToRendererMessage(v)}, nil
	case []any:
		out := make([]core.AgentToRendererMessage, 0, len(v))
		for _, item := range v {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, core.NewParseError("expected JSON array of A2UI message objects")
			}
			out = append(out, core.AgentToRendererMessage(m))
		}
		return out, nil
	default:
		return nil, core.NewParseError("expected JSON object or array of objects")
	}
}

func stripMarkdownFence(s string) string {
	trimmed := strings.TrimSpace(s)
	if ticks, _ := parseFenceOpenLinePrefix(trimmed); ticks >= 3 {
		if nl := strings.IndexByte(trimmed, '\n'); nl >= 0 {
			inner := trimmed[nl+1:]
			closeFence := strings.Repeat("`", ticks)
			if end := strings.LastIndex(inner, closeFence); end >= 0 {
				after := inner[end:]
				allTicksOrSpace := true
				for i := 0; i < len(after); i++ {
					if after[i] != '`' && after[i] != ' ' && after[i] != '\t' && after[i] != '\r' && after[i] != '\n' {
						allTicksOrSpace = false
						break
					}
				}
				if allTicksOrSpace {
					return strings.TrimSpace(inner[:end])
				}
			}
			return strings.TrimSpace(inner)
		}
	}
	if len(trimmed) >= 2 && trimmed[0] == '`' && trimmed[len(trimmed)-1] == '`' {
		return strings.TrimSpace(trimmed[1 : len(trimmed)-1])
	}
	return trimmed
}

func parseFenceOpenLinePrefix(s string) (int, bool) {
	nl := strings.IndexByte(s, '\n')
	firstLine := s
	if nl >= 0 {
		firstLine = s[:nl]
	}
	raw, _ := splitLineEnding(firstLine)
	return parseFenceOpenLine(raw)
}

func isSmartDoubleQuote(r rune) bool {
	return r == '\u201c' || r == '\u201d'
}

func healSimpleJSON(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	var quoteKind rune
	escaped := false
	for i := 0; i < len(s); {
		r, w := utf8.DecodeRuneInString(s[i:])
		if quoteKind != 0 {
			if escaped {
				b.WriteString(s[i : i+w])
				escaped = false
				i += w
				continue
			}
			if r == '\\' {
				b.WriteByte('\\')
				escaped = true
				i += w
				continue
			}
			if r == '\n' {
				b.WriteString(`\n`)
				i += w
				continue
			}
			if r == '\r' {
				b.WriteString(`\r`)
				i += w
				continue
			}
			if r == '\t' {
				b.WriteString(`\t`)
				i += w
				continue
			}
			if r == '"' || (quoteKind == '\u201c' && isSmartDoubleQuote(r)) {
				quoteKind = 0
				b.WriteByte('"')
				i += w
				continue
			}
			b.WriteString(s[i : i+w])
			i += w
			continue
		}
		if r == '"' {
			quoteKind = '"'
			b.WriteByte('"')
			i += w
			continue
		}
		if isSmartDoubleQuote(r) {
			quoteKind = '\u201c'
			b.WriteByte('"')
			i += w
			continue
		}
		if r == ',' {
			j := i + w
			for j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r') {
				j++
			}
			if j < len(s) && (s[j] == '}' || s[j] == ']') {
				i += w
				continue
			}
		}
		b.WriteString(s[i : i+w])
		i += w
	}
	return b.String()
}
