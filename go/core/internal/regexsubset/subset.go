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

// Package regexsubset implements the portable A2UI ECMAScript regular expression subset,
// static ReDoS safety analyzer, and linear-time Unicode scalar matcher.
package regexsubset

import (
	"fmt"
	"sort"
	"sync"
	"unicode/utf8"
)

const (
	// MaxPatternCodePoints is the maximum allowed length of an A2UI regex pattern in Unicode code points.
	MaxPatternCodePoints = 256
	// MaxValueCodePoints is the maximum input length evaluated by RegexTest in Unicode code points.
	MaxValueCodePoints = 4096
	maxQuantifierBound = 65535

	surrogateStart = 0xD800
	surrogateEnd   = 0xDFFF
	maxCodePoint   = 0x10FFFF
)

// RejectionReason identifies why an A2UI regex pattern was rejected.
type RejectionReason string

const (
	RejectUnsupportedSyntax      RejectionReason = "UNSUPPORTED_SYNTAX"
	RejectPatternTooLong         RejectionReason = "PATTERN_TOO_LONG"
	RejectNestedQuantifier       RejectionReason = "NESTED_QUANTIFIER"
	RejectOverlappingAlternation RejectionReason = "OVERLAPPING_ALTERNATION"
	RejectAdjacentOverlap        RejectionReason = "ADJACENT_OVERLAP"
)

// AnchorKind identifies a zero-width boundary assertion.
type AnchorKind string

const (
	AnchorStart           AnchorKind = "start"
	AnchorEnd             AnchorKind = "end"
	AnchorWordBoundary    AnchorKind = "wordBoundary"
	AnchorNotWordBoundary AnchorKind = "notWordBoundary"
)

// CodePointRange is an inclusive Unicode scalar interval [Start, End].
type CodePointRange struct {
	Start rune
	End   rune
}

// Node represents an AST node in the parsed A2UI regex subset.
type Node interface {
	isRegexNode()
}

// EmptyNode matches the empty string.
type EmptyNode struct{}

func (EmptyNode) isRegexNode() {}

// CharSetNode matches one Unicode scalar value within sorted, disjoint Ranges.
type CharSetNode struct {
	Ranges []CodePointRange
}

func (CharSetNode) isRegexNode() {}

// GroupNode represents a capturing or non-capturing group.
type GroupNode struct {
	Capturing bool
	Child     Node
}

func (GroupNode) isRegexNode() {}

// LookaheadNode represents a positive (?=...) or negative (?!...) lookahead assertion.
type LookaheadNode struct {
	Negated bool
	Child   Node
}

func (LookaheadNode) isRegexNode() {}

// AnchorNode represents ^, $, \b, or \B.
type AnchorNode struct {
	Anchor AnchorKind
}

func (AnchorNode) isRegexNode() {}

// ConcatNode represents a sequence of concatenated nodes.
type ConcatNode struct {
	Items []Node
}

func (ConcatNode) isRegexNode() {}

// AltNode represents a disjunction of alternative branches.
type AltNode struct {
	Branches []Node
}

func (AltNode) isRegexNode() {}

// RepeatNode represents a quantified node (*, +, ?, {m}, {m,}, {m,n}).
type RepeatNode struct {
	Child Node
	Min   int
	Max   *int // nil means unbounded
	Lazy  bool
}

func (RepeatNode) isRegexNode() {}

// AnalysisResult holds the outcome of parsing and safety-checking a pattern.
type AnalysisResult struct {
	OK     bool
	Tree   Node
	Reason RejectionReason
	Detail string
}

