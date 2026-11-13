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

// Package schemaengine wraps JSON Schema Draft 2020-12 compilation and
// validation using strictly in-memory resource loading (zero network or
// filesystem I/O) and ECMA-262 compatible regular expression semantics.
package schemaengine

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
)

// OfflineResourceError is returned when a schema attempts to load an unregistered external URI.
type OfflineResourceError struct {
	URL string
}

func (e *OfflineResourceError) Error() string {
	return fmt.Sprintf("cannot resolve %q: A2UI never fetches $ref targets over the network", e.URL)
}

// IsOfflineResourceError reports whether err (or a jsonschema.LoadURLError wrapping it) was caused by an unregistered external URI.
func IsOfflineResourceError(err error) bool {
	if err == nil {
		return false
	}
	if _, ok := err.(*OfflineResourceError); ok {
		return true
	}
	if loadErr, ok := err.(*jsonschema.LoadURLError); ok {
		_, isOff := loadErr.Err.(*OfflineResourceError)
		return isOff
	}
	return false
}

type offlineLoader struct {
	resources map[string]any
}

func (l offlineLoader) Load(url string) (any, error) {
	if l.resources != nil {
		if doc, ok := l.resources[url]; ok {
			return doc, nil
		}
	}
	return nil, &OfflineResourceError{URL: url}
}

// uax31IdentRegexp implements jsonschema.Regexp for exact UAX #31 identifier matching.
type uax31IdentRegexp struct {
	raw string
}

func (r uax31IdentRegexp) String() string { return r.raw }

func (r uax31IdentRegexp) MatchString(s string) bool {
	return IsUAX31Identifier(s)
}

// IsUAX31Identifier reports whether s matches ^[\p{XID_Start}_][\p{XID_Continue}]*$.
func IsUAX31Identifier(s string) bool {
	if s == "" {
		return false
	}
	for i, ch := range s {
		if i == 0 {
			if ch != '_' && (isNFKCExcludedXIDStart(ch) ||
				unicode.In(ch, unicode.Pattern_Syntax, unicode.Pattern_White_Space) ||
				!unicode.In(ch, unicode.L, unicode.Nl, unicode.Other_ID_Start)) {
				return false
			}
		} else {
			if ch != '_' && (isNFKCExcludedXIDContinue(ch) ||
				unicode.In(ch, unicode.Pattern_Syntax, unicode.Pattern_White_Space) ||
				!unicode.In(ch, unicode.L, unicode.Nl, unicode.Nd, unicode.Mn, unicode.Mc, unicode.Pc, unicode.Other_ID_Start, unicode.Other_ID_Continue)) {
				return false
			}
		}
	}
	return true
}

func isNFKCExcludedXIDStart(r rune) bool {
	switch {
	case r == 0x037A, r == 0x0E33, r == 0x0EB3, r == 0xFDFA, r == 0xFDFB:
		return true
	case r >= 0xFC5E && r <= 0xFC63:
		return true
	case r >= 0xFE70 && r <= 0xFE7F:
		return true
	default:
		return false
	}
}

func isNFKCExcludedXIDContinue(r rune) bool {
	if isNFKCExcludedXIDStart(r) {
		return true
	}
	switch r {
	case 0x309B, 0x309C, 0xFF9E, 0xFF9F:
		return true
	default:
		return false
	}
}

type goRegexpWrapper struct {
	raw string
	re  *regexp.Regexp
}

func (r goRegexpWrapper) String() string            { return r.raw }
func (r goRegexpWrapper) MatchString(s string) bool { return r.re.MatchString(s) }

// maxCachedRegexps bounds compiledRegexpCache so that catalogs carrying ever-new "pattern"
// keywords (for example inline catalogs from clients) cannot grow memory without limit.
const maxCachedRegexps = 1024

var (
	regexpCacheMu       sync.Mutex
	compiledRegexpCache = make(map[string]jsonschema.Regexp, maxCachedRegexps)
)

