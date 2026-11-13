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

// Package blocklexer extracts sentinel-tagged A2UI blocks from conversational LLM text,
// handling nested string literals, comments, markdown fences, and missing open tags.
package blocklexer

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// LexerState identifies the current scanner state inside BlockLexer.
type LexerState int

const (
	// StateNormal scans conversational text outside sentinel tags.
	StateNormal LexerState = iota
	// StateInA2UI scans format syntax inside sentinel tags.
	StateInA2UI
	// StateInString scans inside a quoted or triple-quoted string literal.
	StateInString
	// StateInComment scans inside a single-line comment.
	StateInComment
	// StateInBlockComment scans inside a delimited block comment such as /* ... */.
	StateInBlockComment
)

var (
	leadingFenceRE    = regexp.MustCompile(`(?i)^` + "```" + `[a-zA-Z0-9_-]*\s*`)
	trailingFenceRE   = regexp.MustCompile(`(?i)\s*` + "```" + `[a-zA-Z0-9_-]*$`)
	openFenceRE       = regexp.MustCompile(`(?m)^[ \t]*` + "```" + `[a-zA-Z0-9_-]*[ \t]*\r?\n?`)
	closingFenceEndRE = regexp.MustCompile(`\r?\n?[ \t]*` + "```" + `[ \t]*\r?\n?$`)

	// ExpressPayloadStartRE matches the start of an unfenced Express DSL payload line.
	ExpressPayloadStartRE = regexp.MustCompile(
		`(?m)^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?:[^=]|$)|[a-zA-Z_][a-zA-Z0-9_]*\s*=(?:[^=]|$))`,
	)
	// JSONPayloadStartRE matches the start of an unfenced Direct JSON payload line.
	JSONPayloadStartRE = regexp.MustCompile(
		`(?m)^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\}|$))`,
	)

	jsonBlockLexer = MustNew(&Options{
		OpenTag:             "<a2ui-json>",
		CloseTag:            "</a2ui-json>",
		StringDelimiters:    []byte{'"'},
		SingleLineComments:  []string{},
		PayloadStartPattern: JSONPayloadStartRE,
		StripEdgeBackticks:  true,
	})
)

// JSONBlockLexer returns the shared BlockLexer configured for <a2ui-json> Direct JSON blocks.
func JSONBlockLexer() *BlockLexer {
	return jsonBlockLexer
}

// RawBlock represents a tokenized conversational text segment or raw A2UI block.
type RawBlock struct {
	IsText  bool
	Text    string
	A2UIRaw string
	IsFinal bool
}

// BlockCommentPair defines open and close markers for block comments.
type BlockCommentPair struct {
	Open  string
	Close string
}

// Options configures a BlockLexer instance.
type Options struct {
	OpenTag             string
	OpenTagPattern      *regexp.Regexp
	CloseTag            string
	CloseTagPattern     *regexp.Regexp
	StringDelimiters    []byte
	SingleLineComments  []string
	BlockComments       []BlockCommentPair
	PayloadStartPattern *regexp.Regexp
	StripEdgeBackticks  bool
}

// BlockLexer extracts structured format blocks from LLM output while respecting
// string literals, comments, markdown fences, and single-block missing-open-tag recovery.
type BlockLexer struct {
	openTagSearch      *regexp.Regexp
	closeTagSearch     *regexp.Regexp
	closeTagAnchored   *regexp.Regexp
	stringDelimiters   map[byte]bool
	singleLineComments []string
	blockComments      []BlockCommentPair
	payloadStart       *regexp.Regexp
	stripEdgeBackticks bool
}

