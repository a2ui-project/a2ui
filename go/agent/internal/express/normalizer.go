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
)

var (
	openSentinelRe  = regexp.MustCompile(`(?i)<a2ui(?:\s[^>]*)?>`)
	closeSentinelRe = regexp.MustCompile(`(?i)</a2ui\s*>`)

	identOnlyRe     = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	declaredLHSRe   = regexp.MustCompile(`(?m)^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=`)
	splitLHSRe      = regexp.MustCompile(`(?m)^([ \t]*[a-zA-Z_][a-zA-Z0-9_]*)[ \t]*(\r?\n)[ \t]*([a-zA-Z0-9_]+)`)
	splitDataPathRe = regexp.MustCompile(`(\$[a-zA-Z0-9_/]*/)[ \t]*(\r?\n)[ \t]*([a-zA-Z0-9_/]+)`)
	splitArgIdentRe = regexp.MustCompile(`([(\[,:=][ \t]*\r?\n?[ \t]*|[(\[,:=][ \t]*)([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*(\r?\n)[ \t]*([a-zA-Z0-9_]+)`)
)

type normSegment struct {
	isTok bool
	text  string
}

// StripSentinelTags removes outer <a2ui> and </a2ui> sentinel tags outside string literals and block comments.
func StripSentinelTags(source string) string {
	segments := scanSentinelSegments(source)
	hasOpen := false
	for _, seg := range segments {
		if !seg.isTok && openSentinelRe.MatchString(seg.text) {
			hasOpen = true
			break
		}
	}

	var out strings.Builder
	inside := !hasOpen
	for _, seg := range segments {
		if seg.isTok {
			if inside {
				out.WriteString(seg.text)
			}
			continue
		}
		cursor := 0
		for cursor < len(seg.text) {
			sub := seg.text[cursor:]
			if !inside {
				openLoc := openSentinelRe.FindStringIndex(sub)
				if openLoc == nil {
					break
				}
				inside = true
				cursor += openLoc[1]
				continue
			}
			closeLoc := closeSentinelRe.FindStringIndex(sub)
			openLoc := openSentinelRe.FindStringIndex(sub)
			if openLoc != nil && (closeLoc == nil || openLoc[0] < closeLoc[0]) {
				out.WriteString(sub[:openLoc[0]])
				cursor += openLoc[1]
				continue
			}
			if closeLoc != nil {
				out.WriteString(sub[:closeLoc[0]])
				inside = false
				cursor += closeLoc[1]
				if !hasOpen {
					return out.String()
				}
				continue
			}
			out.WriteString(sub)
			break
		}
	}
	return out.String()
}

