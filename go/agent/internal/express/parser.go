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
	"math"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
)

// ParseNumberLiteral converts an Express NUMBER token into an int64 (for integer text)
// or float64, rejecting literals whose IEEE-754 double value is non-finite.
func ParseNumberLiteral(text string, line, col int) (any, error) {
	val, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(val, 0) || math.IsNaN(val) {
		return nil, NewParseError(fmt.Sprintf("Number literal %s is out of range.", text), line, col, "")
	}
	if strings.ContainsAny(text, ".eE") {
		return val, nil
	}
	negative := strings.HasPrefix(text, "-")
	digits := strings.TrimLeft(strings.TrimLeft(text, "+-"), "0")
	if digits == "" {
		return int64(0), nil
	}
	signed := digits
	if negative {
		signed = "-" + digits
	}
	if iv, iErr := strconv.ParseInt(signed, 10, 64); iErr == nil {
		return iv, nil
	}
	return val, nil
}

func unescapeString(val string) string {
	var b strings.Builder
	b.Grow(len(val))
	for i := 0; i < len(val); i++ {
		if val[i] == '\\' && i+1 < len(val) {
			i++
			switch val[i] {
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			case '\\':
				b.WriteByte('\\')
			case '"':
				b.WriteByte('"')
			default:
				b.WriteByte('\\')
				b.WriteByte(val[i])
			}
			continue
		}
		b.WriteByte(val[i])
	}
	return b.String()
}

func decodeStringToken(tok token) string {
	val := tok.text
	switch tok.kind {
	case tokRawTripleString:
		return val[4 : len(val)-3]
	case tokRawString:
		return val[2 : len(val)-1]
	case tokTripleString:
		return unescapeString(val[3 : len(val)-3])
	case tokStandardString:
		inner := strings.Trim(val[1:len(val)-1], "\r\n")
		return unescapeString(inner)
	default:
		return val
	}
}

type expressParser struct {
	tokens []token
	pos    int
}

func (p *expressParser) peek(offset int) token {
	idx := p.pos + offset
	if idx >= len(p.tokens) {
		return p.tokens[len(p.tokens)-1]
	}
	return p.tokens[idx]
}

func (p *expressParser) next() token {
	tok := p.peek(0)
	if p.pos < len(p.tokens)-1 {
		p.pos++
	}
	return tok
}

func (p *expressParser) expect(kind tokenKind, desc string) (token, *syntaxDiag) {
	tok := p.peek(0)
	if tok.kind != kind {
		return tok, &syntaxDiag{
			line: tok.line,
			col:  tok.col,
			msg:  fmt.Sprintf("expected %s, got %q", desc, tok.text),
		}
	}
	return p.next(), nil
}

// ParseStatements strips optional sentinel tags (when stripSentinels is true), normalizes
// source text, and parses Express statements. When isFinal is false, statements preceding
// the first syntax error line are returned for partial/streaming compilation.
func ParseStatements(dslText string, isFinal bool, stripSentinels bool) ([]Statement, error) {
	rawBody := dslText
	if stripSentinels {
		rawBody = StripSentinelTags(dslText)
	}
	dslBody := NormalizeSource(rawBody)

	tokens, lexDiags := lexExpress(dslBody)
	firstErrLine := 0
	var firstDiag *syntaxDiag
	if len(lexDiags) > 0 {
		firstDiag = &lexDiags[0]
		firstErrLine = lexDiags[0].line
	}

	p := &expressParser{tokens: tokens}
	var statements []Statement

	for p.peek(0).kind != tokEOF {
		stmtLine := p.peek(0).line
		if firstErrLine > 0 && stmtLine >= firstErrLine {
			break
		}
		stmt, parseDiag, fatalErr := p.parseStatement()
		if fatalErr != nil {
			if !isFinal {
				return nil, nil
			}
			return nil, fatalErr
		}
		if parseDiag != nil {
			if firstDiag == nil || parseDiag.line < firstDiag.line {
				firstDiag = parseDiag
			}
			break
		}
		// If a lexer error occurred on the same line inside this statement, discard it.
		if firstErrLine > 0 && p.prevLine() >= firstErrLine {
			break
		}
		statements = append(statements, stmt)
	}

	if isFinal && firstDiag != nil {
		msg := fmt.Sprintf("Syntax error at line %d:%d: %s", firstDiag.line, firstDiag.col, firstDiag.msg)
		if !firstDiag.isLexer {
			msg = fmt.Sprintf("Failed to parse expression: Syntax error at line %d:%d: %s", firstDiag.line, firstDiag.col, firstDiag.msg)
		}
		return nil, NewParseError(msg, firstDiag.line, firstDiag.col, "Please correct the syntax error in your Express DSL.")
	}

	return statements, nil
}