var (
	digitRanges = []CodePointRange{{0x30, 0x39}}
	wordRanges  = []CodePointRange{
		{0x30, 0x39},
		{0x41, 0x5A},
		{0x5F, 0x5F},
		{0x61, 0x7A},
	}
	spaceRanges = []CodePointRange{
		{0x09, 0x0D},
		{0x20, 0x20},
		{0xA0, 0xA0},
		{0x1680, 0x1680},
		{0x2000, 0x200A},
		{0x2028, 0x2029},
		{0x202F, 0x202F},
		{0x205F, 0x205F},
		{0x3000, 0x3000},
		{0xFEFF, 0xFEFF},
	}
	lineTerminatorRanges = []CodePointRange{
		{0x0A, 0x0A},
		{0x0D, 0x0D},
		{0x2028, 0x2029},
	}

	notDigitRanges = complementRanges(digitRanges)
	notWordRanges  = complementRanges(wordRanges)
	notSpaceRanges = complementRanges(spaceRanges)
	dotRanges      = complementRanges(lineTerminatorRanges)

	syntaxChars = map[rune]bool{
		'^': true, '$': true, '\\': true, '.': true, '*': true,
		'+': true, '?': true, '(': true, ')': true, '[': true,
		']': true, '{': true, '}': true, '|': true, '/': true,
	}

	controlEscapes = map[rune]rune{
		't': 0x09,
		'n': 0x0A,
		'v': 0x0B,
		'f': 0x0C,
		'r': 0x0D,
	}

	classEscapes = map[rune][]CodePointRange{
		'd': digitRanges,
		'D': notDigitRanges,
		'w': wordRanges,
		'W': notWordRanges,
		's': spaceRanges,
		'S': notSpaceRanges,
	}
)

func excludeSurrogates(r CodePointRange) []CodePointRange {
	if r.Start > r.End {
		return nil
	}
	if r.End < surrogateStart || r.Start > surrogateEnd {
		return []CodePointRange{r}
	}
	var out []CodePointRange
	if r.Start < surrogateStart {
		out = append(out, CodePointRange{r.Start, surrogateStart - 1})
	}
	if r.End > surrogateEnd {
		out = append(out, CodePointRange{surrogateEnd + 1, r.End})
	}
	return out
}

func normalizeRanges(ranges []CodePointRange) []CodePointRange {
	var split []CodePointRange
	for _, r := range ranges {
		split = append(split, excludeSurrogates(r)...)
	}
	if len(split) <= 1 {
		return split
	}
	sort.Slice(split, func(i, j int) bool {
		if split[i].Start != split[j].Start {
			return split[i].Start < split[j].Start
		}
		return split[i].End < split[j].End
	})
	merged := []CodePointRange{split[0]}
	for _, curr := range split[1:] {
		prev := &merged[len(merged)-1]
		if curr.Start <= prev.End+1 {
			if curr.End > prev.End {
				prev.End = curr.End
			}
		} else {
			merged = append(merged, curr)
		}
	}
	return merged
}

func complementRanges(ranges []CodePointRange) []CodePointRange {
	withSurrogates := make([]CodePointRange, 0, len(ranges)+1)
	withSurrogates = append(withSurrogates, ranges...)
	withSurrogates = append(withSurrogates, CodePointRange{surrogateStart, surrogateEnd})
	excluded := normalizeRanges(withSurrogates)
	var out []CodePointRange
	var cursor rune
	for _, r := range excluded {
		if r.Start > cursor {
			out = append(out, excludeSurrogates(CodePointRange{cursor, r.Start - 1})...)
		}
		cursor = r.End + 1
	}
	if cursor <= maxCodePoint {
		out = append(out, excludeSurrogates(CodePointRange{cursor, maxCodePoint})...)
	}
	return out
}

func rangesOverlap(a, b []CodePointRange) bool {
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		if a[i].End < b[j].Start {
			i++
		} else if b[j].End < a[i].Start {
			j++
		} else {
			return true
		}
	}
	return false
}

func rangeContains(ranges []CodePointRange, cp rune) bool {
	lo, hi := 0, len(ranges)-1
	for lo <= hi {
		mid := (lo + hi) / 2
		r := ranges[mid]
		if cp < r.Start {
			hi = mid - 1
		} else if cp > r.End {
			lo = mid + 1
		} else {
			return true
		}
	}
	return false
}

// CountCodePoints returns the number of Unicode code points in s.
func CountCodePoints(s string) int {
	return utf8.RuneCountInString(s)
}

func toCodePoints(s string) ([]rune, error) {
	if !utf8.ValidString(s) {
		return nil, fmt.Errorf("invalid UTF-8 sequence in pattern")
	}
	cps := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= surrogateStart && r <= surrogateEnd {
			return nil, fmt.Errorf("lone surrogate in pattern")
		}
		cps = append(cps, r)
	}
	return cps, nil
}

type scanner struct {
	cps []rune
	pos int
}

func (s *scanner) eof() bool {
	return s.pos >= len(s.cps)
}

func (s *scanner) peek(offset int) (rune, bool) {
	idx := s.pos + offset
	if idx < 0 || idx >= len(s.cps) {
		return 0, false
	}
	return s.cps[idx], true
}

