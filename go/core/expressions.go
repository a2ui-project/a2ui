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

package core

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxExpressionTemplateLength is the maximum length in bytes/chars of a ${...} template string.
	MaxExpressionTemplateLength = 10000
	// MaxExpressionParts is the maximum number of top-level parts produced by ParseExpressionTemplate.
	MaxExpressionParts = 1000
	// MaxExpressionDepth is the maximum recursion depth for nested interpolations and function arguments.
	MaxExpressionDepth = 100
)

var numberLiteralRe = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

type exprScanner struct {
	input string
	pos   int // byte offset in input
}

func (s *exprScanner) isAtEnd() bool {
	return s.pos >= len(s.input)
}

func (s *exprScanner) peekRune() (rune, int) {
	if s.pos >= len(s.input) {
		return 0, 0
	}
	return utf8.DecodeRuneInString(s.input[s.pos:])
}

func (s *exprScanner) peekByte(offset int) byte {
	idx := s.pos + offset
	if idx < 0 || idx >= len(s.input) {
		return 0
	}
	return s.input[idx]
}

func (s *exprScanner) advanceRune() rune {
	r, w := s.peekRune()
	s.pos += w
	return r
}

func (s *exprScanner) advanceBytes(n int) {
	s.pos += n
	if s.pos > len(s.input) {
		s.pos = len(s.input)
	}
}

func (s *exprScanner) matchByte(expected byte) bool {
	if s.peekByte(0) == expected {
		s.pos++
		return true
	}
	return false
}

func (s *exprScanner) hasPrefix(prefix string) bool {
	return strings.HasPrefix(s.input[s.pos:], prefix)
}

func (s *exprScanner) matchKeyword(kw string) bool {
	if !s.hasPrefix(kw) {
		return false
	}
	after := s.pos + len(kw)
	if after < len(s.input) {
		r, _ := utf8.DecodeRuneInString(s.input[after:])
		if isXIDContinue(r) {
			return false
		}
	}
	s.pos = after
	return true
}

func (s *exprScanner) skipWhitespace() {
	for !s.isAtEnd() {
		r, w := s.peekRune()
		if !unicode.IsSpace(r) {
			break
		}
		s.pos += w
	}
}

// ParseExpressionTemplate parses an A2UI ${...} template string into literal strings,
// path bindings (map[string]any{"path": ...}), and function calls (map[string]any{"call": ..., "args": ..., "returnType": "any"}).
func ParseExpressionTemplate(input string) ([]any, error) {
	return parseExpressionTemplateAtDepth(input, 0)
}

func parseExpressionTemplateAtDepth(input string, depth int) ([]any, error) {
	if depth > MaxExpressionDepth {
		return nil, NewParseError("Max recursion depth reached in parse")
	}
	if len(input) > MaxExpressionTemplateLength {
		return nil, NewParseErrorf("Expression template length (%d) exceeds maximum limit (%d)", len(input), MaxExpressionTemplateLength)
	}
	if input == "" {
		return []any{}, nil
	}
	if !strings.Contains(input, "${") {
		return []any{input}, nil
	}

	var rawParts []any
	sc := &exprScanner{input: input}
	for !sc.isAtEnd() {
		if len(rawParts) >= MaxExpressionParts {
			return nil, NewParseErrorf("Expression parts count exceeds maximum limit (%d)", MaxExpressionParts)
		}
		if sc.hasPrefix("${") {
			sc.advanceBytes(2)
			content, err := extractInterpolationContent(sc)
			if err != nil {
				return nil, err
			}
			parsed, err := parseExpressionString(content, depth+1)
			if err != nil {
				return nil, err
			}
			if parsed != nil && parsed != "" {
				rawParts = append(rawParts, parsed)
			}
		} else if sc.hasPrefix(`\${`) {
			sc.advanceBytes(3)
			rawParts = append(rawParts, "${")
		} else {
			start := sc.pos
			for !sc.isAtEnd() && !sc.hasPrefix("${") && !sc.hasPrefix(`\${`) {
				sc.advanceRune()
			}
			lit := sc.input[start:sc.pos]
			if lit != "" {
				rawParts = append(rawParts, lit)
			}
		}
	}

	// Merge adjacent non-empty string literal runs so `\${literal}` yields `["${literal}"]` and `"a${null}b"` yields `["ab"]`.
	merged := make([]any, 0, len(rawParts))
	for _, p := range rawParts {
		if p == nil || p == "" {
			continue
		}
		if s, isStr := p.(string); isStr && len(merged) > 0 {
			if prevStr, prevIsStr := merged[len(merged)-1].(string); prevIsStr {
				merged[len(merged)-1] = prevStr + s
				continue
			}
		}
		merged = append(merged, p)
	}
	return merged, nil
}