func (p *expressParser) prevLine() int {
	if p.pos == 0 {
		return 1
	}
	return p.tokens[p.pos-1].line
}

func (p *expressParser) parseStatement() (Statement, *syntaxDiag, error) {
	t0 := p.peek(0)
	t1 := p.peek(1)
	if (t0.kind == tokIdentifier || t0.kind == tokPath) && t1.kind == tokEquals {
		targetTok := p.next()
		p.next() // '='
		val, diag, err := p.parseExpression()
		if diag != nil || err != nil {
			return Statement{}, diag, err
		}
		return Statement{
			Kind:   StmtAssign,
			Target: targetTok.text,
			Value:  val,
			Line:   t0.line,
		}, nil, nil
	}

	val, diag, err := p.parseExpression()
	if diag != nil || err != nil {
		return Statement{}, diag, err
	}
	return Statement{
		Kind:  StmtExpr,
		Value: val,
		Line:  t0.line,
	}, nil, nil
}

func (p *expressParser) parseExpression() (any, *syntaxDiag, error) {
	tok := p.peek(0)
	switch tok.kind {
	case tokLBracket:
		return p.parseArray()
	case tokLBrace:
		return p.parseMap()
	case tokPath:
		p.next()
		return PathNode{Path: tok.text[1:]}, nil, nil
	case tokCheck:
		return p.parseCheck()
	case tokIdentifier, tokSystemIdentifier:
		if p.peek(1).kind == tokLParen {
			return p.parseCall()
		}
		if tok.kind == tokSystemIdentifier {
			return nil, &syntaxDiag{
				line: tok.line,
				col:  tok.col,
				msg:  fmt.Sprintf("system identifier %q must be called as a function", tok.text),
			}, nil
		}
		p.next()
		return VariableNode{Name: tok.text}, nil, nil
	case tokUnderscore:
		p.next()
		return SkippedNode{}, nil, nil
	case tokRawTripleString, tokTripleString, tokRawString, tokStandardString:
		p.next()
		return decodeStringToken(tok), nil, nil
	case tokNumber:
		p.next()
		num, err := ParseNumberLiteral(tok.text, tok.line, tok.col)
		if err != nil {
			return nil, nil, err
		}
		return num, nil, nil
	case tokBoolean:
		p.next()
		return tok.text == "true", nil, nil
	case tokNull:
		p.next()
		return nil, nil, nil
	default:
		return nil, &syntaxDiag{
			line: tok.line,
			col:  tok.col,
			msg:  fmt.Sprintf("unexpected token %q", tok.text),
		}, nil
	}
}

func (p *expressParser) parseArray() ([]any, *syntaxDiag, error) {
	p.next() // '['
	items := make([]any, 0)
	if p.peek(0).kind == tokRBracket {
		p.next()
		return items, nil, nil
	}
	for {
		item, diag, err := p.parseExpression()
		if diag != nil || err != nil {
			return nil, diag, err
		}
		items = append(items, item)
		if p.peek(0).kind == tokComma {
			p.next()
			if p.peek(0).kind == tokRBracket {
				p.next()
				return items, nil, nil
			}
			continue
		}
		if _, diag := p.expect(tokRBracket, "']'"); diag != nil {
			return nil, diag, nil
		}
		return items, nil, nil
	}
}