func (s *scanner) next() (rune, error) {
	if s.pos >= len(s.cps) {
		return 0, fmt.Errorf("unexpected end of pattern")
	}
	cp := s.cps[s.pos]
	s.pos++
	return cp, nil
}

func (s *scanner) eat(expected rune) bool {
	if s.pos < len(s.cps) && s.cps[s.pos] == expected {
		s.pos++
		return true
	}
	return false
}

func isASCIIDigit(cp rune, ok bool) bool {
	return ok && cp >= '0' && cp <= '9'
}

func hexValue(cp rune, ok bool) int {
	if !ok {
		return -1
	}
	switch {
	case cp >= '0' && cp <= '9':
		return int(cp - '0')
	case cp >= 'A' && cp <= 'F':
		return int(cp-'A') + 10
	case cp >= 'a' && cp <= 'f':
		return int(cp-'a') + 10
	default:
		return -1
	}
}

func parseFixedHex(s *scanner, digits int) (rune, error) {
	var val rune
	for i := 0; i < digits; i++ {
		cp, ok := s.peek(0)
		hv := hexValue(cp, ok)
		if hv < 0 {
			return 0, fmt.Errorf("invalid hexadecimal escape")
		}
		_, _ = s.next()
		val = (val << 4) | rune(hv)
	}
	return val, nil
}

func rejectIfSurrogate(cp rune) (rune, error) {
	if cp >= surrogateStart && cp <= surrogateEnd {
		return 0, fmt.Errorf("surrogate code point escape is not supported")
	}
	return cp, nil
}

func parseBracedHex(s *scanner) (rune, error) {
	var val int64
	count := 0
	for !s.eof() {
		cp, ok := s.peek(0)
		if ok && cp == '}' {
			break
		}
		hv := hexValue(cp, ok)
		if hv < 0 {
			return 0, fmt.Errorf("invalid braced Unicode escape")
		}
		_, _ = s.next()
		val = val*16 + int64(hv)
		count++
		if val > maxCodePoint {
			return 0, fmt.Errorf("unicode escape exceeds U+10FFFF")
		}
	}
	if count == 0 || !s.eat('}') {
		return 0, fmt.Errorf("malformed braced Unicode escape")
	}
	return rejectIfSurrogate(rune(val))
}

func parseUnicodeEscape(s *scanner) (rune, error) {
	if !s.eat('{') {
		cp, err := parseFixedHex(s, 4)
		if err != nil {
			return 0, err
		}
		return rejectIfSurrogate(cp)
	}
	return parseBracedHex(s)
}

type escapeResult struct {
	kind   string // "single", "ranges", "anchor"
	cp     rune
	ranges []CodePointRange
	anchor AnchorKind
}

func parseEscape(s *scanner, inClass bool) (escapeResult, error) {
	if s.eof() {
		return escapeResult{}, fmt.Errorf("trailing backslash in pattern")
	}
	cp, err := s.next()
	if err != nil {
		return escapeResult{}, err
	}
	if cp == 'b' {
		if inClass {
			return escapeResult{kind: "single", cp: 0x08}, nil
		}
		return escapeResult{kind: "anchor", anchor: AnchorWordBoundary}, nil
	}
	if cp == 'B' {
		if inClass {
			return escapeResult{}, fmt.Errorf("\\B is not supported inside a character class")
		}
		return escapeResult{kind: "anchor", anchor: AnchorNotWordBoundary}, nil
	}
	if cr, ok := classEscapes[cp]; ok {
		return escapeResult{kind: "ranges", ranges: cr}, nil
	}
	if ctrl, ok := controlEscapes[cp]; ok {
		return escapeResult{kind: "single", cp: ctrl}, nil
	}
	switch {
	case cp == '0':
		if isASCIIDigit(s.peek(0)) {
			return escapeResult{}, fmt.Errorf("octal escape is not supported")
		}
		return escapeResult{kind: "single", cp: 0x00}, nil
	case cp >= '1' && cp <= '9':
		return escapeResult{}, fmt.Errorf("backreference or octal escape is not supported")
	case cp == 'x':
		hx, err := parseFixedHex(s, 2)
		if err != nil {
			return escapeResult{}, err
		}
		return escapeResult{kind: "single", cp: hx}, nil
	case cp == 'u':
		ux, err := parseUnicodeEscape(s)
		if err != nil {
			return escapeResult{}, err
		}
		return escapeResult{kind: "single", cp: ux}, nil
	}
	if syntaxChars[cp] || (inClass && cp == '-') {
		return escapeResult{kind: "single", cp: cp}, nil
	}
	return escapeResult{}, fmt.Errorf("unsupported escape sequence \\%c", cp)
}

