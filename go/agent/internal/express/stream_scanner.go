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

package express

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/a2ui-project/a2ui/go/agent/internal/blocklexer"
	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

var (
	// OpenTagRe matches `<a2ui>` and `<a2ui ...>` case-insensitively.
	OpenTagRe = regexp.MustCompile(`(?i)<a2ui(?:\s[^>]*)?>`)
	// CloseTagRe matches `</a2ui>` case-insensitively.
	CloseTagRe = regexp.MustCompile(`(?i)</a2ui\s*>`)

	openTagStartRe                = regexp.MustCompile(`(?i)^<a2ui\s[^>]*\z`)
	closeTagStartRe               = regexp.MustCompile(`(?i)^</a2ui\s*\z`)
	leadingFenceRe                = regexp.MustCompile("(?s)^\\s*(?:```[a-zA-Z0-9_-]*[ \\t]*\\r?\\n|`+\\s*)")
	trailingFenceRe               = regexp.MustCompile("(?s)(?:\\r?\\n?[ \\t]*```[a-zA-Z0-9_-]*|`+)\\s*\\z")
	outerTrailingCodeFenceRe      = regexp.MustCompile("\\s*```[a-zA-Z0-9_-]*[ \\t]*(?:\\r?\\n[ \\t]*)?\\z")
	outerTrailingFencePrefixRe    = regexp.MustCompile("(?:```[a-zA-Z0-9_-]*[ \\t]*(?:\\r?\\n[ \\t]*)?|`+)\\z")
	outerLeadingFenceRe           = regexp.MustCompile("^\\s*```[a-zA-Z0-9_-]*[ \\t]*(?:\\r?\\n|\\z)")
	outerLeadingFencePrefixRe     = regexp.MustCompile("^\\s*(?:`{0,2}|```[a-zA-Z0-9_-]*[ \\t]*\\r?)\\z")
	outerLeadingFenceInlineRe     = regexp.MustCompile("^(?:\\s*```[a-zA-Z0-9_-]*[ \\t]*(?:\\r?\\n|\\z)|`+)")
	outerLeadingFenceInlinePrefRe = regexp.MustCompile("^(?:`+|\\s*`{0,2}|\\s*```[a-zA-Z0-9_-]*[ \\t]*\\r?)\\z")
	trailingFenceCloseRe          = regexp.MustCompile("\\s*```[a-zA-Z0-9_-]*[ \\t]*\\r?\\n?\\z")
	streamIdentRe                 = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*`)
	dataAssignPrefixRe            = regexp.MustCompile(`^\s*\$([a-zA-Z0-9_/]*)\s*=`)
)

func replaceFirst(re *regexp.Regexp, s, repl string) string {
	loc := re.FindStringIndex(s)
	if loc == nil {
		return s
	}
	return s[:loc[0]] + repl + s[loc[1]:]
}

// PossibleOpenTagStart returns the index where a tail of text could start `<a2ui>`, else len(text).
func PossibleOpenTagStart(text string) int {
	for idx := strings.IndexByte(text, '<'); idx >= 0; {
		if isTagPrefix(text, idx, openSentinelTag) || openTagStartRe.MatchString(text[idx:]) {
			return idx
		}
		next := strings.IndexByte(text[idx+1:], '<')
		if next < 0 {
			break
		}
		idx += 1 + next
	}
	return len(text)
}

// PossibleOuterFenceStart returns the start index of a trailing markdown fence prefix at the end of text.
func PossibleOuterFenceStart(text string) int {
	if loc := outerTrailingFencePrefixRe.FindStringIndex(text); loc != nil {
		return loc[0]
	}
	return len(text)
}

// HasOuterInlineOpenBacktick reports whether beforeOpen ends with 1 or 2 inline backticks after start-of-string or whitespace.
func HasOuterInlineOpenBacktick(beforeOpen string) bool {
	tickCount := 0
	for i := len(beforeOpen) - 1; i >= 0 && beforeOpen[i] == '`'; i-- {
		tickCount++
	}
	if tickCount != 1 && tickCount != 2 {
		return false
	}
	prefix := beforeOpen[:len(beforeOpen)-tickCount]
	if prefix == "" {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(prefix)
	return unicode.IsSpace(r)
}