// New constructs a BlockLexer from opts (using Express defaults when opts is nil).
func New(opts *Options) (*BlockLexer, error) {
	var resolved Options
	if opts != nil {
		resolved = *opts
	}
	for _, bc := range resolved.BlockComments {
		if bc.Open == "" || bc.Close == "" {
			return nil, fmt.Errorf("block comment markers must be non-empty strings")
		}
	}

	var openSearch *regexp.Regexp
	closeDefault := "</a2ui>"
	if resolved.OpenTagPattern != nil {
		openSearch = resolved.OpenTagPattern
	} else {
		openTag := resolved.OpenTag
		if openTag == "" {
			openTag = "<a2ui>"
		}
		openName := strings.Trim(openTag, "<>")
		openSearch = regexp.MustCompile(`(?i)<` + regexp.QuoteMeta(openName) + `(?:\s[^>]*)?>`)
		closeDefault = "</" + openName + ">"
	}

	var closeSearch, closeAnchored *regexp.Regexp
	if resolved.CloseTagPattern != nil {
		closeSearch = resolved.CloseTagPattern
		src := strings.TrimPrefix(resolved.CloseTagPattern.String(), "^")
		closeAnchored = regexp.MustCompile(`\A(?:` + src + `)`)
	} else {
		closeTag := resolved.CloseTag
		if closeTag == "" {
			closeTag = closeDefault
		}
		closeName := strings.Trim(closeTag, "<>/")
		pat := `</` + regexp.QuoteMeta(closeName) + `\s*>`
		closeSearch = regexp.MustCompile(`(?i)` + pat)
		closeAnchored = regexp.MustCompile(`(?i)\A` + pat)
	}

	delims := make(map[byte]bool)
	if resolved.StringDelimiters != nil {
		for _, d := range resolved.StringDelimiters {
			delims[d] = true
		}
	} else {
		delims['\''] = true
		delims['"'] = true
	}

	slComments := resolved.SingleLineComments
	if slComments == nil {
		slComments = []string{"#"}
	}

	payloadStart := resolved.PayloadStartPattern
	if payloadStart == nil {
		payloadStart = ExpressPayloadStartRE
	}

	return &BlockLexer{
		openTagSearch:      openSearch,
		closeTagSearch:     closeSearch,
		closeTagAnchored:   closeAnchored,
		stringDelimiters:   delims,
		singleLineComments: append([]string(nil), slComments...),
		blockComments:      append([]BlockCommentPair(nil), resolved.BlockComments...),
		payloadStart:       payloadStart,
		stripEdgeBackticks: resolved.StripEdgeBackticks,
	}, nil
}

// MustNew constructs a BlockLexer and panics if opts are invalid.
func MustNew(opts *Options) *BlockLexer {
	lex, err := New(opts)
	if err != nil {
		panic(err)
	}
	return lex
}

// CleanMarkdown strips outer whitespace, one markdown code fence wrapper, and pure-backtick runs.
func CleanMarkdown(text string) string {
	if text == "" {
		return ""
	}
	cleaned := strings.TrimSpace(text)
	cleaned = leadingFenceRE.ReplaceAllString(cleaned, "")
	cleaned = trailingFenceRE.ReplaceAllString(cleaned, "")
	cleaned = strings.TrimSpace(cleaned)
	if strings.Trim(cleaned, "`") == "" {
		return ""
	}
	return cleaned
}

// CleanRaw strips markdown fences and edge inline-code backticks from a raw block body.
func CleanRaw(text string) string {
	cleaned := CleanMarkdown(text)
	cleaned = strings.Trim(cleaned, "`")
	return strings.TrimSpace(cleaned)
}

func (l *BlockLexer) addText(parts *[]RawBlock, text string) {
	cleaned := CleanMarkdown(text)
	if cleaned != "" {
		*parts = append(*parts, RawBlock{
			IsText:  true,
			Text:    cleaned,
			IsFinal: true,
		})
	}
}