func parseClassAtom(s *scanner) (*rune, []CodePointRange, error) {
	cp, ok := s.peek(0)
	if !ok {
		return nil, nil, fmt.Errorf("unexpected end of character class")
	}
	if cp == '\\' {
		_, _ = s.next()
		esc, err := parseEscape(s, true)
		if err != nil {
			return nil, nil, err
		}
		if esc.kind == "single" {
			v := esc.cp
			return &v, []CodePointRange{{v, v}}, nil
		}
		return nil, esc.ranges, nil
	}
	if cp == '[' {
		return nil, nil, fmt.Errorf("nested character class is not supported")
	}
	if cp == '&' {
		if next, ok2 := s.peek(1); ok2 && next == '&' {
			return nil, nil, fmt.Errorf("character class intersection is not supported")
		}
	}
	lit, err := s.next()
	if err != nil {
		return nil, nil, err
	}
	return &lit, []CodePointRange{{lit, lit}}, nil
}

func parseClassItem(s *scanner) ([]CodePointRange, error) {
	firstSingle, firstRanges, err := parseClassAtom(s)
	if err != nil {
		return nil, err
	}
	p0, ok0 := s.peek(0)
	p1, ok1 := s.peek(1)
	if !ok0 || p0 != '-' || (ok1 && p1 == ']') {
		return firstRanges, nil
	}
	_, _ = s.next() // consume '-'
	if next, ok := s.peek(0); ok && next == '-' {
		return nil, fmt.Errorf("character class subtraction is not supported")
	}
	secondSingle, _, err := parseClassAtom(s)
	if err != nil {
		return nil, err
	}
	if firstSingle == nil || secondSingle == nil {
		return nil, fmt.Errorf("character class escape cannot form a range")
	}
	if *firstSingle > *secondSingle {
		return nil, fmt.Errorf("character class range out of order")
	}
	return []CodePointRange{{*firstSingle, *secondSingle}}, nil
}

func parseClass(s *scanner) (CharSetNode, error) {
	negated := s.eat('^')
	var ranges []CodePointRange
	for !s.eof() {
		if p, ok := s.peek(0); ok && p == ']' {
			break
		}
		item, err := parseClassItem(s)
		if err != nil {
			return CharSetNode{}, err
		}
		ranges = append(ranges, item...)
	}
	if !s.eat(']') {
		return CharSetNode{}, fmt.Errorf("unclosed character class")
	}
	if len(ranges) == 0 {
		return CharSetNode{}, fmt.Errorf("empty character class")
	}
	normalized := normalizeRanges(ranges)
	if negated {
		return CharSetNode{Ranges: complementRanges(normalized)}, nil
	}
	return CharSetNode{Ranges: normalized}, nil
}

func parseDecimalInt(s *scanner) (*int, bool) {
	if !isASCIIDigit(s.peek(0)) {
		return nil, true
	}
	var val int64
	for isASCIIDigit(s.peek(0)) {
		cp, _ := s.next()
		val = val*10 + int64(cp-'0')
		if val > maxQuantifierBound+1 {
			val = maxQuantifierBound + 1
		}
	}
	iv := int(val)
	return &iv, true
}

func parseBracedBounds(s *scanner) (int, *int, error) {
	minVal, _ := parseDecimalInt(s)
	if minVal == nil {
		return 0, nil, fmt.Errorf("malformed brace quantifier")
	}
	if *minVal > maxQuantifierBound {
		return 0, nil, fmt.Errorf("quantifier lower bound exceeds %d", maxQuantifierBound)
	}
	if s.eat('}') {
		mv := *minVal
		return mv, &mv, nil
	}
	if !s.eat(',') {
		return 0, nil, fmt.Errorf("malformed brace quantifier")
	}
	if s.eat('}') {
		return *minVal, nil, nil
	}
	maxVal, _ := parseDecimalInt(s)
	if maxVal == nil || !s.eat('}') {
		return 0, nil, fmt.Errorf("malformed brace quantifier")
	}
	if *maxVal > maxQuantifierBound {
		return 0, nil, fmt.Errorf("quantifier upper bound exceeds %d", maxQuantifierBound)
	}
	if *maxVal < *minVal {
		return 0, nil, fmt.Errorf("quantifier minimum exceeds maximum")
	}
	return *minVal, maxVal, nil
}