func (p *expressParser) parseMap() (map[string]any, *syntaxDiag, error) {
	p.next() // '{'
	res := make(map[string]any)
	var keys []string
	seen := make(map[string]bool)
	if p.peek(0).kind == tokRBrace {
		p.next()
		schemahelper.SetMapKeyOrder(res, keys)
		return res, nil, nil
	}
	for {
		keyTok := p.peek(0)
		var key string
		switch keyTok.kind {
		case tokIdentifier:
			p.next()
			key = keyTok.text
		case tokRawTripleString, tokTripleString, tokRawString, tokStandardString:
			p.next()
			key = decodeStringToken(keyTok)
		default:
			return nil, &syntaxDiag{
				line: keyTok.line,
				col:  keyTok.col,
				msg:  fmt.Sprintf("expected map key identifier or string, got %q", keyTok.text),
			}, nil
		}
		if _, diag := p.expect(tokColon, "':'"); diag != nil {
			return nil, diag, nil
		}
		val, diag, err := p.parseExpression()
		if diag != nil || err != nil {
			return nil, diag, err
		}
		res[key] = val
		if !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
		if p.peek(0).kind == tokComma {
			p.next()
			if p.peek(0).kind == tokRBrace {
				p.next()
				schemahelper.SetMapKeyOrder(res, keys)
				return res, nil, nil
			}
			continue
		}
		if _, diag := p.expect(tokRBrace, "'}'"); diag != nil {
			return nil, diag, nil
		}
		schemahelper.SetMapKeyOrder(res, keys)
		return res, nil, nil
	}
}

func (p *expressParser) parseCheck() (CheckNode, *syntaxDiag, error) {
	chkTok := p.next() // CHECK
	name := chkTok.text[1:]
	args := make([]any, 0)
	if p.peek(0).kind != tokLParen {
		return CheckNode{Name: name, Args: args}, nil, nil
	}
	p.next() // '('
	if p.peek(0).kind == tokRParen {
		p.next()
		return CheckNode{Name: name, Args: args}, nil, nil
	}
	for {
		arg, diag, err := p.parseExpression()
		if diag != nil || err != nil {
			return CheckNode{}, diag, err
		}
		args = append(args, arg)
		if p.peek(0).kind == tokComma {
			p.next()
			if p.peek(0).kind == tokRParen {
				p.next()
				return CheckNode{Name: name, Args: args}, nil, nil
			}
			continue
		}
		if _, diag := p.expect(tokRParen, "')'"); diag != nil {
			return CheckNode{}, diag, nil
		}
		return CheckNode{Name: name, Args: args}, nil, nil
	}
}

func (p *expressParser) parseCall() (*CallNode, *syntaxDiag, error) {
	fnTok := p.next()
	p.next() // '('
	node := &CallNode{
		Name:   fnTok.text,
		Args:   make([]any, 0),
		Kwargs: make([]NamedArg, 0),
	}
	if p.peek(0).kind == tokRParen {
		p.next()
		return node, nil, nil
	}
	for {
		if p.peek(0).kind == tokIdentifier && p.peek(1).kind == tokEquals {
			kwTok := p.next()
			p.next() // '='
			val, diag, err := p.parseExpression()
			if diag != nil || err != nil {
				return nil, diag, err
			}
			// Match Python visitor: later same-named kwargs overwrite earlier ones in CallNode,
			// wait — keeping unique last-wins or checking duplicates? Let's check: in Python
			// `kwargs[key] = value` is a dict, while positional+kwarg triggers DuplicatePropertyError.
			replaced := false
			for idx := range node.Kwargs {
				if node.Kwargs[idx].Name == kwTok.text {
					node.Kwargs[idx].Value = val
					replaced = true
					break
				}
			}
			if !replaced {
				node.Kwargs = append(node.Kwargs, NamedArg{Name: kwTok.text, Value: val})
			}
		} else {
			val, diag, err := p.parseExpression()
			if diag != nil || err != nil {
				return nil, diag, err
			}
			node.Args = append(node.Args, val)
		}

		if p.peek(0).kind == tokComma {
			p.next()
			if p.peek(0).kind == tokRParen {
				p.next()
				return node, nil, nil
			}
			continue
		}
		if _, diag := p.expect(tokRParen, "')'"); diag != nil {
			return nil, diag, nil
		}
		return node, nil, nil
	}
}
