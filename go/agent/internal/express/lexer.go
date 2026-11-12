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
	"fmt"
	"unicode"
	"unicode/utf8"
)

type tokenKind int

const (
	tokEOF tokenKind = iota
	tokIdentifier
	tokSystemIdentifier
	tokPath
	tokCheck
	tokRawTripleString
	tokTripleString
	tokRawString
	tokStandardString
	tokNumber
	tokBoolean
	tokNull
	tokUnderscore
	tokLParen
	tokRParen
	tokLBracket
	tokRBracket
	tokLBrace
	tokRBrace
	tokEquals
	tokComma
	tokColon
)

type token struct {
	kind tokenKind
	text string
	line int
	col  int
}

type syntaxDiag struct {
	line    int
	col     int
	msg     string
	isLexer bool
}

func isXIDStartOrUnderscore(r rune) bool {
	if r == '_' {
		return true
	}
	if unicode.In(r, unicode.Pattern_Syntax, unicode.Pattern_White_Space) {
		return false
	}
	return unicode.In(r, unicode.L, unicode.Nl, unicode.Other_ID_Start)
}

func isXIDContinue(r rune) bool {
	if r == '_' {
		return true
	}
	if unicode.In(r, unicode.Pattern_Syntax, unicode.Pattern_White_Space) {
		return false
	}
	return unicode.In(
		r,
		unicode.L,
		unicode.Nl,
		unicode.Nd,
		unicode.Mn,
		unicode.Mc,
		unicode.Pc,
		unicode.Other_ID_Start,
		unicode.Other_ID_Continue,
	)
}

func isASCIIPathChar(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_' || b == '/'
}

func isASCIIDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