func isQuantifierStart(cp rune, ok bool) bool {
	return ok && (cp == '*' || cp == '+' || cp == '?' || cp == '{')
}

func parseQuantifier(s *scanner, child Node) (RepeatNode, error) {
	q, err := s.next()
	if err != nil {
		return RepeatNode{}, err
	}
	var minVal int
	var maxVal *int
	switch q {
	case '*':
		minVal = 0
	case '+':
		minVal = 1
	case '?':
		one := 1
		minVal = 0
		maxVal = &one
	default:
		minVal, maxVal, err = parseBracedBounds(s)
		if err != nil {
			return RepeatNode{}, err
		}
	}
	lazy := s.eat('?')
	if isQuantifierStart(s.peek(0)) {
		return RepeatNode{}, fmt.Errorf("possessive or chained quantifiers are not supported")
	}
	return RepeatNode{Child: child, Min: minVal, Max: maxVal, Lazy: lazy}, nil
}

func parseGroup(s *scanner) (Node, error) {
	if !s.eat('?') {
		body, err := parseDisjunction(s)
		if err != nil {
			return nil, err
		}
		if !s.eat(')') {
			return nil, fmt.Errorf("unclosed group")
		}
		return GroupNode{Capturing: true, Child: body}, nil
	}
	mod, ok := s.peek(0)
	if !ok || (mod != ':' && mod != '=' && mod != '!') {
		return nil, fmt.Errorf("unsupported group extension")
	}
	_, _ = s.next()
	body, err := parseDisjunction(s)
	if err != nil {
		return nil, err
	}
	if !s.eat(')') {
		return nil, fmt.Errorf("unclosed group")
	}
	if mod == ':' {
		return GroupNode{Capturing: false, Child: body}, nil
	}
	return LookaheadNode{Negated: mod == '!', Child: body}, nil
}

func parseAtom(s *scanner) (Node, error) {
	cp, err := s.next()
	if err != nil {
		return nil, err
	}
	switch cp {
	case '^':
		return AnchorNode{Anchor: AnchorStart}, nil
	case '$':
		return AnchorNode{Anchor: AnchorEnd}, nil
	case '.':
		return CharSetNode{Ranges: dotRanges}, nil
	case '[':
		return parseClass(s)
	case '(':
		return parseGroup(s)
	case '\\':
		esc, err := parseEscape(s, false)
		if err != nil {
			return nil, err
		}
		switch esc.kind {
		case "anchor":
			return AnchorNode{Anchor: esc.anchor}, nil
		case "ranges":
			return CharSetNode{Ranges: esc.ranges}, nil
		default:
			return CharSetNode{Ranges: []CodePointRange{{esc.cp, esc.cp}}}, nil
		}
	case '{', '}', ']':
		return nil, fmt.Errorf("unescaped brace or bracket is not supported")
	case '*', '+', '?':
		return nil, fmt.Errorf("nothing to repeat")
	default:
		return CharSetNode{Ranges: []CodePointRange{{cp, cp}}}, nil
	}
}

func parseTerm(s *scanner) (Node, error) {
	atom, err := parseAtom(s)
	if err != nil {
		return nil, err
	}
	if !isQuantifierStart(s.peek(0)) {
		return atom, nil
	}
	switch atom.(type) {
	case AnchorNode, LookaheadNode:
		return nil, fmt.Errorf("quantifier on an assertion is not supported")
	}
	return parseQuantifier(s, atom)
}

func parseAlternative(s *scanner) (Node, error) {
	var items []Node
	for !s.eof() {
		if p, ok := s.peek(0); ok && (p == '|' || p == ')') {
			break
		}
		term, err := parseTerm(s)
		if err != nil {
			return nil, err
		}
		items = append(items, term)
	}
	if len(items) == 0 {
		return EmptyNode{}, nil
	}
	if len(items) == 1 {
		return items[0], nil
	}
	return ConcatNode{Items: items}, nil
}