func cacheRegexp(pattern string, r jsonschema.Regexp) {
	regexpCacheMu.Lock()
	defer regexpCacheMu.Unlock()
	if _, exists := compiledRegexpCache[pattern]; !exists && len(compiledRegexpCache) >= maxCachedRegexps {
		// Evict an arbitrary entry; map iteration order is unspecified.
		for k := range compiledRegexpCache {
			delete(compiledRegexpCache, k)
			break
		}
	}
	compiledRegexpCache[pattern] = r
}

// CompileECMARegexp compiles an ECMA-262 JSON Schema pattern into a jsonschema.Regexp.
func CompileECMARegexp(pattern string) (jsonschema.Regexp, error) {
	regexpCacheMu.Lock()
	cached, ok := compiledRegexpCache[pattern]
	regexpCacheMu.Unlock()
	if ok {
		return cached, nil
	}
	if pattern == `^[\p{XID_Start}_][\p{XID_Continue}]*$` {
		r := uax31IdentRegexp{raw: pattern}
		cacheRegexp(pattern, r)
		return r, nil
	}
	rewritten := rewriteECMAToRE2(pattern)
	re, err := regexp.Compile(rewritten)
	if err != nil {
		return nil, err
	}
	wrapped := goRegexpWrapper{raw: pattern, re: re}
	cacheRegexp(pattern, wrapped)
	return wrapped, nil
}

// rewriteECMAToRE2 rewrites unescaped '$' outside character classes to '\z' so
// '$' does not match before a trailing newline, and handles '^@([^@]|$)' and similar patterns.
func rewriteECMAToRE2(pattern string) string {
	var b strings.Builder
	b.Grow(len(pattern) + 4)
	inClass := false
	escaped := false
	for i := 0; i < len(pattern); i++ {
		ch := pattern[i]
		if escaped {
			b.WriteByte(ch)
			escaped = false
			continue
		}
		if ch == '\\' {
			b.WriteByte(ch)
			escaped = true
			continue
		}
		if ch == '[' && !inClass {
			inClass = true
			b.WriteByte(ch)
			if i+1 < len(pattern) && pattern[i+1] == '^' {
				i++
				b.WriteByte('^')
			}
			if i+1 < len(pattern) && pattern[i+1] == ']' {
				i++
				b.WriteByte(']')
			}
			continue
		}
		if ch == ']' && inClass {
			inClass = false
			b.WriteByte(ch)
			continue
		}
		if ch == '$' && !inClass {
			b.WriteString(`\z`)
			continue
		}
		b.WriteByte(ch)
	}
	return b.String()
}

// NewCompiler creates an offline JSON Schema Draft 2020-12 compiler with optional in-memory resources.
func NewCompiler(resources ...map[string]any) *jsonschema.Compiler {
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	var merged map[string]any
	for _, m := range resources {
		if len(m) == 0 {
			continue
		}
		if merged == nil {
			merged = make(map[string]any, len(m))
		}
		for k, v := range m {
			merged[k] = NormalizeJSON(v)
		}
	}
	c.UseLoader(offlineLoader{resources: merged})
	c.UseRegexpEngine(CompileECMARegexp)
	return c
}

// CompileInline compiles a single schema map at rootURL alongside optional extra URI resources.
func CompileInline(rootURL string, schema map[string]any, extraResources map[string]any) (*jsonschema.Schema, error) {
	c := NewCompiler(extraResources)
	if err := c.AddResource(rootURL, NormalizeJSON(schema)); err != nil {
		return nil, err
	}
	return c.Compile(rootURL)
}

