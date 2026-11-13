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

// Package directjson implements incremental O(N) JSON reading, progressive string
// healing, schema pruning, and ordered JSON serialization for the Direct JSON format.
package directjson

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/blocklexer"
)

var (
	numberRE = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`)

	urlPrefixes = []string{"http://", "https://", "data:"}

	newlineStrippedKeys = map[string]bool{
		"id":        true,
		"component": true,
		"child":     true,
		"surfaceId": true,
		"catalogId": true,
		// The v1.0 component-level catalog override.
		"@catalogId":  true,
		"componentId": true,
	}

	// OpenTagRE matches an <a2ui-json ...> opening sentinel tag.
	OpenTagRE = regexp.MustCompile(`(?i)<a2ui-json(?:\s[^>]*)?>`)
	// CloseTagRE matches a </a2ui-json> closing sentinel tag.
	CloseTagRE = regexp.MustCompile(`(?i)</a2ui-json\s*>`)
	// CloseTagAnchoredRE matches a </a2ui-json> tag anchored at byte 0 of a slice.
	CloseTagAnchoredRE = regexp.MustCompile(`(?i)\A</a2ui-json\s*>`)
	// OpenTagStartRE matches a partial <a2ui-json attribute prefix running to the end of text.
	OpenTagStartRE = regexp.MustCompile(`(?i)\A<a2ui-json\s[^>]*\z`)
	// CloseTagStartRE matches a partial </a2ui-json whitespace prefix running to the end of text.
	CloseTagStartRE = regexp.MustCompile(`(?i)\A</a2ui-json\s*\z`)
)

const (
	// OpenTag is the Direct JSON opening sentinel tag.
	OpenTag = "<a2ui-json>"
	// CloseTag is the Direct JSON closing sentinel tag.
	CloseTag = "</a2ui-json>"
)

var errUnfinished = errors.New("unfinished partial JSON")

// MessageItem pairs a candidate message value with whether its JSON object closed cleanly.
type MessageItem struct {
	Envelope any
	Closed   bool
}

type closedEntry struct {
	value any
	end   int
}

type openListEntry struct {
	items  []any
	resume int
}

type messageListState struct {
	items  []MessageItem
	resume int
}

type readState struct {
	closed   map[int]closedEntry
	open     map[int]openListEntry
	messages *messageListState
}

func newReadState() *readState {
	return &readState{
		closed: make(map[int]closedEntry),
		open:   make(map[int]openListEntry),
	}
}

// PartialReadCache stores closed containers and open list positions across streaming chunks
// so repeated reads over a growing block run in O(N) total time.
type PartialReadCache struct {
	plain    *readState
	straight *readState
	Complete bool
}

// NewPartialReadCache creates an empty PartialReadCache.
func NewPartialReadCache() *PartialReadCache {
	return &PartialReadCache{
		plain:    newReadState(),
		straight: newReadState(),
	}
}

// ReadJSON reads a complete JSON value from text, tolerating trailing commas and raw
// newlines/tabs inside strings, and falling back to curly-quote straightening on failure.
func ReadJSON(text string) (any, error) {
	r := newReader(text, nil, nil, nil, 0, len(text))
	val, err := r.document()
	if err == nil {
		return val, nil
	}
	straight := straightenQuotes(text)
	if straight == text {
		return nil, err
	}
	r2 := newReader(straight, nil, nil, nil, 0, len(straight))
	return r2.document()
}

// ReadPartialMessageItems reads a partial JSON array or single object from text[start:end]
// into candidate message envelopes, reusing cache across growing chunks when non-nil.
func ReadPartialMessageItems(
	text string,
	progressiveKeys map[string]bool,
	wholeItemKeys map[string]bool,
	cache *PartialReadCache,
	start int,
	end int,
) []MessageItem {
	_, items := ReadPartialMessageItemsFrom(text, progressiveKeys, wholeItemKeys, cache, start, end, 0)
	return items
}

// ReadPartialMessageItemsFrom behaves like ReadPartialMessageItems but omits up to
// skipClosed leading closed items that the caller has already processed, returning
// the omitted prefix count alongside the remaining message items in O(tail) space.
func ReadPartialMessageItemsFrom(
	text string,
	progressiveKeys map[string]bool,
	wholeItemKeys map[string]bool,
	cache *PartialReadCache,
	start int,
	end int,
	skipClosed int,
) (int, []MessageItem) {
	if skipClosed < 0 {
		skipClosed = 0
	}
	if progressiveKeys == nil {
		progressiveKeys = map[string]bool{}
	}
	if end < 0 || end > len(text) {
		end = len(text)
	}
	if start < 0 || start > end {
		return 0, nil
	}
	if cache != nil {
		cache.Complete = false
	}

	readWith := func(src string, st *readState, s, limit int) (int, []MessageItem, error) {
		r := newReader(src, progressiveKeys, wholeItemKeys, st, s, limit)
		base, items, err := r.messageItems(skipClosed)
		if err != nil {
			return 0, nil, err
		}
		if cache != nil {
			cache.Complete = r.complete
		}
		return base, items, nil
	}

	var plainState *readState
	if cache != nil {
		plainState = cache.plain
	}
	if base, items, err := readWith(text, plainState, start, end); err == nil {
		return base, items
	}

	// Note: curly UTF-8 quotes (3 bytes: E2 80 9C/9D) become 1-byte ASCII quotes,
	// so slice text[start:end] before straightening or adjust offsets cleanly.
	sub := text[start:end]
	straightSub := straightenQuotes(sub)
	if straightSub == sub {
		return 0, nil
	}
	var straightState *readState
	if cache != nil {
		straightState = cache.straight
	}
	base, items, err := readWith(straightSub, straightState, 0, len(straightSub))
	if err != nil {
		return 0, nil
	}
	return base, items
}

func straightenQuotes(text string) string {
	r := strings.NewReplacer(
		"\u201c", `"`,
		"\u201d", `"`,
		"\u2018", `'`,
		"\u2019", `'`,
	)
	return r.Replace(text)
}