func extractInterpolationContent(sc *exprScanner) (string, error) {
	start := sc.pos
	balance := 1
	for !sc.isAtEnd() && balance > 0 {
		r := sc.advanceRune()
		switch r {
		case '{':
			balance++
		case '}':
			balance--
		case '\'', '"':
			quote := r
			for !sc.isAtEnd() {
				c := sc.advanceRune()
				if c == '\\' {
					if !sc.isAtEnd() {
						sc.advanceRune()
					}
				} else if c == quote {
					break
				}
			}
		}
	}
	if balance > 0 {
		return "", NewParseError("Unclosed interpolation: missing '}'")
	}
	return sc.input[start : sc.pos-1], nil
}

func parseExpressionString(expr string, depth int) (any, error) {
	if depth > MaxExpressionDepth {
		return nil, NewParseError("Max recursion depth reached in parse")
	}
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return "", nil
	}
	sc := &exprScanner{input: trimmed}
	res, err := parseExpressionInternal(sc, depth)
	if err != nil {
		return nil, err
	}
	sc.skipWhitespace()
	if !sc.isAtEnd() {
		return nil, NewParseErrorf("Unexpected characters at end of expression: '%s'", sc.input[sc.pos:])
	}
	return res, nil
}

func parseExpressionInternal(sc *exprScanner, depth int) (any, error) {
	if depth > MaxExpressionDepth {
		return nil, NewParseError("Max recursion depth reached in parse")
	}
	sc.skipWhitespace()
	if sc.isAtEnd() {
		return "", nil
	}

	if sc.hasPrefix("${") {
		sc.advanceBytes(2)
		content, err := extractInterpolationContent(sc)
		if err != nil {
			return nil, err
		}
		return parseExpressionString(content, depth+1)
	}

	b0 := sc.peekByte(0)
	if b0 == '\'' || b0 == '"' {
		return parseExprStringLiteral(sc), nil
	}
	if isExprNumberStart(sc) {
		return parseExprNumberLiteral(sc)
	}
	if sc.matchKeyword("true") {
		return true, nil
	}
	if sc.matchKeyword("false") {
		return false, nil
	}
	if sc.matchKeyword("null") {
		return "", nil
	}

	token, err := scanPathOrIdentifier(sc)
	if err != nil {
		return nil, err
	}
	sc.skipWhitespace()
	if sc.peekByte(0) == '(' {
		return parseExprFunctionCall(token, sc, depth)
	}
	if strings.HasPrefix(token, "@") {
		return nil, NewParseErrorf("Expected '(' after function name '%s'", token)
	}
	if token == "" {
		return "", nil
	}
	return map[string]any{"path": token}, nil
}

func isSystemFnStart(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || b == '_'
}

func isSystemFnContinue(b byte) bool {
	return isSystemFnStart(b) || (b >= '0' && b <= '9')
}

func scanPathOrIdentifier(sc *exprScanner) (string, error) {
	start := sc.pos
	if sc.peekByte(0) == '@' {
		if !isSystemFnStart(sc.peekByte(1)) {
			return "", NewParseError("Invalid identifier starting with '@' in expression")
		}
		sc.advanceBytes(1)
		for !sc.isAtEnd() && isSystemFnContinue(sc.peekByte(0)) {
			sc.advanceBytes(1)
		}
		return sc.input[start:sc.pos], nil
	}
	for !sc.isAtEnd() {
		r, w := sc.peekRune()
		if isXIDContinue(r) || r == '/' || r == '.' || r == '-' {
			sc.pos += w
		} else {
			break
		}
	}
	return sc.input[start:sc.pos], nil
}