// NormalizeJSON converts Go values (typed slices/maps, ints, yaml maps) into
// pure JSON-compatible representations accepted by jsonschema/v6 (`map[string]any`, `[]any`, `json.Number`, `string`, `bool`, `nil`).
func NormalizeJSON(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case string, bool:
		return val
	case json.Number:
		if !json.Valid([]byte(val)) {
			return math.NaN()
		}
		if _, err := val.Int64(); err == nil {
			return val
		}
		if f, err := val.Float64(); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return val
		}
		return math.NaN()
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return json.Number(strconv.Itoa(val))
	case int8:
		return json.Number(strconv.FormatInt(int64(val), 10))
	case int16:
		return json.Number(strconv.FormatInt(int64(val), 10))
	case int32:
		return json.Number(strconv.FormatInt(int64(val), 10))
	case int64:
		return json.Number(strconv.FormatInt(val, 10))
	case uint:
		return json.Number(strconv.FormatUint(uint64(val), 10))
	case uint8:
		return json.Number(strconv.FormatUint(uint64(val), 10))
	case uint16:
		return json.Number(strconv.FormatUint(uint64(val), 10))
	case uint32:
		return json.Number(strconv.FormatUint(uint64(val), 10))
	case uint64:
		return json.Number(strconv.FormatUint(val, 10))
	case []byte:
		return val
	case map[string]any:
		if val == nil {
			return nil
		}
		out := make(map[string]any, len(val))
		for k, item := range val {
			out[k] = NormalizeJSON(item)
		}
		return out
	case []any:
		if val == nil {
			return nil
		}
		out := make([]any, len(val))
		for i, item := range val {
			out[i] = NormalizeJSON(item)
		}
		return out
	case []string:
		if val == nil {
			return nil
		}
		out := make([]any, len(val))
		for i, item := range val {
			out[i] = item
		}
		return out
	default:
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Pointer:
			if rv.IsNil() {
				return nil
			}
			return v
		case reflect.Slice:
			if rv.IsNil() {
				return nil
			}
			out := make([]any, rv.Len())
			for i := 0; i < rv.Len(); i++ {
				out[i] = NormalizeJSON(rv.Index(i).Interface())
			}
			return out
		case reflect.Map:
			if rv.IsNil() {
				return nil
			}
			out := make(map[string]any, rv.Len())
			iter := rv.MapRange()
			for iter.Next() {
				out[fmt.Sprint(iter.Key().Interface())] = NormalizeJSON(iter.Value().Interface())
			}
			return out
		}
		return v
	}
}

// FlatIssue represents a normalized leaf validation failure extracted from *jsonschema.ValidationError.
type FlatIssue struct {
	Location        []string
	Code            string
	Message         string
	IsUnknownProp   bool
	SchemaURL       string
	KeywordLocation []string
}

// ExtractIssues flattens a *jsonschema.ValidationError tree into deterministic leaf diagnostics.
func ExtractIssues(err error) []FlatIssue {
	ve, ok := err.(*jsonschema.ValidationError)
	if !ok || ve == nil {
		if err == nil {
			return nil
		}
		return []FlatIssue{{Code: "invalid_value", Message: err.Error()}}
	}
	var out []FlatIssue
	collectLeafIssues(ve, &out)
	out = mergeExtraFieldIssues(out)
	sort.SliceStable(out, func(i, j int) bool {
		pi := strings.Join(out[i].Location, ".")
		pj := strings.Join(out[j].Location, ".")
		if pi != pj {
			return pi < pj
		}
		return out[i].Code < out[j].Code
	})
	return out
}

var singleUnexpectedPropRe = regexp.MustCompile(`^Additional properties are not allowed \('([^']*)' was unexpected\)$`)