func scanSentinelSegments(source string) []normSegment {
	var segments []normSegment
	pos := 0
	i := 0
	n := len(source)

	flushCode := func(end int) {
		if end > pos {
			segments = append(segments, normSegment{isTok: false, text: source[pos:end]})
		}
	}

	for i < n {
		// Raw triple string: [rR]"""...("""|EOF)
		if (source[i] == 'r' || source[i] == 'R') && i+3 < n && source[i+1:i+4] == `"""` {
			flushCode(i)
			end := n
			if idx := strings.Index(source[i+4:], `"""`); idx >= 0 {
				end = i + 4 + idx + 3
			}
			segments = append(segments, normSegment{isTok: true, text: source[i:end]})
			i = end
			pos = end
			continue
		}
		// Raw single-line string: [rR]"[^\r\n"]*("|EOF)
		if (source[i] == 'r' || source[i] == 'R') && i+1 < n && source[i+1] == '"' {
			flushCode(i)
			j := i + 2
			for j < n && source[j] != '"' && source[j] != '\r' && source[j] != '\n' {
				j++
			}
			if j < n && source[j] == '"' {
				j++
			}
			segments = append(segments, normSegment{isTok: true, text: source[i:j]})
			i = j
			pos = j
			continue
		}
		// Triple string: """...("""|EOF)
		if i+2 < n && source[i:i+3] == `"""` {
			flushCode(i)
			j := i + 3
			for j < n {
				if source[j] == '\\' {
					j += 2
					continue
				}
				if j+2 < n && source[j:j+3] == `"""` {
					j += 3
					break
				}
				j++
			}
			if j > n {
				j = n
			}
			segments = append(segments, normSegment{isTok: true, text: source[i:j]})
			i = j
			pos = j
			continue
		}
		// Standard single-line string for sentinel scan: "(?:\\[\s\S]|[^\\"\r\n])*("|EOF)
		if source[i] == '"' {
			flushCode(i)
			j := i + 1
			for j < n && source[j] != '\r' && source[j] != '\n' {
				if source[j] == '\\' {
					j += 2
					continue
				}
				if source[j] == '"' {
					j++
					break
				}
				j++
			}
			if j > n {
				j = n
			}
			segments = append(segments, normSegment{isTok: true, text: source[i:j]})
			i = j
			pos = j
			continue
		}
		// Block comment: /*...(\*/|EOF)
		if i+1 < n && source[i:i+2] == "/*" {
			flushCode(i)
			end := n
			if idx := strings.Index(source[i+2:], "*/"); idx >= 0 {
				end = i + 2 + idx + 2
			}
			segments = append(segments, normSegment{isTok: true, text: source[i:end]})
			i = end
			pos = end
			continue
		}
		// Single-line comment: #, //, --
		if source[i] == '#' || (i+1 < n && (source[i:i+2] == "//" || source[i:i+2] == "--")) {
			flushCode(i)
			j := i + 1
			if source[i] != '#' {
				j = i + 2
			}
			for j < n && source[j] != '\r' && source[j] != '\n' {
				j++
			}
			tok := source[i:j]
			if closeLoc := closeSentinelRe.FindStringIndex(tok); closeLoc != nil {
				if closeLoc[0] > 0 {
					segments = append(segments, normSegment{isTok: true, text: tok[:closeLoc[0]]})
				}
				segments = append(segments, normSegment{isTok: false, text: tok[closeLoc[0]:]})
			} else {
				segments = append(segments, normSegment{isTok: true, text: tok})
			}
			i = j
			pos = j
			continue
		}
		i++
	}
	flushCode(n)
	return segments
}

// NormalizeSource rewrites SQL-style `--` comments to `//` and heals line-broken
// LHS variable names, argument identifiers, and `$/` data paths outside strings and comments,
// preserving exact line counts for accurate syntax error line numbers.
func NormalizeSource(source string) string {
	segments := scanNormalizeSegments(source)

	depth := 0
	segDepths := make([][]int, len(segments))
	for idx, seg := range segments {
		if seg.isTok {
			continue
		}
		depths := make([]int, len(seg.text))
		for i := 0; i < len(seg.text); i++ {
			depths[i] = depth
			switch seg.text[i] {
			case '(', '[', '{':
				depth++
			case ')', ']', '}':
				if depth > 0 {
					depth--
				}
			}
		}
		segDepths[idx] = depths
	}

	type segPos struct {
		segIdx int
		offset int
	}
	splitP2Starts := make(map[segPos]bool)
	for segIdx, seg := range segments {
		if seg.isTok {
			continue
		}
		depths := segDepths[segIdx]
		for _, m := range splitLHSRe.FindAllStringSubmatchIndex(seg.text, -1) {
			// m[2]:m[3] is group 1 (p1Raw), m[6]:m[7] is group 3 (p2), m[1] is end of match
			if !startsWithAssignEquals(seg.text[m[1]:]) {
				continue
			}
			if depths[m[2]] == 0 {
				splitP2Starts[segPos{segIdx: segIdx, offset: m[6]}] = true
			}
		}
	}

	directDeclared := make(map[string]bool)
	for segIdx, seg := range segments {
		if seg.isTok {
			continue
		}
		depths := segDepths[segIdx]
		for _, m := range declaredLHSRe.FindAllStringSubmatchIndex(seg.text, -1) {
			// Ensure the '=' matched at m[1]-1 is not '=='
			if m[1] < len(seg.text) && seg.text[m[1]] == '=' {
				continue
			}
			idStart := m[2]
			if depths[idStart] == 0 && !splitP2Starts[segPos{segIdx: segIdx, offset: idStart}] {
				directDeclared[seg.text[m[2]:m[3]]] = true
			}
		}
	}

	declared := make(map[string]bool, len(directDeclared))
	for k := range directDeclared {
		declared[k] = true
	}
	for segIdx, seg := range segments {
		if seg.isTok {
			continue
		}
		depths := segDepths[segIdx]
		for _, m := range splitLHSRe.FindAllStringSubmatchIndex(seg.text, -1) {
			if !startsWithAssignEquals(seg.text[m[1]:]) {
				continue
			}
			if depths[m[2]] == 0 {
				p1 := strings.TrimSpace(seg.text[m[2]:m[3]])
				p2 := seg.text[m[6]:m[7]]
				if !directDeclared[p1] && !directDeclared[p2] {
					declared[p1+p2] = true
				}
			}
		}
	}

	var out strings.Builder
	for _, seg := range segments {
		if seg.isTok {
			out.WriteString(seg.text)
			continue
		}
		txt := rewriteSplitDataPaths(seg.text)
		txt = rewriteSplitLHS(txt, directDeclared)
		txt = rewriteSplitArgIdents(txt, declared)
		out.WriteString(txt)
	}
	return out.String()
}