type reader struct {
	text            string
	progressiveKeys map[string]bool
	wholeItemKeys   map[string]bool
	state           *readState
	i               int
	limit           int
	cut             bool
	complete        bool
	inDataModel     bool
}

func newReader(
	text string,
	progressiveKeys map[string]bool,
	wholeItemKeys map[string]bool,
	state *readState,
	start int,
	limit int,
) *reader {
	return &reader{
		text:            text,
		progressiveKeys: progressiveKeys,
		wholeItemKeys:   wholeItemKeys,
		state:           state,
		i:               start,
		limit:           limit,
	}
}

func (r *reader) partial() bool { return r.progressiveKeys != nil }
func (r *reader) atEnd() bool   { return r.i >= r.limit }

func (r *reader) document() (any, error) {
	r.skipSpace()
	val, err := r.readValue(false, false)
	if err != nil {
		return nil, err
	}
	r.skipSpace()
	if !r.atEnd() {
		return nil, r.fail("unexpected text after the JSON value")
	}
	return val, nil
}

func (r *reader) messageItems(skipClosed int) (int, []MessageItem, error) {
	r.skipSpace()
	if r.atEnd() {
		return 0, nil, nil
	}
	if r.text[r.i] != '[' {
		r.cut = false
		msg, err := r.readValue(false, false)
		if errors.Is(err, errUnfinished) {
			return 0, nil, nil
		}
		if err != nil {
			return 0, nil, err
		}
		closed := !r.cut
		r.skipSpace()
		if !r.atEnd() {
			return 0, nil, r.fail("unexpected text after the JSON value")
		}
		r.complete = closed
		return 0, []MessageItem{{Envelope: msg, Closed: closed}}, nil
	}

	r.i++
	var closed []MessageItem
	resume := r.i
	afterItem := false
	if r.state != nil && r.state.messages != nil {
		// r.state.messages.items is strictly append-only of closed MessageItems,
		// so reusing it never overwrites any element observed by an earlier read.
		closed = r.state.messages.items
		resume = r.state.messages.resume
		r.i = resume
		afterItem = len(closed) > 0
	}

	var openItem MessageItem
	hasOpen := false
	soFar := func() (int, []MessageItem) {
		if r.state != nil {
			r.state.messages = &messageListState{items: closed, resume: resume}
		}
		base := min(skipClosed, len(closed))
		n := len(closed)
		if !hasOpen {
			if n == 0 && base == 0 {
				return 0, nil
			}
			return base, closed[base:n:n]
		}
		tailLen := n - base
		out := make([]MessageItem, tailLen+1)
		copy(out, closed[base:n])
		out[tailLen] = openItem
		return base, out
	}

	for {
		if afterItem {
			r.skipSpace()
			if r.atEnd() {
				b, out := soFar()
				return b, out, nil
			}
			if r.text[r.i] == ',' {
				r.i++
			} else if r.text[r.i] != ']' {
				return 0, nil, r.fail("expected ',' or ']'")
			}
		}
		afterItem = true
		r.skipSpace()
		if r.atEnd() {
			b, out := soFar()
			return b, out, nil
		}
		if r.text[r.i] == ']' {
			r.i++
			r.skipSpace()
			if !r.atEnd() {
				return 0, nil, r.fail("unexpected text after the JSON value")
			}
			r.complete = true
			b, out := soFar()
			return b, out, nil
		}
		if hasOpen {
			// An earlier item reached EOF and healed; only whitespace or EOF could follow.
			b, out := soFar()
			return b, out, nil
		}
		r.cut = false
		msg, err := r.readValue(false, false)
		if errors.Is(err, errUnfinished) {
			b, out := soFar()
			return b, out, nil
		}
		if err != nil {
			return 0, nil, err
		}
		itemClosed := !r.cut
		if itemClosed {
			closed = append(closed, MessageItem{Envelope: msg, Closed: true})
			resume = r.i
		} else {
			openItem = MessageItem{Envelope: msg, Closed: false}
			hasOpen = true
		}
	}
}