func (l *BlockLexer) scanBlock(content string, start, end int) (int, int, bool) {
	i := start
	state := StateInA2UI
	var stringDelim string
	tripleQuote := false
	blockClose := ""

	for i < end {
		switch state {
		case StateInA2UI:
			if content[i] == '<' {
				if loc := l.closeTagAnchored.FindStringIndex(content[i:end]); loc != nil {
					return i, i + loc[1], true
				}
			}

			ch := content[i]
			if l.stringDelimiters[ch] {
				if i+2 < end && content[i+1] == ch && content[i+2] == ch {
					stringDelim = string([]byte{ch, ch, ch})
					tripleQuote = true
					i += 3
				} else {
					stringDelim = string(ch)
					tripleQuote = false
					i++
				}
				state = StateInString
				continue
			}

			matchedBlock := false
			for _, bc := range l.blockComments {
				if strings.HasPrefix(content[i:end], bc.Open) {
					i += len(bc.Open)
					blockClose = bc.Close
					state = StateInBlockComment
					matchedBlock = true
					break
				}
			}
			if matchedBlock {
				continue
			}

			matchedLineComment := false
			for _, cm := range l.singleLineComments {
				if strings.HasPrefix(content[i:end], cm) {
					i += len(cm)
					state = StateInComment
					matchedLineComment = true
					break
				}
			}
			if matchedLineComment {
				continue
			}

			i++

		case StateInString:
			if content[i] == '\\' {
				i += 2
				continue
			}
			if tripleQuote {
				if strings.HasPrefix(content[i:end], stringDelim) {
					i += 3
					state = StateInA2UI
					continue
				}
			} else if content[i] == stringDelim[0] {
				i++
				state = StateInA2UI
				continue
			}
			i++

		case StateInComment:
			if content[i] == '<' {
				if loc := l.closeTagAnchored.FindStringIndex(content[i:end]); loc != nil {
					return i, i + loc[1], true
				}
			}
			if content[i] == '\n' || content[i] == '\r' {
				state = StateInA2UI
			}
			i++

		case StateInBlockComment:
			if strings.HasPrefix(content[i:end], blockClose) {
				i += len(blockClose)
				state = StateInA2UI
				continue
			}
			i++
		}
	}

	return 0, 0, false
}

func (l *BlockLexer) tryRecoverUnmatchedClose(parts *[]RawBlock, content string, start, searchEnd int) (int, bool) {
	segment := content[start:searchEnd]
	if !l.closeTagSearch.MatchString(segment) {
		return 0, false
	}

	fences := openFenceRE.FindAllStringIndex(segment, -1)
	for idx := 0; idx < len(fences); idx += 2 {
		fence := fences[idx]
		closeStart, closeEnd, ok := l.scanBlock(segment, fence[1], len(segment))
		if !ok {
			continue
		}
		body := segment[fence[1]:closeStart]
		bodyStripped := closingFenceEndRE.ReplaceAllString(body, "")
		if openFenceRE.MatchString(bodyStripped) {
			continue
		}
		rawContent := CleanRaw(bodyStripped)
		if rawContent == "" {
			continue
		}
		l.addText(parts, segment[:fence[0]])
		*parts = append(*parts, RawBlock{
			A2UIRaw: rawContent,
			IsFinal: true,
		})
		return start + closeEnd, true
	}

	searchFrom := 0
	for pairIdx := 0; pairIdx+1 < len(fences); pairIdx += 2 {
		closeFenceEnd := fences[pairIdx+1][1]
		if _, _, ok := l.scanBlock(segment, closeFenceEnd, len(segment)); !ok {
			break
		}
		searchFrom = closeFenceEnd
	}

	stmtLoc := l.payloadStart.FindStringIndex(segment[searchFrom:])
	if stmtLoc == nil {
		return 0, false
	}
	stmtStart := searchFrom + stmtLoc[0]
	closeStart, closeEnd, ok := l.scanBlock(segment, stmtStart, len(segment))
	if !ok {
		return 0, false
	}
	rawContent := CleanRaw(segment[stmtStart:closeStart])
	if rawContent == "" {
		return 0, false
	}
	l.addText(parts, segment[:stmtStart])
	*parts = append(*parts, RawBlock{
		A2UIRaw: rawContent,
		IsFinal: true,
	})
	return start + closeEnd, true
}