func scanNormalizeSegments(source string) []normSegment {
	var segments []normSegment
	pos := 0
	i := 0
	n := len(source)

	flushCode := func(end int) {
		if end > pos {
			segments = append(segments, normSegment{isTok: false, text: source[pos:end]})
		}
	}

	for i < n {
		// Closed raw triple string: [rR]"""[\s\S]*?"""
		if (source[i] == 'r' || source[i] == 'R') && i+3 < n && source[i+1:i+4] == `"""` {
			if idx := strings.Index(source[i+4:], `"""`); idx >= 0 {
				flushCode(i)
				end := i + 4 + idx + 3
				segments = append(segments, normSegment{isTok: true, text: source[i:end]})
				i = end
				pos = end
				continue
			}
		}
		// Closed raw single-line string: [rR]"[^\r\n"]*"
		if (source[i] == 'r' || source[i] == 'R') && i+1 < n && source[i+1] == '"' {
			j := i + 2
			for j < n && source[j] != '"' && source[j] != '\r' && source[j] != '\n' {
				j++
			}
			if j < n && source[j] == '"' {
				flushCode(i)
				end := j + 1
				segments = append(segments, normSegment{isTok: true, text: source[i:end]})
				i = end
				pos = end
				continue
			}
		}
		// Closed triple string: """(?:\\[\s\S]|[^\\])*?"""
		if i+2 < n && source[i:i+3] == `"""` {
			j := i + 3
			closed := false
			for j < n {
				if source[j] == '\\' {
					if j+1 >= n {
						break
					}
					j += 2
					continue
				}
				if j+2 < n && source[j:j+3] == `"""` {
					j += 3
					closed = true
					break
				}
				j++
			}
			if closed {
				flushCode(i)
				segments = append(segments, normSegment{isTok: true, text: source[i:j]})
				i = j
				pos = j
				continue
			}
		}
		// Closed standard string (multi-line allowed): "(?:\\[\s\S]|[^\\])*?"
		if source[i] == '"' {
			j := i + 1
			closed := false
			for j < n {
				if source[j] == '\\' {
					if j+1 >= n {
						break
					}
					j += 2
					continue
				}
				if source[j] == '"' {
					j++
					closed = true
					break
				}
				j++
			}
			if closed {
				flushCode(i)
				segments = append(segments, normSegment{isTok: true, text: source[i:j]})
				i = j
				pos = j
				continue
			}
		}
		// Closed block comment: /\*[\s\S]*?\*/
		if i+1 < n && source[i:i+2] == "/*" {
			if idx := strings.Index(source[i+2:], "*/"); idx >= 0 {
				flushCode(i)
				end := i + 2 + idx + 2
				segments = append(segments, normSegment{isTok: true, text: source[i:end]})
				i = end
				pos = end
				continue
			}
		}
		// Single-line comment: # or //
		if source[i] == '#' || (i+1 < n && source[i:i+2] == "//") {
			flushCode(i)
			j := i + 1
			if source[i] != '#' {
				j = i + 2
			}
			for j < n && source[j] != '\r' && source[j] != '\n' {
				j++
			}
			segments = append(segments, normSegment{isTok: true, text: source[i:j]})
			i = j
			pos = j
			continue
		}
		// SQL single-line comment: --([^\r\n]*) -> //\1
		if i+1 < n && source[i:i+2] == "--" {
			flushCode(i)
			j := i + 2
			for j < n && source[j] != '\r' && source[j] != '\n' {
				j++
			}
			segments = append(segments, normSegment{isTok: true, text: "//" + source[i+2:j]})
			i = j
			pos = j
			continue
		}
		i++
	}
	flushCode(n)
	return segments
}