// StripOuterTrailingFence removes an outer opening code fence or inline backtick wrapper immediately preceding `<a2ui>`.
func StripOuterTrailingFence(beforeOpen string) string {
	if loc := outerTrailingCodeFenceRe.FindStringIndex(beforeOpen); loc != nil {
		return beforeOpen[:loc[0]]
	}
	if HasOuterInlineOpenBacktick(beforeOpen) {
		i := len(beforeOpen)
		for i > 0 && beforeOpen[i-1] == '`' {
			i--
		}
		return beforeOpen[:i]
	}
	return beforeOpen
}

// MatchesOuterLeadingFencePrefix reports whether inputStr could be the prefix of a closing fence right after `</a2ui>`.
func MatchesOuterLeadingFencePrefix(inputStr string, inlineBackticks bool) bool {
	if inlineBackticks {
		return outerLeadingFenceInlinePrefRe.MatchString(inputStr)
	}
	return outerLeadingFencePrefixRe.MatchString(inputStr)
}

// StripOuterLeadingFence removes a closing fence or inline backticks immediately following `</a2ui>`.
func StripOuterLeadingFence(inputStr string, inlineBackticks bool) string {
	if inlineBackticks {
		return replaceFirst(outerLeadingFenceInlineRe, inputStr, "")
	}
	return replaceFirst(outerLeadingFenceRe, inputStr, "")
}

// StripTrailingFenceClose removes a trailing closing code fence left over at stream close.
func StripTrailingFenceClose(rest string) string {
	return replaceFirst(trailingFenceCloseRe, rest, "")
}

func isTagPrefix(text string, idx int, tag string) bool {
	return len(text)-idx < len(tag) && strings.HasPrefix(tag, strings.ToLower(text[idx:]))
}

// ScanExpressBlockFrom scans content from start for `</a2ui>` outside string literals and block comments.
// Returns (closeStart, hasClose, readableEnd, resumePos).
func ScanExpressBlockFrom(content string, start int) (int, bool, int, int) {
	i := start
	n := len(content)
	for i < n {
		if content[i] == '#' || strings.HasPrefix(content[i:], "//") || strings.HasPrefix(content[i:], "--") {
			j := i + 2
			if content[i] == '#' {
				j = i + 1
			}
			for j < n && content[j] != '\n' && content[j] != '\r' {
				if content[j] == '<' {
					if closeIdx, hasClose, readable, hit := checkCloseTagAt(content, j); hit {
						// Resume at the comment opener so a partial `<` / `</a2` prefix inside
						// a line comment does not escape comment context on the next chunk.
						return closeIdx, hasClose, readable, i
					}
				}
				j++
			}
			if j < n {
				i = j + 1
				continue
			}
			return 0, false, n, i
		}
		nextI, completed := skipBlockLiteralOrComment(content, i, n)
		if nextI > i {
			if !completed {
				return 0, false, n, i
			}
			i = nextI
			continue
		}
		if content[i] == '<' {
			if closeIdx, hasClose, readable, hit := checkCloseTagAt(content, i); hit {
				return closeIdx, hasClose, readable, i
			}
		}
		i++
	}
	resumePos := n
	if n > 0 {
		switch content[n-1] {
		case 'r', 'R', '/', '-':
			resumePos = n - 1
		}
	}
	return 0, false, n, resumePos
}

func skipBlockLiteralOrComment(content string, i, n int) (int, bool) {
	if (content[i] == 'r' || content[i] == 'R') && i+1 < n && content[i+1] == '"' {
		prevIsIdent := false
		if i > 0 {
			r, _ := utf8.DecodeLastRuneInString(content[:i])
			prevIsIdent = unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
		}
		if !prevIsIdent {
			if end, ok := skipStreamStringLiteral(content, i+1, n, true); ok {
				return end, true
			}
			return n, false
		}
	}
	if content[i] == '"' {
		if end, ok := skipStreamStringLiteral(content, i, n, false); ok {
			return end, true
		}
		return n, false
	}
	if strings.HasPrefix(content[i:], "/*") {
		endComment := strings.Index(content[i+2:], "*/")
		if endComment >= 0 {
			return i + 2 + endComment + 2, true
		}
		return n, false
	}
	return i, true
}