func parseDisjunction(s *scanner) (Node, error) {
	first, err := parseAlternative(s)
	if err != nil {
		return nil, err
	}
	branches := []Node{first}
	for s.eat('|') {
		next, err := parseAlternative(s)
		if err != nil {
			return nil, err
		}
		branches = append(branches, next)
	}
	if len(branches) == 1 {
		return branches[0], nil
	}
	return AltNode{Branches: branches}, nil
}

// ParseSubset parses pattern against the portable A2UI ECMAScript regex grammar.
func ParseSubset(pattern string) (Node, error) {
	cps, err := toCodePoints(pattern)
	if err != nil {
		return nil, err
	}
	s := &scanner{cps: cps}
	tree, err := parseDisjunction(s)
	if err != nil {
		return nil, err
	}
	if !s.eof() {
		return nil, fmt.Errorf("unmatched closing parenthesis")
	}
	return tree, nil
}

func unwrap(n Node) Node {
	curr := n
	for {
		g, ok := curr.(GroupNode)
		if !ok {
			return curr
		}
		curr = g.Child
	}
}

func childrenOf(n Node) []Node {
	switch typed := n.(type) {
	case GroupNode:
		return []Node{typed.Child}
	case LookaheadNode:
		return []Node{typed.Child}
	case RepeatNode:
		return []Node{typed.Child}
	case ConcatNode:
		return typed.Items
	case AltNode:
		return typed.Branches
	default:
		return nil
	}
}

func nullable(n Node) bool {
	switch typed := n.(type) {
	case EmptyNode, AnchorNode, LookaheadNode:
		return true
	case CharSetNode:
		return false
	case RepeatNode:
		if typed.Min == 0 {
			return true
		}
		return nullable(typed.Child)
	case AltNode:
		for _, b := range typed.Branches {
			if nullable(b) {
				return true
			}
		}
		return false
	default:
		for _, ch := range childrenOf(n) {
			if !nullable(ch) {
				return false
			}
		}
		return true
	}
}

func firstSet(n Node) []CodePointRange {
	switch typed := n.(type) {
	case CharSetNode:
		return typed.Ranges
	case GroupNode:
		return firstSet(typed.Child)
	case RepeatNode:
		if typed.Max != nil && *typed.Max == 0 {
			return nil
		}
		return firstSet(typed.Child)
	case AltNode:
		var acc []CodePointRange
		for _, b := range typed.Branches {
			acc = append(acc, firstSet(b)...)
		}
		return normalizeRanges(acc)
	case ConcatNode:
		var acc []CodePointRange
		for _, item := range typed.Items {
			acc = append(acc, firstSet(item)...)
			if !nullable(item) {
				break
			}
		}
		return normalizeRanges(acc)
	default:
		return nil
	}
}

func consumedChars(n Node) []CodePointRange {
	switch typed := n.(type) {
	case CharSetNode:
		return typed.Ranges
	case GroupNode:
		return consumedChars(typed.Child)
	case RepeatNode:
		if typed.Max != nil && *typed.Max == 0 {
			return nil
		}
		return consumedChars(typed.Child)
	case ConcatNode:
		var acc []CodePointRange
		for _, item := range typed.Items {
			acc = append(acc, consumedChars(item)...)
		}
		return normalizeRanges(acc)
	case AltNode:
		var acc []CodePointRange
		for _, b := range typed.Branches {
			acc = append(acc, consumedChars(b)...)
		}
		return normalizeRanges(acc)
	default:
		return nil
	}
}

func hasUnbounded(n Node) bool {
	if rep, ok := n.(RepeatNode); ok && rep.Max == nil {
		return true
	}
	for _, ch := range childrenOf(n) {
		if hasUnbounded(ch) {
			return true
		}
	}
	return false
}

func hasNestedQuantifier(n Node) bool {
	if rep, ok := n.(RepeatNode); ok && (rep.Max == nil || *rep.Max > 1) && hasUnbounded(rep.Child) {
		return true
	}
	for _, ch := range childrenOf(n) {
		if hasNestedQuantifier(ch) {
			return true
		}
	}
	return false
}