// lexExpress tokenizes normalized Express source according to Express.g4.
// Rather than halting on the first error, it records syntaxDiag entries and advances
// so partial statement recovery (isFinal=false) knows the exact first error line.
func lexExpress(src string) ([]token, []syntaxDiag) {
	var tokens []token
	var diags []syntaxDiag

	i := 0
	n := len(src)
	line := 1
	col := 0

	advanceByte := func() {
		if src[i] == '\n' {
			line++
			col = 0
		} else {
			col++
		}
		i++
	}

	advanceRune := func() rune {
		r, width := utf8.DecodeRuneInString(src[i:])
		if r == '\n' {
			line++
			col = 0
		} else {
			col++
		}
		i += width
		return r
	}

	advanceCount := func(end int) {
		for i < end {
			advanceRune()
		}
	}

	for i < n {
		ch := src[i]

		// Skipped whitespace and semicolons.
		if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' || ch == ';' {
			advanceByte()
			continue
		}

		// Skipped single-line comments: '#' or '//'
		if ch == '#' || (ch == '/' && i+1 < n && src[i+1] == '/') {
			for i < n && src[i] != '\r' && src[i] != '\n' {
				advanceRune()
			}
			continue
		}

		// Skipped block comments: '/*' ... '*/'
		if ch == '/' && i+1 < n && src[i+1] == '*' {
			startLine, startCol := line, col
			advanceByte()
			advanceByte()
			closed := false
			for i < n {
				if src[i] == '*' && i+1 < n && src[i+1] == '/' {
					advanceByte()
					advanceByte()
					closed = true
					break
				}
				advanceRune()
			}
			if !closed {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "unterminated block comment",
					isLexer: true,
				})
			}
			continue
		}

		startPos := i
		startLine, startCol := line, col

		// Raw strings: [rR] '"""' .*? '"""' or [rR] '"' ~[\r\n"]* '"'
		if (ch == 'r' || ch == 'R') && i+1 < n && src[i+1] == '"' {
			if i+3 < n && src[i+1:i+4] == `"""` {
				advanceCount(i + 4)
				closed := false
				for i < n {
					if i+2 < n && src[i:i+3] == `"""` {
						advanceCount(i + 3)
						closed = true
						break
					}
					advanceRune()
				}
				if !closed {
					diags = append(diags, syntaxDiag{
						line:    startLine,
						col:     startCol,
						msg:     "unterminated raw triple-quoted string",
						isLexer: true,
					})
					break
				}
				tokens = append(tokens, token{
					kind: tokRawTripleString,
					text: src[startPos:i],
					line: startLine,
					col:  startCol,
				})
				continue
			}

			advanceByte() // r/R
			advanceByte() // "
			closed := false
			for i < n && src[i] != '\r' && src[i] != '\n' {
				if src[i] == '"' {
					advanceByte()
					closed = true
					break
				}
				advanceRune()
			}
			if !closed {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "unterminated raw string literal",
					isLexer: true,
				})
				continue
			}
			tokens = append(tokens, token{
				kind: tokRawString,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// Standard triple or single-quoted strings.
		if ch == '"' {
			if i+2 < n && src[i:i+3] == `"""` {
				advanceCount(i + 3)
				closed := false
				for i < n {
					if src[i] == '\\' {
						advanceByte()
						if i >= n {
							break
						}
						advanceRune()
						continue
					}
					if i+2 < n && src[i:i+3] == `"""` {
						advanceCount(i + 3)
						closed = true
						break
					}
					advanceRune()
				}
				if !closed {
					diags = append(diags, syntaxDiag{
						line:    startLine,
						col:     startCol,
						msg:     "unterminated triple-quoted string",
						isLexer: true,
					})
					break
				}
				tokens = append(tokens, token{
					kind: tokTripleString,
					text: src[startPos:i],
					line: startLine,
					col:  startCol,
				})
				continue
			}

			advanceByte() // "
			closed := false
			for i < n {
				if src[i] == '\\' {
					advanceByte()
					if i >= n {
						break
					}
					advanceRune()
					continue
				}
				if src[i] == '"' {
					advanceByte()
					closed = true
					break
				}
				advanceRune()
			}
			if !closed {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "unterminated string literal",
					isLexer: true,
				})
				break
			}
			tokens = append(tokens, token{
				kind: tokStandardString,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// PATH : '$' [a-zA-Z0-9_/]*
		if ch == '$' {
			advanceByte()
			for i < n && isASCIIPathChar(src[i]) {
				advanceByte()
			}
			tokens = append(tokens, token{
				kind: tokPath,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// CHECK : '?' [\p{XID_Start}_] [\p{XID_Continue}]*
		if ch == '?' {
			advanceByte()
			if i >= n {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "token recognition error at: '?'",
					isLexer: true,
				})
				continue
			}
			r, _ := utf8.DecodeRuneInString(src[i:])
			if !isXIDStartOrUnderscore(r) {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "token recognition error at: '?'",
					isLexer: true,
				})
				continue
			}
			advanceRune()
			for i < n {
				r, _ = utf8.DecodeRuneInString(src[i:])
				if !isXIDContinue(r) {
					break
				}
				advanceRune()
			}
			tokens = append(tokens, token{
				kind: tokCheck,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// SYSTEM_IDENTIFIER : '@' [\p{XID_Start}_] [\p{XID_Continue}]*
		if ch == '@' {
			advanceByte()
			if i >= n {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "token recognition error at: '@'",
					isLexer: true,
				})
				continue
			}
			r, _ := utf8.DecodeRuneInString(src[i:])
			if !isXIDStartOrUnderscore(r) {
				diags = append(diags, syntaxDiag{
					line:    startLine,
					col:     startCol,
					msg:     "token recognition error at: '@'",
					isLexer: true,
				})
				continue
			}
			advanceRune()
			for i < n {
				r, _ = utf8.DecodeRuneInString(src[i:])
				if !isXIDContinue(r) {
					break
				}
				advanceRune()
			}
			tokens = append(tokens, token{
				kind: tokSystemIdentifier,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// NUMBER : [+-]? ([0-9]+ ('.' [0-9]*)? | '.' [0-9]+) ([eE] [+-]? [0-9]+)?
		if numEnd := matchNumberEnd(src, i); numEnd > i {
			advanceCount(numEnd)
			tokens = append(tokens, token{
				kind: tokNumber,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// Punctuation
		var punctKind tokenKind
		switch ch {
		case '(':
			punctKind = tokLParen
		case ')':
			punctKind = tokRParen
		case '[':
			punctKind = tokLBracket
		case ']':
			punctKind = tokRBracket
		case '{':
			punctKind = tokLBrace
		case '}':
			punctKind = tokRBrace
		case '=':
			punctKind = tokEquals
		case ',':
			punctKind = tokComma
		case ':':
			punctKind = tokColon
		}
		if punctKind != tokEOF {
			advanceByte()
			tokens = append(tokens, token{
				kind: punctKind,
				text: src[startPos:i],
				line: startLine,
				col:  startCol,
			})
			continue
		}

		// IDENTIFIER / BOOLEAN / 'null' / '_'
		r, _ := utf8.DecodeRuneInString(src[i:])
		if isXIDStartOrUnderscore(r) {
			advanceRune()
			for i < n {
				nr, _ := utf8.DecodeRuneInString(src[i:])
				if !isXIDContinue(nr) {
					break
				}
				advanceRune()
			}
			word := src[startPos:i]
			kind := tokIdentifier
			switch word {
			case "true", "false":
				kind = tokBoolean
			case "null":
				kind = tokNull
			case "_":
				kind = tokUnderscore
			}
			tokens = append(tokens, token{
				kind: kind,
				text: word,
				line: startLine,
				col:  startCol,
			})
			continue
		}

		badRune := advanceRune()
		diags = append(diags, syntaxDiag{
			line:    startLine,
			col:     startCol,
			msg:     fmt.Sprintf("token recognition error at: %q", string(badRune)),
			isLexer: true,
		})
	}

	tokens = append(tokens, token{
		kind: tokEOF,
		text: "",
		line: line,
		col:  col,
	})
	return tokens, diags
}

func matchNumberEnd(src string, start int) int {
	n := len(src)
	p := start
	if p < n && (src[p] == '+' || src[p] == '-') {
		p++
	}
	if p >= n {
		return start
	}
	if isASCIIDigit(src[p]) {
		for p < n && isASCIIDigit(src[p]) {
			p++
		}
		if p < n && src[p] == '.' {
			p++
			for p < n && isASCIIDigit(src[p]) {
				p++
			}
		}
	} else if src[p] == '.' && p+1 < n && isASCIIDigit(src[p+1]) {
		p++
		for p < n && isASCIIDigit(src[p]) {
			p++
		}
	} else {
		return start
	}

	// Optional exponent ([eE] [+-]? [0-9]+)? — only consumed if digits follow!
	if p < n && (src[p] == 'e' || src[p] == 'E') {
		ep := p + 1
		if ep < n && (src[ep] == '+' || src[ep] == '-') {
			ep++
		}
		if ep < n && isASCIIDigit(src[ep]) {
			for ep < n && isASCIIDigit(src[ep]) {
				ep++
			}
			p = ep
		}
	}
	return p
}