func checkCloseTagAt(content string, i int) (int, bool, int, bool) {
	if loc := CloseTagRe.FindStringIndex(content[i:]); loc != nil && loc[0] == 0 {
		return i, true, i, true
	}
	if isTagPrefix(content, i, closeSentinelTag) || closeTagStartRe.MatchString(content[i:]) {
		return 0, false, i, true
	}
	return 0, false, 0, false
}

func skipStreamStringLiteral(content string, start, n int, raw bool) (int, bool) {
	delim := `"`
	triple := strings.HasPrefix(content[start:], `"""`)
	if triple {
		delim = `"""`
	}
	i := start + len(delim)
	for i < n {
		if !raw && content[i] == '\\' {
			if i+1 >= n {
				return 0, false
			}
			i += 2
			continue
		}
		if strings.HasPrefix(content[i:], delim) {
			end := i + len(delim)
			// Hold `""` at end of buffer because a third `"` may turn it into `"""`.
			if !triple && end == n && end-start == 2 {
				return 0, false
			}
			return end, true
		}
		i++
	}
	return 0, false
}

// CleanExpressPayload strips leading/trailing markdown fences from block[:end].
// Returns ("", false) when only an incomplete opening fence has arrived.
func CleanExpressPayload(block string, end int) (string, bool) {
	text := block[:end]
	stripped := strings.TrimLeftFunc(text, unicode.IsSpace)
	if stripped != "" && len(stripped) <= 3 && strings.HasPrefix("```", stripped) {
		return "", false
	}
	if strings.HasPrefix(stripped, "```") && !strings.Contains(stripped, "\n") {
		return "", false
	}
	cleaned := replaceFirst(leadingFenceRe, text, "")
	cleaned = stripTrailingFence(cleaned)
	return cleaned, true
}

// stripTrailingFence removes a match of trailingFenceRe at the end of s without running an
// unanchored regex scan across the full streaming buffer on every chunk.
func stripTrailingFence(s string) string {
	i := len(s)
	for i > 0 && isRE2Space(s[i-1]) {
		i--
	}
	if i == 0 {
		return s
	}
	var bStart int
	if s[i-1] == '`' {
		bStart = i - 1
		for bStart > 0 && s[bStart-1] == '`' {
			bStart--
		}
	} else if isFenceLangChar(s[i-1]) {
		j := i - 1
		for j > 0 && isFenceLangChar(s[j-1]) {
			j--
		}
		if j < 3 || s[j-3:j] != "```" {
			return s
		}
		bStart = j - 3
		for bStart > 0 && s[bStart-1] == '`' {
			bStart--
		}
	} else {
		return s
	}
	k := bStart
	for k > 0 && isRE2Space(s[k-1]) {
		k--
	}
	if loc := trailingFenceRe.FindStringIndex(s[k:]); loc != nil {
		return s[:k+loc[0]]
	}
	return s
}

func isRE2Space(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r', '\f':
		return true
	default:
		return false
	}
}

func isFenceLangChar(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_' || b == '-'
}

type scanCursor struct {
	depth        int
	hasToken     bool
	sawEquals    bool
	hasRHS       bool
	rhsClosed    bool
	lastComplete int
}

func (c *scanCursor) resetStatement(pos int) {
	c.hasToken = false
	c.sawEquals = false
	c.hasRHS = false
	c.rhsClosed = false
	c.lastComplete = pos
}

// SplitCompleteStatements splits Express source into (completePrefix, trailingFragment).
func SplitCompleteStatements(source string, isFinal bool) (string, string) {
	if isFinal {
		return source, ""
	}
	cur := &scanCursor{}
	i := 0
	n := len(source)
	for i < n {
		nextI, closedString := stepStringOrComment(source, i, n)
		if nextI > i {
			if closedString && cur.depth == 0 && cur.sawEquals {
				cur.hasRHS = true
				cur.rhsClosed = true
				cur.lastComplete = nextI
			}
			i = nextI
			continue
		}
		i = stepCodeChar(source, i, n, cur)
	}
	return source[:cur.lastComplete], source[cur.lastComplete:]
}