// Tokenize scans content into conversational text and raw A2UI blocks.
func (l *BlockLexer) Tokenize(content string) []RawBlock {
	var parts []RawBlock
	n := len(content)
	i := 0
	recoveredUnmatched := false

	for i < n {
		openLoc := l.openTagSearch.FindStringIndex(content[i:])
		searchEnd := n
		if openLoc != nil {
			searchEnd = i + openLoc[0]
		}
		if !recoveredUnmatched && searchEnd > i {
			if nextI, ok := l.tryRecoverUnmatchedClose(&parts, content, i, searchEnd); ok {
				recoveredUnmatched = true
				i = nextI
				continue
			}
		}
		if openLoc == nil {
			break
		}
		openStart := i + openLoc[0]
		openEnd := i + openLoc[1]

		textBefore := content[i:openStart]
		if l.stripEdgeBackticks && strings.HasSuffix(textBefore, "`") {
			textBefore = strings.TrimRight(textBefore, "`")
		}
		l.addText(&parts, textBefore)

		closeStart, closeEnd, ok := l.scanBlock(content, openEnd, n)
		if !ok {
			parts = append(parts, RawBlock{
				A2UIRaw: CleanRaw(content[openEnd:]),
				IsFinal: false,
			})
			return parts
		}
		parts = append(parts, RawBlock{
			A2UIRaw: CleanRaw(content[openEnd:closeStart]),
			IsFinal: true,
		})
		i = closeEnd
		if l.stripEdgeBackticks {
			for i < n && content[i] == '`' {
				i++
			}
		}
	}

	if !recoveredUnmatched && i < n {
		if nextI, ok := l.tryRecoverUnmatchedClose(&parts, content, i, n); ok {
			i = nextI
		}
	}
	l.addText(&parts, content[i:])
	return parts
}

// IsTagPrefix reports whether text[idx:] is a proper case-insensitive prefix of tag.
func IsTagPrefix(text string, idx int, tag string) bool {
	rem := len(text) - idx
	return rem > 0 && rem < len(tag) && strings.EqualFold(text[idx:], tag[:rem])
}

// PossibleTagStart returns the offset where a suffix of text could begin openTag (or openTagStartRE),
// or len(text) when no partial open tag is present at the tail.
func PossibleTagStart(text, openTag string, openTagStartRE *regexp.Regexp) int {
	offset := 0
	for {
		pos := strings.IndexByte(text[offset:], '<')
		if pos < 0 {
			return len(text)
		}
		idx := offset + pos
		if IsTagPrefix(text, idx, openTag) || (openTagStartRE != nil && openTagStartRE.MatchString(text[idx:])) {
			return idx
		}
		offset = idx + 1
	}
}

// PayloadStart returns the byte offset where the payload of an arriving block starts
// (after leading whitespace and any leading markdown fence line), or (-1, false) while
// a leading fence line is still incomplete.
func PayloadStart(block string, end int) (int, bool) {
	start := 0
	for start < end && isUnicodeSpaceAt(block, start) {
		_, size := decodeSpaceStep(block, start)
		start += size
	}
	if end-start <= 3 && strings.HasPrefix("```", block[start:end]) {
		return -1, false
	}
	if strings.HasPrefix(block[start:end], "```") {
		nl := strings.IndexByte(block[start:end], '\n')
		if nl < 0 {
			return -1, false
		}
		return start + nl + 1, true
	}
	if start < end && block[start] == '`' {
		for start < end {
			if block[start] == '`' {
				start++
				continue
			}
			if isUnicodeSpaceAt(block, start) {
				_, size := decodeSpaceStep(block, start)
				start += size
				continue
			}
			break
		}
	}
	return start, true
}

// TrailingFenceStart returns the offset where a trailing markdown fence in block[start:end] begins, or end.
func TrailingFenceStart(block string, start, end int) int {
	fence := end
	for fence > start && isASCIIWhitespace(block[fence-1]) {
		fence--
	}
	for fence > start {
		b := block[fence-1]
		if b == '-' || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') {
			fence--
			continue
		}
		break
	}
	ticks := 0
	for ticks < 3 && fence > start && block[fence-1] == '`' {
		fence--
		ticks++
	}
	if ticks == 0 {
		return end
	}
	for fence > start && isASCIIWhitespace(block[fence-1]) {
		fence--
	}
	return fence
}

func isASCIIWhitespace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\v' || b == '\f'
}

func isUnicodeSpaceAt(s string, idx int) bool {
	if idx < len(s) && s[idx] < 0x80 {
		return isASCIIWhitespace(s[idx])
	}
	r, _ := decodeSpaceStep(s, idx)
	return unicode.IsSpace(r)
}

func decodeSpaceStep(s string, idx int) (rune, int) {
	if s[idx] < 0x80 {
		return rune(s[idx]), 1
	}
	for i, r := range s[idx:] {
		if i == 0 {
			for next := range s[idx+1:] {
				return r, next + 1
			}
			return r, len(s) - idx
		}
	}
	return 0, 1
}