func startsWithAssignEquals(rest string) bool {
	i := 0
	for i < len(rest) && (rest[i] == ' ' || rest[i] == '\t') {
		i++
	}
	if i >= len(rest) || rest[i] != '=' {
		return false
	}
	if i+1 < len(rest) && rest[i+1] == '=' {
		return false
	}
	return true
}

func startsWithArgTerminator(rest string) bool {
	i := 0
	for i < len(rest) && (rest[i] == ' ' || rest[i] == '\t') {
		i++
	}
	if i < len(rest) {
		switch rest[i] {
		case ',', ')', ']', '}':
			return true
		}
	}
	// Check `\s*\r?\n` at start of rest
	j := 0
	for j < len(rest) {
		ch := rest[j]
		if ch == '\n' {
			return true
		}
		if ch == '\r' && j+1 < len(rest) && rest[j+1] == '\n' {
			return true
		}
		if ch != ' ' && ch != '\t' && ch != '\r' && ch != '\v' && ch != '\f' {
			break
		}
		j++
	}
	return false
}

func rewriteSplitDataPaths(seg string) string {
	matches := splitDataPathRe.FindAllStringSubmatchIndex(seg, -1)
	if len(matches) == 0 {
		return seg
	}
	var b strings.Builder
	last := 0
	for _, m := range matches {
		b.WriteString(seg[last:m[0]])
		p1 := seg[m[2]:m[3]]
		nl := seg[m[4]:m[5]]
		p2 := seg[m[6]:m[7]]
		rest := seg[m[1]:]
		if identOnlyRe.MatchString(p2) && startsWithAssignEquals(rest) {
			b.WriteString(seg[m[0]:m[1]])
		} else {
			b.WriteString(p1)
			b.WriteString(p2)
			b.WriteString(nl)
		}
		last = m[1]
	}
	b.WriteString(seg[last:])
	return b.String()
}

func rewriteSplitLHS(seg string, directDeclared map[string]bool) string {
	matches := splitLHSRe.FindAllStringSubmatchIndex(seg, -1)
	if len(matches) == 0 {
		return seg
	}
	var b strings.Builder
	last := 0
	for _, m := range matches {
		b.WriteString(seg[last:m[0]])
		p1Raw := seg[m[2]:m[3]]
		nl := seg[m[4]:m[5]]
		p2 := seg[m[6]:m[7]]
		rest := seg[m[1]:]
		p1 := strings.TrimSpace(p1Raw)
		if startsWithAssignEquals(rest) && !directDeclared[p1] && !directDeclared[p2] {
			b.WriteString(p1Raw)
			b.WriteString(p2)
			b.WriteString(nl)
		} else {
			b.WriteString(seg[m[0]:m[1]])
		}
		last = m[1]
	}
	b.WriteString(seg[last:])
	return b.String()
}

func rewriteSplitArgIdents(seg string, declared map[string]bool) string {
	matches := splitArgIdentRe.FindAllStringSubmatchIndex(seg, -1)
	if len(matches) == 0 {
		return seg
	}
	var b strings.Builder
	last := 0
	for _, m := range matches {
		b.WriteString(seg[last:m[0]])
		prefix := seg[m[2]:m[3]]
		p1 := seg[m[4]:m[5]]
		nl := seg[m[6]:m[7]]
		p2 := seg[m[8]:m[9]]
		rest := seg[m[1]:]
		joined := p1 + p2
		if startsWithArgTerminator(rest) && declared[joined] && !declared[p1] && !declared[p2] {
			b.WriteString(prefix)
			b.WriteString(joined)
			b.WriteString(nl)
		} else {
			b.WriteString(seg[m[0]:m[1]])
		}
		last = m[1]
	}
	b.WriteString(seg[last:])
	return b.String()
}