func hasOverlappingAlternation(n Node) bool {
	if rep, ok := n.(RepeatNode); ok && rep.Max == nil {
		if alt, ok := unwrap(rep.Child).(AltNode); ok {
			sets := make([][]CodePointRange, len(alt.Branches))
			for i, b := range alt.Branches {
				sets[i] = firstSet(unwrap(b))
			}
			for i := 0; i < len(sets); i++ {
				for j := i + 1; j < len(sets); j++ {
					if rangesOverlap(sets[i], sets[j]) {
						return true
					}
				}
			}
		}
	}
	for _, ch := range childrenOf(n) {
		if hasOverlappingAlternation(ch) {
			return true
		}
	}
	return false
}

func followsWithOverlappingUnbounded(xChars []CodePointRange, tail []Node) bool {
	for _, item := range tail {
		if uy, ok := unwrap(item).(RepeatNode); ok && uy.Max == nil && rangesOverlap(xChars, consumedChars(uy.Child)) {
			return true
		}
		if !nullable(item) {
			break
		}
	}
	return false
}

func hasAdjacentOverlap(n Node) bool {
	if c, ok := n.(ConcatNode); ok {
		for i, item := range c.Items {
			ux, ok := unwrap(item).(RepeatNode)
			if !ok || ux.Max != nil {
				continue
			}
			if followsWithOverlappingUnbounded(consumedChars(ux.Child), c.Items[i+1:]) {
				return true
			}
		}
	}
	for _, ch := range childrenOf(n) {
		if hasAdjacentOverlap(ch) {
			return true
		}
	}
	return false
}

// Analyze parses pattern and evaluates the four static ReDoS safety rules.
func Analyze(pattern string) AnalysisResult {
	if CountCodePoints(pattern) > MaxPatternCodePoints {
		return AnalysisResult{
			OK:     false,
			Reason: RejectPatternTooLong,
			Detail: fmt.Sprintf("Pattern exceeds maximum length of %d code points", MaxPatternCodePoints),
		}
	}
	tree, err := ParseSubset(pattern)
	if err != nil {
		return AnalysisResult{
			OK:     false,
			Reason: RejectUnsupportedSyntax,
			Detail: err.Error(),
		}
	}
	if hasNestedQuantifier(tree) {
		return AnalysisResult{
			OK:     false,
			Reason: RejectNestedQuantifier,
			Detail: "Unsafe regex pattern (NESTED_QUANTIFIER)",
		}
	}
	if hasOverlappingAlternation(tree) {
		return AnalysisResult{
			OK:     false,
			Reason: RejectOverlappingAlternation,
			Detail: "Unsafe regex pattern (OVERLAPPING_ALTERNATION)",
		}
	}
	if hasAdjacentOverlap(tree) {
		return AnalysisResult{
			OK:     false,
			Reason: RejectAdjacentOverlap,
			Detail: "Unsafe regex pattern (ADJACENT_OVERLAP)",
		}
	}
	return AnalysisResult{OK: true, Tree: tree}
}

// maxCachedPatterns bounds the AnalyzeCached memo so that a stream of distinct patterns
// (for example from untrusted catalogs or agents) cannot grow memory without limit.
const maxCachedPatterns = 256

var (
	cacheMu       sync.Mutex
	compiledCache = make(map[string]AnalysisResult, maxCachedPatterns)
)

// AnalyzeCached caches up to 256 analyzed patterns.
func AnalyzeCached(pattern string) AnalysisResult {
	cacheMu.Lock()
	cached, ok := compiledCache[pattern]
	cacheMu.Unlock()
	if ok {
		return cached
	}
	res := Analyze(pattern)
	if res.Reason == RejectPatternTooLong {
		// Rejected without parsing; caching would only pin the oversized key.
		return res
	}
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if _, exists := compiledCache[pattern]; !exists && len(compiledCache) >= maxCachedPatterns {
		// Evict an arbitrary entry; map iteration order is unspecified.
		for k := range compiledCache {
			delete(compiledCache, k)
			break
		}
	}
	compiledCache[pattern] = res
	return res
}

// MatchTest evaluates an analyzed AST against value using substring search semantics.
// When value exceeds MaxValueCodePoints, exceededLimit is true and matched is false.
func MatchTest(tree Node, value string) (matched bool, exceededLimit bool) {
	if CountCodePoints(value) > MaxValueCodePoints {
		return false, true
	}
	cps := []rune(value)
	m := &matcher{cps: cps}
	// evalSet distributes over the positions in its frontier, so a single evaluation from every
	// start position decides the substring search; evaluating each start separately multiplies
	// the cost by the value length.
	starts := make([]int, len(cps)+1)
	for i := range starts {
		starts[i] = i
	}
	return len(m.evalSet(tree, starts)) > 0, false
}