func (r *reader) readValue(healable bool, stripNewlines bool) (any, error) {
	if r.atEnd() {
		return nil, r.endErr()
	}
	c := r.text[r.i]
	switch {
	case c == '{':
		return r.readObjectCached("")
	case c == '[':
		return r.readArrayCached(false, false)
	case c == '"':
		return r.readString(healable, stripNewlines)
	case c == '-' || (c >= '0' && c <= '9'):
		return r.readNumber()
	default:
		for _, lit := range []struct {
			word string
			val  any
		}{
			{"true", true},
			{"false", false},
			{"null", nil},
		} {
			if r.i+len(lit.word) <= r.limit && r.text[r.i:r.i+len(lit.word)] == lit.word {
				r.i += len(lit.word)
				return lit.val, nil
			}
			if r.partial() && strings.HasPrefix(lit.word, r.text[r.i:r.limit]) {
				return nil, r.endErr()
			}
		}
		return nil, r.fail(fmt.Sprintf("unexpected character %q", c))
	}
}

func (r *reader) readObjectCached(parentKey string) (map[string]any, error) {
	if r.state == nil {
		return r.readObject(parentKey)
	}
	start := r.i
	if cached, ok := r.state.closed[start]; ok {
		r.i = cached.end
		return cached.value.(map[string]any), nil
	}
	cutBefore := r.cut
	r.cut = false
	obj, err := r.readObject(parentKey)
	if err != nil {
		r.cut = cutBefore || r.cut
		return nil, err
	}
	if !r.cut {
		r.state.closed[start] = closedEntry{value: obj, end: r.i}
	}
	r.cut = cutBefore || r.cut
	return obj, nil
}

func (r *reader) readObject(parentKey string) (map[string]any, error) {
	r.i++
	obj := make(map[string]any)
	for {
		r.skipSpace()
		if r.atEnd() {
			if !r.partial() {
				return nil, r.endErr()
			}
			r.cut = true
			return obj, nil
		}
		if r.text[r.i] == '}' {
			r.i++
			return obj, nil
		}
		if r.text[r.i] != '"' {
			return nil, r.fail("expected a key")
		}
		key, err := r.readString(false, !r.inDataModel)
		if err != nil {
			return nil, err
		}
		r.skipSpace()
		if r.atEnd() {
			return nil, r.endErr()
		}
		if r.text[r.i] != ':' {
			return nil, r.fail(fmt.Sprintf("expected ':' after key %q", key))
		}
		r.i++
		r.skipSpace()

		isDataValue := !r.inDataModel && ((parentKey == "updateDataModel" && key == "value") ||
			(parentKey == "createSurface" && key == "dataModel"))
		if isDataValue {
			r.inDataModel = true
		}

		var val any
		if !r.atEnd() && r.text[r.i] == '[' {
			whole := r.partial() && r.wholeItemKeys[key]
			stripItems := key == "children" && !r.inDataModel
			val, err = r.readArrayCached(whole, stripItems)
		} else if !r.atEnd() && r.text[r.i] == '{' {
			val, err = r.readObjectCached(key)
		} else {
			healable := r.progressiveKeys != nil && r.progressiveKeys[key]
			stripVal := newlineStrippedKeys[key] && !r.inDataModel
			val, err = r.readValue(healable, stripVal)
		}
		if isDataValue {
			r.inDataModel = false
		}
		if err != nil {
			return nil, err
		}
		obj[key] = val

		r.skipSpace()
		if r.atEnd() {
			if !r.partial() {
				return nil, r.endErr()
			}
			r.cut = true
			return obj, nil
		}
		if r.text[r.i] == ',' {
			r.i++
		} else if r.text[r.i] != '}' {
			return nil, r.fail("expected ',' or '}'")
		}
	}
}