func scanExprIdentifier(sc *exprScanner) string {
	start := sc.pos
	for !sc.isAtEnd() {
		r, w := sc.peekRune()
		if isXIDContinue(r) {
			sc.pos += w
		} else {
			break
		}
	}
	return sc.input[start:sc.pos]
}

func parseExprFunctionCall(funcName string, sc *exprScanner, depth int) (map[string]any, error) {
	sc.matchByte('(')
	sc.skipWhitespace()
	args := map[string]any{}
	for !sc.isAtEnd() && sc.peekByte(0) != ')' {
		argName := scanExprIdentifier(sc)
		sc.skipWhitespace()
		if !sc.matchByte(':') {
			return nil, NewParseErrorf("Expected ':' after argument name '%s' in function '%s'", argName, funcName)
		}
		sc.skipWhitespace()
		val, err := parseExpressionInternal(sc, depth+1)
		if err != nil {
			return nil, err
		}
		args[argName] = val
		sc.skipWhitespace()
		if sc.peekByte(0) == ',' {
			sc.advanceBytes(1)
			sc.skipWhitespace()
		}
	}
	if !sc.matchByte(')') {
		return nil, NewParseErrorf("Expected ')' after function arguments for '%s'", funcName)
	}
	return map[string]any{
		"call":       funcName,
		"args":       args,
		"returnType": "any",
	}, nil
}

func parseExprStringLiteral(sc *exprScanner) string {
	quote := sc.advanceRune()
	var b strings.Builder
	for !sc.isAtEnd() {
		c := sc.advanceRune()
		if c == '\\' {
			if sc.isAtEnd() {
				break
			}
			next := sc.advanceRune()
			switch next {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			default:
				b.WriteRune(next)
			}
		} else if c == quote {
			break
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func isASCIIDigitByte(b byte) bool {
	return b >= '0' && b <= '9'
}

func isExprNumberStart(sc *exprScanner) bool {
	offset := 0
	if b := sc.peekByte(0); b == '-' || b == '+' {
		offset = 1
	}
	if isASCIIDigitByte(sc.peekByte(offset)) {
		return true
	}
	return sc.peekByte(offset) == '.' && isASCIIDigitByte(sc.peekByte(offset+1))
}

func parseExprNumberLiteral(sc *exprScanner) (any, error) {
	start := sc.pos
	if b := sc.peekByte(0); b == '-' || b == '+' {
		sc.advanceBytes(1)
	}
	for !sc.isAtEnd() && (isASCIIDigitByte(sc.peekByte(0)) || sc.peekByte(0) == '.') {
		sc.advanceBytes(1)
	}
	if !sc.isAtEnd() && (sc.peekByte(0) == 'e' || sc.peekByte(0) == 'E') {
		sc.advanceBytes(1)
		if !sc.isAtEnd() && (sc.peekByte(0) == '+' || sc.peekByte(0) == '-') {
			sc.advanceBytes(1)
		}
		for !sc.isAtEnd() && isASCIIDigitByte(sc.peekByte(0)) {
			sc.advanceBytes(1)
		}
	}
	numStr := sc.input[start:sc.pos]
	if !numberLiteralRe.MatchString(numStr) {
		return nil, NewParseErrorf("Invalid number literal: '%s'", numStr)
	}
	f, err := strconv.ParseFloat(numStr, 64)
	if math.IsInf(f, 0) || math.IsNaN(f) || (err != nil && f != 0) {
		return nil, NewParseErrorf("Number literal is out of range: '%s'", numStr)
	}
	if f == 0 {
		f = 0 // clear -0.0
	}
	if !strings.ContainsAny(numStr, ".eE") {
		digits := strings.TrimLeft(strings.TrimLeft(numStr, "+-"), "0")
		if digits == "" {
			return int64(0), nil
		}
		signed := digits
		if strings.HasPrefix(numStr, "-") {
			signed = "-" + digits
		}
		if iv, errInt := strconv.ParseInt(signed, 10, 64); errInt == nil {
			return iv, nil
		}
	}
	return f, nil
}