// mergeExtraFieldIssues folds the per-property unexpected-property issues of one object into a single issue,
// so an object with several unexpected properties reports them together at the object's location.
func mergeExtraFieldIssues(issues []FlatIssue) []FlatIssue {
	groupIndex := map[string]int{}
	groupProps := map[int][]string{}
	out := make([]FlatIssue, 0, len(issues))
	for _, iss := range issues {
		m := singleUnexpectedPropRe.FindStringSubmatch(iss.Message)
		if iss.Code != "extra_field" || len(m) != 2 {
			out = append(out, iss)
			continue
		}
		key := strings.Join(iss.Location, "\x00")
		if idx, seen := groupIndex[key]; seen {
			groupProps[idx] = append(groupProps[idx], m[1])
			out[idx].IsUnknownProp = out[idx].IsUnknownProp && iss.IsUnknownProp
			continue
		}
		groupIndex[key] = len(out)
		groupProps[len(out)] = []string{m[1]}
		out = append(out, iss)
	}
	for idx, props := range groupProps {
		if len(props) < 2 {
			continue
		}
		sort.Strings(props)
		quoted := make([]string, len(props))
		for i, p := range props {
			quoted[i] = "'" + p + "'"
		}
		out[idx].Message = fmt.Sprintf("Additional properties are not allowed (%s were unexpected)", strings.Join(quoted, ", "))
	}
	return out
}

func collectLeafIssues(ve *jsonschema.ValidationError, out *[]FlatIssue) {
	// Stop descending at union errors (oneOf/anyOf) ONLY when causes are mutually exclusive branch mismatches,
	// unless there is a single clear cause or non-union structural failure.
	switch k := ve.ErrorKind.(type) {
	case *kind.Required:
		missing := append([]string(nil), k.Missing...)
		sort.Strings(missing)
		for _, prop := range missing {
			*out = append(*out, FlatIssue{
				Location:        append([]string(nil), ve.InstanceLocation...),
				Code:            "missing_field",
				Message:         fmt.Sprintf("'%s' is a required property", prop),
				SchemaURL:       ve.SchemaURL,
				KeywordLocation: k.KeywordPath(),
			})
		}
		return
	case *kind.AdditionalProperties:
		props := append([]string(nil), k.Properties...)
		sort.Strings(props)
		verb := "was"
		if len(props) > 1 {
			verb = "were"
		}
		quoted := make([]string, len(props))
		for i, p := range props {
			quoted[i] = fmt.Sprintf("'%s'", p)
		}
		*out = append(*out, FlatIssue{
			Location:        append([]string(nil), ve.InstanceLocation...),
			Code:            "extra_field",
			Message:         fmt.Sprintf("Additional properties are not allowed (%s %s unexpected)", strings.Join(quoted, ", "), verb),
			IsUnknownProp:   !strings.Contains(ve.SchemaURL, "Extensions"),
			SchemaURL:       ve.SchemaURL,
			KeywordLocation: k.KeywordPath(),
		})
		return
	case *kind.FalseSchema:
		kwPath := k.KeywordPath()
		isExtra := strings.HasSuffix(ve.SchemaURL, "/unevaluatedProperties") ||
			strings.HasSuffix(ve.SchemaURL, "/additionalProperties")
		if isExtra {
			propName := ""
			loc := append([]string(nil), ve.InstanceLocation...)
			if len(loc) > 0 {
				propName = loc[len(loc)-1]
				loc = loc[:len(loc)-1]
			}
			msg := "Additional properties are not allowed"
			if propName != "" {
				msg = fmt.Sprintf("Additional properties are not allowed ('%s' was unexpected)", propName)
			}
			*out = append(*out, FlatIssue{
				Location:        loc,
				Code:            "extra_field",
				Message:         msg,
				IsUnknownProp:   !strings.Contains(ve.SchemaURL, "Extensions"),
				SchemaURL:       ve.SchemaURL,
				KeywordLocation: kwPath,
			})
			return
		}
	case *kind.OneOf, *kind.AnyOf:
		// If all causes fail at the exact same location with simple type/const mismatches, emit a concise union error at ve.InstanceLocation;
		// however if one branch matched the discriminator/const (fewer deeper errors, e.g. missing required property inside a specific branch), prefer deeper causes!
		best := pickBestUnionBranch(ve.Causes)
		if best != nil {
			collectLeafIssues(best, out)
			return
		}
		*out = append(*out, FlatIssue{
			Location:  append([]string(nil), ve.InstanceLocation...),
			Code:      "type_mismatch",
			Message:   ve.Error(),
			SchemaURL: ve.SchemaURL,
		})
		return
	}

	if len(ve.Causes) > 0 {
		for _, c := range ve.Causes {
			collectLeafIssues(c, out)
		}
		return
	}

	code := mapErrorKindToCode(ve.ErrorKind, ve.SchemaURL)
	*out = append(*out, FlatIssue{
		Location:  append([]string(nil), ve.InstanceLocation...),
		Code:      code,
		Message:   leafIssueMessage(ve),
		SchemaURL: ve.SchemaURL,
	})
}