func stepStringOrComment(source string, i, n int) (int, bool) {
	if (source[i] == 'r' || source[i] == 'R') && i+1 < n && source[i+1] == '"' {
		end, ok := scanDoubleQuoted(source, i+1, n, true)
		if !ok || (end == n && end-(i+1) == 2) {
			return n, false
		}
		return end, true
	}
	if source[i] == '"' {
		end, ok := scanDoubleQuoted(source, i, n, false)
		if !ok || (end == n && end-i == 2) {
			return n, false
		}
		return end, true
	}
	if strings.HasPrefix(source[i:], "/*") {
		closeIdx := strings.Index(source[i+2:], "*/")
		if closeIdx >= 0 {
			return i + 2 + closeIdx + 2, false
		}
		return n, false
	}
	if source[i] == '#' || strings.HasPrefix(source[i:], "//") || strings.HasPrefix(source[i:], "--") {
		nl := strings.IndexByte(source[i:], '\n')
		if nl >= 0 {
			return i + nl, false
		}
		return n, false
	}
	return i, false
}

func scanDoubleQuoted(source string, quoteStart, n int, raw bool) (int, bool) {
	delim := `"`
	if strings.HasPrefix(source[quoteStart:], `"""`) {
		delim = `"""`
	}
	i := quoteStart + len(delim)
	for i < n {
		if !raw && source[i] == '\\' {
			if i+1 >= n {
				return 0, false
			}
			i += 2
			continue
		}
		if strings.HasPrefix(source[i:], delim) {
			return i + len(delim), true
		}
		i++
	}
	return 0, false
}

func stepCodeChar(source string, i, n int, cur *scanCursor) int {
	ch := source[i]
	switch ch {
	case '(', '[', '{':
		cur.depth++
		cur.hasToken = true
		if cur.sawEquals {
			cur.hasRHS = true
			cur.rhsClosed = false
		}
		return i + 1
	case ')', ']', '}':
		if cur.depth > 0 {
			cur.depth--
			if cur.depth == 0 && (cur.sawEquals || cur.hasToken) {
				cur.hasRHS = true
				cur.rhsClosed = true
				cur.lastComplete = i + 1
			}
		}
		return i + 1
	case '\n', ';':
		if cur.depth == 0 {
			if cur.rhsClosed || (cur.sawEquals && cur.hasRHS) {
				cur.resetStatement(i + 1)
			} else if !cur.hasToken {
				cur.lastComplete = i + 1
			}
			return i + 1
		}
	}
	r, width := utf8.DecodeRuneInString(source[i:])
	if !unicode.IsSpace(r) {
		if cur.depth == 0 && ch == '=' && (i+1 >= n || source[i+1] != '=') {
			cur.sawEquals = true
			cur.hasToken = true
			return i + width
		}
		cur.hasToken = true
		if cur.depth == 0 && cur.sawEquals {
			cur.hasRHS = true
		}
	}
	return i + width
}

type openCallFrame struct {
	name      string
	argIndex  int
	kwargName *string
	lastIdent string
}

type fragmentScanState struct {
	brackets  []byte
	calls     []openCallFrame
	lastIdent string
}