func (r *reader) readArrayCached(wholeItems bool, stripItemNewlines bool) ([]any, error) {
	if r.state == nil {
		return r.readArray(wholeItems, stripItemNewlines)
	}
	start := r.i
	if cached, ok := r.state.closed[start]; ok {
		r.i = cached.end
		return cached.value.([]any), nil
	}
	cutBefore := r.cut
	r.cut = false
	arr, err := r.readArray(wholeItems, stripItemNewlines)
	if err != nil {
		r.cut = cutBefore || r.cut
		return nil, err
	}
	if !r.cut {
		r.state.closed[start] = closedEntry{value: arr, end: r.i}
	}
	r.cut = cutBefore || r.cut
	return arr, nil
}

func (r *reader) readArray(wholeItems bool, stripItemNewlines bool) ([]any, error) {
	start := r.i
	r.i++
	closed := make([]any, 0)
	resume := r.i
	afterItem := false
	if r.state != nil {
		if openEntry, ok := r.state.open[start]; ok {
			// openEntry.items is non-nil and strictly append-only of closed items,
			// so resuming from it keeps [] non-null and never mutates earlier reads.
			closed = openEntry.items
			resume = openEntry.resume
			r.i = resume
			afterItem = len(closed) > 0
		}
	}

	var openItem any
	hasOpen := false
	finishSlice := func() []any {
		n := len(closed)
		if !hasOpen {
			return closed[:n:n]
		}
		out := make([]any, n+1)
		copy(out, closed)
		out[n] = openItem
		return out
	}

	healed := func() ([]any, error) {
		if r.state != nil {
			r.state.open[start] = openListEntry{items: closed, resume: resume}
		}
		if !r.partial() {
			return nil, r.endErr()
		}
		r.cut = true
		return finishSlice(), nil
	}

	for {
		if afterItem {
			r.skipSpace()
			if r.atEnd() {
				return healed()
			}
			if r.text[r.i] == ',' {
				r.i++
			} else if r.text[r.i] != ']' {
				return nil, r.fail("expected ',' or ']'")
			}
		}
		afterItem = true
		r.skipSpace()
		if r.atEnd() {
			return healed()
		}
		if r.text[r.i] == ']' {
			r.i++
			if r.state != nil {
				delete(r.state.open, start)
			}
			return finishSlice(), nil
		}
		if hasOpen {
			return healed()
		}

		cutBefore := r.cut
		r.cut = false
		if wholeItems {
			item, err := r.readValue(false, stripItemNewlines)
			if errors.Is(err, errUnfinished) {
				return healed()
			}
			if err != nil {
				return nil, err
			}
			if r.cut {
				return healed()
			}
			closed = append(closed, item)
		} else {
			item, err := r.readValue(false, stripItemNewlines)
			if err != nil {
				return nil, err
			}
			if r.cut {
				openItem = item
				hasOpen = true
				continue
			}
			closed = append(closed, item)
		}
		r.cut = cutBefore
		resume = r.i
		if r.state != nil {
			r.state.open[start] = openListEntry{items: closed, resume: resume}
		}
	}
}

func (r *reader) readString(healable bool, stripNewlines bool) (string, error) {
	r.i++
	var buf strings.Builder
	n := r.limit
	for !r.atEnd() {
		c := r.text[r.i]
		if c == '"' {
			r.i++
			return buf.String(), nil
		}
		if c != '\\' {
			if stripNewlines {
				if c == '\r' || c == '\n' {
					r.i++
					continue
				}
				j := r.i + 1
				for j < n && r.text[j] != '"' && r.text[j] != '\\' && r.text[j] != '\r' && r.text[j] != '\n' {
					j++
				}
				buf.WriteString(r.text[r.i:j])
				r.i = j
			} else {
				j := r.i + 1
				for j < n && r.text[j] != '"' && r.text[j] != '\\' {
					j++
				}
				buf.WriteString(r.text[r.i:j])
				r.i = j
			}
			continue
		}

		if r.i+1 >= n {
			r.i = n
			break
		}
		escaped := r.text[r.i+1]
		switch escaped {
		case '"', '\\', '/':
			buf.WriteByte(escaped)
			r.i += 2
		case 'b':
			buf.WriteByte('\b')
			r.i += 2
		case 'f':
			buf.WriteByte('\f')
			r.i += 2
		case 'n':
			buf.WriteByte('\n')
			r.i += 2
		case 'r':
			buf.WriteByte('\r')
			r.i += 2
		case 't':
			buf.WriteByte('\t')
			r.i += 2
		case 'u':
			if r.i+6 > n {
				r.i = n
				continue
			}
			codeVal, parseErr := strconv.ParseUint(r.text[r.i+2:r.i+6], 16, 32)
			if parseErr != nil {
				return "", r.fail("invalid unicode escape")
			}
			code := rune(codeVal)
			if code >= 0xD800 && code <= 0xDBFF {
				if r.i+12 > n {
					rem := r.text[r.i+6 : n]
					if r.partial() && (strings.HasPrefix(`\u`, rem) || strings.HasPrefix(rem, `\u`)) {
						r.i = n
						continue
					}
				}
				if r.i+12 <= n && r.text[r.i+6:r.i+8] == `\u` {
					lowVal, lowErr := strconv.ParseUint(r.text[r.i+8:r.i+12], 16, 32)
					if lowErr != nil {
						return "", r.fail("invalid unicode escape")
					}
					low := rune(lowVal)
					if low >= 0xDC00 && low <= 0xDFFF {
						code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
						r.i += 6
					}
				}
			}
			buf.WriteRune(code)
			r.i += 6
		default:
			return "", r.fail(fmt.Sprintf("invalid escape '\\%c'", escaped))
		}
	}

	if healable && r.partial() {
		value := buf.String()
		value = value[:blocklexer.CompleteUTF8PrefixLen(value)]
		isURL := false
		for _, pfx := range urlPrefixes {
			if strings.HasPrefix(value, pfx) {
				isURL = true
				break
			}
		}
		if !isURL {
			r.cut = true
			return value, nil
		}
	}
	return "", r.endErr()
}