// leafIssueMessage returns the cross-SDK wording for enum and const failures
// (matching the Python jsonschema reference), and the engine's own message otherwise.
func leafIssueMessage(ve *jsonschema.ValidationError) string {
	switch k := ve.ErrorKind.(type) {
	case *kind.Enum:
		wants := make([]string, len(k.Want))
		for i, w := range k.Want {
			wants[i] = pythonRepr(w)
		}
		return fmt.Sprintf("%s is not one of [%s]", pythonRepr(k.Got), strings.Join(wants, ", "))
	case *kind.Const:
		return fmt.Sprintf("%s was expected", pythonRepr(k.Want))
	default:
		return ve.Error()
	}
}

// pythonRepr renders a decoded JSON value the way Python's repr() prints it.
func pythonRepr(v any) string {
	switch val := v.(type) {
	case nil:
		return "None"
	case bool:
		if val {
			return "True"
		}
		return "False"
	case string:
		return "'" + strings.ReplaceAll(strings.ReplaceAll(val, `\`, `\\`), "'", `\'`) + "'"
	case json.Number:
		return val.String()
	case float64:
		if val == math.Trunc(val) && !math.IsInf(val, 0) && math.Abs(val) < 1e15 {
			return strconv.FormatFloat(val, 'f', -1, 64)
		}
		return strconv.FormatFloat(val, 'g', -1, 64)
	case []any:
		parts := make([]string, len(val))
		for i, item := range val {
			parts[i] = pythonRepr(item)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case map[string]any:
		keys := make([]string, 0, len(val))
		for key := range val {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for i, key := range keys {
			parts[i] = pythonRepr(key) + ": " + pythonRepr(val[key])
		}
		return "{" + strings.Join(parts, ", ") + "}"
	default:
		return fmt.Sprint(val)
	}
}

func pickBestUnionBranch(causes []*jsonschema.ValidationError) *jsonschema.ValidationError {
	if len(causes) == 0 {
		return nil
	}
	if len(causes) == 1 {
		return causes[0]
	}
	// Prefer a branch that did NOT fail on a top-level const or top-level type mismatch (e.g. matched `event` or `functionCall` or `component` const, and failed deeper).
	var candidates []*jsonschema.ValidationError
	for _, c := range causes {
		if !isTopLevelTypeOrConstRejection(c) {
			candidates = append(candidates, c)
		}
	}
	if len(candidates) == 1 {
		return candidates[0]
	}
	return nil
}

func isTopLevelTypeOrConstRejection(ve *jsonschema.ValidationError) bool {
	switch ve.ErrorKind.(type) {
	case *kind.Type, *kind.Const:
		return true
	}
	for _, sub := range ve.Causes {
		if _, ok := sub.ErrorKind.(*kind.Const); ok {
			return true
		}
	}
	return false
}

func mapErrorKindToCode(ek jsonschema.ErrorKind, schemaURL string) string {
	switch ek.(type) {
	case *kind.Required, *kind.MinProperties, *kind.DependentRequired:
		return "missing_field"
	case *kind.AdditionalProperties:
		return "extra_field"
	case *kind.Type, *kind.Format, *kind.Pattern, *kind.Enum:
		return "type_mismatch"
	case *kind.FalseSchema:
		if strings.HasSuffix(schemaURL, "/unevaluatedProperties") || strings.HasSuffix(schemaURL, "/additionalProperties") {
			return "extra_field"
		}
		return "invalid_value"
	default:
		return "invalid_value"
	}
}