// HealProgressiveFragment speculatively closes an unclosed string literal in a progressive slot.
func HealProgressiveFragment(
	fragment string,
	helpers map[string]*schemahelper.CatalogSchemaHelper,
	helperOrder []string,
	progressiveKeys map[string]bool,
) (string, bool) {
	if len(progressiveKeys) == 0 || strings.TrimSpace(fragment) == "" {
		return "", false
	}
	strStart, delim, isRaw, brackets, calls, found := scanFragmentForUnclosedString(fragment)
	if !found {
		return "", false
	}
	content := fragment[strStart:]
	if isURLLike(content) {
		return "", false
	}
	if !isProgressiveSlot(fragment, calls, helpers, helperOrder, progressiveKeys) {
		return "", false
	}
	healed := fragment[:strStart+blocklexer.CompleteUTF8PrefixLen(fragment[strStart:])]
	if !isRaw && hasOddTrailingBackslashes(healed[strStart:]) {
		healed = healed[:len(healed)-1]
	}
	if delim == `"""` && strings.HasSuffix(healed[strStart:], `"`) {
		if isRaw {
			return "", false
		}
		healed = healed[:len(healed)-1] + `\"`
	}
	var closeBuf strings.Builder
	closeBuf.WriteString(healed)
	closeBuf.WriteString(delim)
	for idx := len(brackets) - 1; idx >= 0; idx-- {
		closeBuf.WriteByte(closingDelimiter(brackets[idx]))
	}
	return closeBuf.String(), true
}

func scanFragmentForUnclosedString(fragment string) (int, string, bool, []byte, []openCallFrame, bool) {
	i := 0
	n := len(fragment)
	st := &fragmentScanState{}
	for i < n {
		isRaw := (fragment[i] == 'r' || fragment[i] == 'R') && i+1 < n && fragment[i+1] == '"'
		if isRaw || fragment[i] == '"' {
			quotePos := i
			if isRaw {
				quotePos = i + 1
			}
			delim := `"`
			if strings.HasPrefix(fragment[quotePos:], `"""`) {
				delim = `"""`
			}
			end, ok := scanDoubleQuoted(fragment, quotePos, n, isRaw)
			if !ok {
				return quotePos + len(delim), delim, isRaw, st.brackets, st.calls, true
			}
			i = end
			continue
		}
		if strings.HasPrefix(fragment[i:], "/*") {
			closeIdx := strings.Index(fragment[i+2:], "*/")
			if closeIdx < 0 {
				return 0, "", false, nil, nil, false
			}
			i = i + 2 + closeIdx + 2
			continue
		}
		if fragment[i] == '#' || strings.HasPrefix(fragment[i:], "//") || strings.HasPrefix(fragment[i:], "--") {
			nl := strings.IndexByte(fragment[i:], '\n')
			if nl < 0 {
				return 0, "", false, nil, nil, false
			}
			i = i + nl + 1
			continue
		}
		if m := streamIdentRe.FindString(fragment[i:]); m != "" {
			st.lastIdent = m
			if len(st.calls) > 0 && len(st.brackets) > 0 && st.brackets[len(st.brackets)-1] == '(' {
				st.calls[len(st.calls)-1].lastIdent = m
			}
			i += len(m)
			continue
		}
		r, width := utf8.DecodeRuneInString(fragment[i:])
		applyFragmentPunct(fragment[i], unicode.IsSpace(r), st)
		i += width
	}
	return 0, "", false, nil, nil, false
}

func applyFragmentPunct(ch byte, isSpace bool, st *fragmentScanState) {
	inCallParens := len(st.calls) > 0 && len(st.brackets) > 0 && st.brackets[len(st.brackets)-1] == '('
	switch ch {
	case '(':
		st.brackets = append(st.brackets, '(')
		st.calls = append(st.calls, openCallFrame{name: st.lastIdent})
		st.lastIdent = ""
	case '[', '{':
		st.brackets = append(st.brackets, ch)
		st.lastIdent = ""
	case ')', ']', '}':
		if len(st.brackets) > 0 {
			popped := st.brackets[len(st.brackets)-1]
			st.brackets = st.brackets[:len(st.brackets)-1]
			if popped == '(' && len(st.calls) > 0 {
				st.calls = st.calls[:len(st.calls)-1]
			}
		}
		st.lastIdent = ""
	case ',':
		if inCallParens {
			frame := &st.calls[len(st.calls)-1]
			frame.argIndex++
			frame.kwargName = nil
			frame.lastIdent = ""
		}
	case '=':
		if inCallParens {
			frame := &st.calls[len(st.calls)-1]
			if frame.lastIdent != "" {
				kw := frame.lastIdent
				frame.kwargName = &kw
			}
		}
	default:
		if !isSpace {
			st.lastIdent = ""
		}
	}
}