func (r *reader) readNumber() (any, error) {
	start := r.i
	if r.text[r.i] == '-' {
		r.i++
	}
	for !r.atEnd() {
		c := r.text[r.i]
		if (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.' || c == 'e' || c == 'E' {
			r.i++
		} else {
			break
		}
	}
	if r.atEnd() && r.partial() {
		return nil, r.endErr()
	}
	literal := r.text[start:r.i]
	if !numberRE.MatchString(literal) {
		return nil, r.fail(fmt.Sprintf("invalid number %q", literal))
	}
	// Integer literals read as int64 and the rest as float64, so integers and floats stay
	// distinct as they do in Python's json_reader and core.ParseJSON.
	if strings.ContainsAny(literal, ".eE") {
		f, err := strconv.ParseFloat(literal, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, r.fail(fmt.Sprintf("invalid number %q", literal))
		}
		return f, nil
	}
	if i64, err := strconv.ParseInt(literal, 10, 64); err == nil {
		return i64, nil
	}
	f, err := strconv.ParseFloat(literal, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil, r.fail(fmt.Sprintf("invalid number %q", literal))
	}
	return f, nil
}

func (r *reader) skipSpace() {
	for !r.atEnd() {
		switch r.text[r.i] {
		case ' ', '\t', '\n', '\r':
			r.i++
		default:
			return
		}
	}
}

func (r *reader) endErr() error {
	if r.partial() {
		return errUnfinished
	}
	return r.fail("unexpected end of the JSON text")
}

func (r *reader) fail(reason string) error {
	return fmt.Errorf("invalid JSON at %d: %s", r.i, reason)
}

// BlockScanner incrementally scans a growing <a2ui-json> block body for </a2ui-json>
// outside JSON string literals in O(N) total time across chunks.
type BlockScanner struct {
	start    int
	i        int
	inString bool
}

// NewBlockScanner constructs a BlockScanner starting at byte offset start.
func NewBlockScanner(start int) *BlockScanner {
	return &BlockScanner{start: start, i: start}
}

// Scan scans content (which grows monotonically across calls), returning
// (closeTagStart, hasCloseTag, readableBodyLen).
func (s *BlockScanner) Scan(content string) (int, bool, int) {
	i := s.i
	n := len(content)
	inStr := s.inString
	defer func() {
		s.i = i
		s.inString = inStr
	}()

	for i < n {
		if inStr {
			relQuote := strings.IndexByte(content[i:n], '"')
			quotePos := n
			if relQuote >= 0 {
				quotePos = i + relQuote
			}
			relEsc := strings.IndexByte(content[i:quotePos], '\\')
			if relEsc >= 0 {
				i = i + relEsc + 2
				continue
			}
			if relQuote < 0 {
				i = n
				break
			}
			inStr = false
			i = quotePos + 1
			continue
		}
		c := content[i]
		if c == '"' {
			inStr = true
		} else if c == '<' {
			if CloseTagAnchoredRE.MatchString(content[i:]) {
				return i, true, i - s.start
			}
			if blocklexer.IsTagPrefix(content, i, CloseTag) || CloseTagStartRE.MatchString(content[i:]) {
				return 0, false, i - s.start
			}
		}
		i++
	}
	return 0, false, n - s.start
}