type matcher struct {
	cps []rune
}

func isASCIIWord(cp rune) bool {
	return (cp >= '0' && cp <= '9') ||
		(cp >= 'A' && cp <= 'Z') ||
		(cp >= 'a' && cp <= 'z') ||
		cp == '_'
}

func (m *matcher) anchorHolds(kind AnchorKind, pos int) bool {
	switch kind {
	case AnchorStart:
		return pos == 0
	case AnchorEnd:
		return pos == len(m.cps)
	case AnchorWordBoundary:
		left := pos > 0 && isASCIIWord(m.cps[pos-1])
		right := pos < len(m.cps) && isASCIIWord(m.cps[pos])
		return left != right
	case AnchorNotWordBoundary:
		left := pos > 0 && isASCIIWord(m.cps[pos-1])
		right := pos < len(m.cps) && isASCIIWord(m.cps[pos])
		return left == right
	default:
		return false
	}
}

// evalSet evaluates n starting from every position in frontier (sorted, deduplicated)
// and returns the sorted, deduplicated set of reachable end positions.
func (m *matcher) evalSet(n Node, frontier []int) []int {
	if len(frontier) == 0 {
		return nil
	}
	switch typed := n.(type) {
	case EmptyNode:
		return frontier

	case GroupNode:
		return m.evalSet(typed.Child, frontier)

	case AnchorNode:
		var out []int
		for _, pos := range frontier {
			if m.anchorHolds(typed.Anchor, pos) {
				out = append(out, pos)
			}
		}
		return out

	case LookaheadNode:
		var out []int
		for _, pos := range frontier {
			hasMatch := len(m.evalSet(typed.Child, []int{pos})) > 0
			if hasMatch != typed.Negated {
				out = append(out, pos)
			}
		}
		return out

	case CharSetNode:
		var out []int
		for _, pos := range frontier {
			if pos < len(m.cps) && rangeContains(typed.Ranges, m.cps[pos]) {
				out = append(out, pos+1)
			}
		}
		return out

	case ConcatNode:
		cur := frontier
		for _, item := range typed.Items {
			cur = m.evalSet(item, cur)
			if len(cur) == 0 {
				return nil
			}
		}
		return cur

	case AltNode:
		seen := make([]bool, len(m.cps)+1)
		for _, b := range typed.Branches {
			for _, p := range m.evalSet(b, frontier) {
				seen[p] = true
			}
		}
		return boolSliceToPositions(seen)

	case RepeatNode:
		return m.evalRepeat(typed, frontier)
	}
	return nil
}

func (m *matcher) evalRepeat(rep RepeatNode, frontier []int) []int {
	cur := frontier
	for step := 0; step < rep.Min; step++ {
		next := m.evalSet(rep.Child, cur)
		if len(next) == 0 {
			return nil
		}
		if intSlicesEqual(next, cur) {
			// Fixed point reached: further applications of Child produce the identical set.
			break
		}
		cur = next
	}

	if rep.Max != nil && *rep.Max == rep.Min {
		return cur
	}

	seen := make([]bool, len(m.cps)+1)
	for _, p := range cur {
		seen[p] = true
	}

	if rep.Max == nil {
		// Unbounded BFS closure over positions 0..len(m.cps).
		queue := append([]int(nil), cur...)
		for len(queue) > 0 {
			next := m.evalSet(rep.Child, queue)
			queue = queue[:0]
			for _, p := range next {
				if !seen[p] {
					seen[p] = true
					queue = append(queue, p)
				}
			}
		}
		return boolSliceToPositions(seen)
	}

	// Bounded optional steps [Min+1 .. *Max] with fixed-point early termination.
	for step := rep.Min; step < *rep.Max; step++ {
		next := m.evalSet(rep.Child, cur)
		if len(next) == 0 {
			break
		}
		for _, p := range next {
			seen[p] = true
		}
		if intSlicesEqual(next, cur) {
			break
		}
		cur = next
	}
	return boolSliceToPositions(seen)
}

func boolSliceToPositions(seen []bool) []int {
	var out []int
	for i, ok := range seen {
		if ok {
			out = append(out, i)
		}
	}
	return out
}

func intSlicesEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