func isProgressiveSlot(
	fragment string,
	calls []openCallFrame,
	helpers map[string]*schemahelper.CatalogSchemaHelper,
	helperOrder []string,
	progressiveKeys map[string]bool,
) bool {
	if len(calls) == 0 {
		sub := dataAssignPrefixRe.FindStringSubmatchIndex(fragment)
		if sub == nil {
			return false
		}
		// Reject `==` immediately following `=`.
		if sub[1] < len(fragment) && fragment[sub[1]] == '=' {
			return false
		}
		path := strings.TrimRight(fragment[sub[2]:sub[3]], "/")
		lastSeg := path
		if slash := strings.LastIndexByte(path, '/'); slash >= 0 {
			lastSeg = path[slash+1:]
		}
		return progressiveKeys[lastSeg]
	}
	frame := calls[len(calls)-1]
	if frame.name == "" {
		return false
	}
	for _, cid := range helperOrder {
		helper := helpers[cid]
		if _, ok := helper.Components[frame.name]; ok {
			if frame.kwargName != nil {
				return progressiveKeys[*frame.kwargName]
			}
			var props []string
			for _, p := range helper.ComponentProperties(frame.name) {
				if p != "checks" && p != "@checks" {
					props = append(props, p)
				}
			}
			if frame.argIndex < len(props) {
				return progressiveKeys[props[frame.argIndex]]
			}
		}
	}
	return false
}

func isURLLike(content string) bool {
	lower := strings.ToLower(strings.TrimLeftFunc(content, unicode.IsSpace))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "data:")
}

func hasOddTrailingBackslashes(text string) bool {
	count := 0
	for i := len(text) - 1; i >= 0 && text[i] == '\\'; i-- {
		count++
	}
	return count%2 == 1
}

func closingDelimiter(openCh byte) byte {
	switch openCh {
	case '[':
		return ']'
	case '{':
		return '}'
	default:
		return ')'
	}
}

// MergeSameSurfaceUpdates coalesces consecutive component updates for the same surface.
func MergeSameSurfaceUpdates(messages []core.AgentToRendererMessage) []core.AgentToRendererMessage {
	var merged []core.AgentToRendererMessage
	for _, msg := range messages {
		if len(merged) == 0 || !tryMergeComponentUpdate(merged[len(merged)-1], msg) {
			merged = append(merged, msg)
		}
	}
	return merged
}

func tryMergeComponentUpdate(prev, msg core.AgentToRendererMessage) bool {
	nextUpdate, ok := msg[opUpdateComponents].(map[string]any)
	if !ok {
		return false
	}
	targetID, _ := nextUpdate["surfaceId"].(string)

	var targetList map[string]any
	if prevUpd, ok := prev[opUpdateComponents].(map[string]any); ok {
		if sid, _ := prevUpd["surfaceId"].(string); sid == targetID {
			targetList = prevUpd
		}
	} else if prevCreate, ok := prev[opCreate].(map[string]any); ok {
		if _, hasComps := prevCreate["components"]; hasComps {
			if sid, _ := prevCreate["surfaceId"].(string); sid == targetID {
				targetList = prevCreate
			}
		}
	}
	if targetList == nil {
		return false
	}

	existing := extractMapSlice(targetList["components"])
	incoming := extractMapSlice(nextUpdate["components"])
	var order []string
	byID := make(map[string]map[string]any, len(existing)+len(incoming))
	for _, c := range existing {
		cid, _ := c["id"].(string)
		if _, seen := byID[cid]; !seen {
			order = append(order, cid)
		}
		byID[cid] = c
	}
	for _, c := range incoming {
		cid, _ := c["id"].(string)
		if _, seen := byID[cid]; !seen {
			order = append(order, cid)
		}
		byID[cid] = c
	}
	out := make([]any, 0, len(order))
	for _, cid := range order {
		out = append(out, byID[cid])
	}
	targetList["components"] = out
	return true
}
