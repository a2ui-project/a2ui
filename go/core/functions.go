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
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/a2ui-project/a2ui/go/core/internal/formatting"
)

var (
	emailPatternRe    = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	allowedURLSchemes = map[string]bool{
		"http":   true,
		"https":  true,
		"mailto": true,
		"tel":    true,
	}
)

// validityOf extracts the boolean "valid" field from a v1.0 ValidationResult map, if present.
func validityOf(val any) (bool, bool) {
	if m, ok := val.(map[string]any); ok {
		if v, isBool := m["valid"].(bool); isBool {
			return v, true
		}
	}
	return false, false
}

// coerceDynamicBoolean coerces a resolved DynamicBoolean value (boolean, ValidationResult map,
// case-insensitive "true" string, or non-zero finite number) to a bool.
func coerceDynamicBoolean(val any) bool {
	if b, ok := val.(bool); ok {
		return b
	}
	if valid, ok := validityOf(val); ok {
		return valid
	}
	switch v := val.(type) {
	case string:
		return strings.EqualFold(v, "true")
	case int:
		return v != 0
	case int8:
		return v != 0
	case int16:
		return v != 0
	case int32:
		return v != 0
	case int64:
		return v != 0
	case uint:
		return v != 0
	case uint8:
		return v != 0
	case uint16:
		return v != 0
	case uint32:
		return v != 0
	case uint64:
		return v != 0
	case float32:
		f := float64(v)
		return f != 0 && !math.IsNaN(f)
	case float64:
		return v != 0 && !math.IsNaN(v)
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return f != 0 && !math.IsNaN(f)
		}
	}
	return false
}

func isDynamicBooleanSchema(schema map[string]any) bool {
	if schema == nil {
		return false
	}
	ref, ok := schema["$ref"].(string)
	if !ok {
		return false
	}
	idx := strings.LastIndexByte(ref, '/')
	name := ref
	if idx >= 0 {
		name = ref[idx+1:]
	}
	return name == "DynamicBoolean"
}

func functionArgsProperties(schema map[string]any) map[string]any {
	if schema == nil {
		return nil
	}
	if props, ok := schema["properties"].(map[string]any); ok {
		if argsObj, ok := props["args"].(map[string]any); ok {
			if argsProps, ok := argsObj["properties"].(map[string]any); ok {
				return argsProps
			}
		}
		return props
	}
	if params, ok := schema["parameters"].(map[string]any); ok {
		return params
	}
	return nil
}

func coerceValueForJSONSchema(schema any, val any) any {
	sm, ok := schema.(map[string]any)
	if !ok || sm == nil {
		return val
	}
	if isDynamicBooleanSchema(sm) {
		return coerceDynamicBoolean(val)
	}
	if itemsSchema, ok := sm["items"].(map[string]any); ok {
		if arr, isSlice := val.([]any); isSlice {
			out := make([]any, len(arr))
			for i, item := range arr {
				out[i] = coerceValueForJSONSchema(itemsSchema, item)
			}
			return out
		}
	}
	if subProps, ok := sm["properties"].(map[string]any); ok {
		if m, isMap := val.(map[string]any); isMap {
			out := make(map[string]any, len(m))
			for k, item := range m {
				out[k] = coerceValueForJSONSchema(subProps[k], item)
			}
			return out
		}
	}
	return val
}

// coerceValidationResults coerces ValidationResult objects into booleans wherever fnSchema types an argument as DynamicBoolean.
func coerceValidationResults(fnSchema map[string]any, args map[string]any) map[string]any {
	props := functionArgsProperties(fnSchema)
	if props == nil || args == nil {
		return args
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		out[k] = coerceValueForJSONSchema(props[k], v)
	}
	return out
}

// coerceToString renders an A2UI value as text (null -> "", integral floats without ".0", arrays/maps as compact JSON).
func coerceToString(val any) string {
	if val == nil {
		return ""
	}
	switch v := val.(type) {
	case string:
		return v
	case bool:
		if v {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(v)
	case int8:
		return strconv.FormatInt(int64(v), 10)
	case int16:
		return strconv.FormatInt(int64(v), 10)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint:
		return strconv.FormatUint(uint64(v), 10)
	case uint8:
		return strconv.FormatUint(uint64(v), 10)
	case uint16:
		return strconv.FormatUint(uint64(v), 10)
	case uint32:
		return strconv.FormatUint(uint64(v), 10)
	case uint64:
		return strconv.FormatUint(v, 10)
	case float64:
		if math.IsInf(v, -1) {
			return "-Infinity"
		}
		if math.IsInf(v, 1) {
			return "Infinity"
		}
		if math.IsNaN(v) {
			return "NaN"
		}
		if v == math.Trunc(v) && math.Abs(v) < 1e21 {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return coerceToString(float64(v))
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return strconv.FormatInt(i, 10)
		}
		if f, err := v.Float64(); err == nil {
			return coerceToString(f)
		}
		return v.String()
	case map[string]any, []any:
		norm := CloneJSONValue(val)
		if norm == nil {
			return ""
		}
		b, err := json.Marshal(normalizeIntegralJSONNumbers(norm))
		if err == nil {
			return string(b)
		}
		return fmt.Sprintf("%v", val)
	default:
		norm := CloneJSONValue(val)
		if norm == nil {
			return ""
		}
		switch norm.(type) {
		case map[string]any, []any:
			b, err := json.Marshal(normalizeIntegralJSONNumbers(norm))
			if err == nil {
				return string(b)
			}
		}
		return fmt.Sprintf("%v", val)
	}
}

func normalizeIntegralJSONNumbers(val any) any {
	switch v := val.(type) {
	case float64:
		if !math.IsInf(v, 0) && !math.IsNaN(v) && v == math.Trunc(v) && math.Abs(v) < 9007199254740992 {
			return int64(v)
		}
		return v
	case float32:
		return normalizeIntegralJSONNumbers(float64(v))
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			out[k] = normalizeIntegralJSONNumbers(item)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = normalizeIntegralJSONNumbers(item)
		}
		return out
	default:
		return val
	}
}

func toStrictFloat(val any) (float64, bool) {
	switch v := val.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int8:
		return float64(v), true
	case int16:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint8:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case bool:
		if v {
			return 1, true
		}
		return 0, true
	case json.Number:
		if !json.Valid([]byte(v)) {
			return 0, false
		}
		f, err := v.Float64()
		return f, err == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(trimmed, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// evaluateSystemIndex implements the v1.0 @index system function.
func evaluateSystemIndex(args map[string]any, evalCtx *DataContext) (any, error) {
	var idx int
	hasIdx := false
	if evalCtx != nil {
		idx, hasIdx = evalCtx.EffectiveIndexOrPath()
	}
	if !hasIdx {
		return nil, NewExpressionError("@index function can only be evaluated inside a collection template iteration scope.")
	}
	offset := 0
	if rawOff, ok := args["offset"]; ok && rawOff != nil {
		f, okNum := toStrictFloat(rawOff)
		if !okNum || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) {
			return nil, NewExpressionError("@index 'offset' argument must be an integer.")
		}
		offset = int(f)
	}
	return idx + offset, nil
}

// attachBasicCatalogEvaluators wires all built-in Basic Catalog functions onto cat.
func attachBasicCatalogEvaluators(cat *Catalog) {
	if cat == nil {
		return
	}
	isV10 := IsAtLeastVersion(string(cat.ProtocolVersion()), Version1_0)
	evals := buildBasicFunctionEvaluators(isV10, "")
	for name, fn := range evals {
		cat.SetFunctionEvaluator(name, fn)
	}
}

// buildBasicFunctionEvaluators constructs evaluators for all 14 Basic Catalog functions.
func buildBasicFunctionEvaluators(isV10 bool, locale string) map[string]FunctionEvaluator {
	wrapValidation := func(valid bool, code, msg string) any {
		if !isV10 {
			return valid
		}
		if valid {
			return map[string]any{"valid": true}
		}
		res := map[string]any{"valid": false}
		if code != "" {
			res["code"] = code
		}
		if msg != "" {
			res["message"] = msg
			res["severity"] = "error"
		}
		return res
	}

	return map[string]FunctionEvaluator{
		"required": func(args map[string]any, _ *DataContext) (any, error) {
			rawVal, exists := args["value"]
			val := CloneJSONValue(rawVal)
			if !exists || val == nil || val == "" {
				return wrapValidation(false, "", ""), nil
			}
			if arr, ok := val.([]any); ok && len(arr) == 0 {
				return wrapValidation(false, "", ""), nil
			}
			return wrapValidation(true, "", ""), nil
		},

		"regex": func(args map[string]any, _ *DataContext) (any, error) {
			pat := coerceToString(args["pattern"])
			val := coerceToString(args["value"])
			matched, exceeded, err := RegexTest(pat, val)
			if err != nil {
				return nil, err
			}
			if exceeded {
				matched = false
			}
			return wrapValidation(matched, "", ""), nil
		},

		"length": func(args map[string]any, _ *DataContext) (any, error) {
			val := CloneJSONValue(args["value"])
			var length int
			switch typed := val.(type) {
			case []any:
				length = len(typed)
			case map[string]any:
				length = len(typed)
			case nil:
				length = 0
			default:
				length = utf8.RuneCountInString(coerceToString(val))
			}
			valid := true
			if minRaw, ok := args["min"]; ok && minRaw != nil {
				if minF, okNum := toStrictFloat(minRaw); okNum && float64(length) < minF {
					valid = false
				}
			}
			if maxRaw, ok := args["max"]; ok && maxRaw != nil {
				if maxF, okNum := toStrictFloat(maxRaw); okNum && float64(length) > maxF {
					valid = false
				}
			}
			return wrapValidation(valid, "", ""), nil
		},

		"numeric": func(args map[string]any, _ *DataContext) (any, error) {
			valF, okNum := toStrictFloat(args["value"])
			// In numeric(), boolean should not count as numeric string/number if passed raw bool, matching Python float(val) vs JS: check non-bool!
			if _, isBool := args["value"].(bool); isBool || !okNum || math.IsNaN(valF) || math.IsInf(valF, 0) {
				return wrapValidation(false, "", ""), nil
			}
			if minRaw, ok := args["min"]; ok && minRaw != nil {
				minF, okMin := toStrictFloat(minRaw)
				if !okMin || valF < minF {
					return wrapValidation(false, "", ""), nil
				}
			}
			if maxRaw, ok := args["max"]; ok && maxRaw != nil {
				maxF, okMax := toStrictFloat(maxRaw)
				if !okMax || valF > maxF {
					return wrapValidation(false, "", ""), nil
				}
			}
			return wrapValidation(true, "", ""), nil
		},

		"email": func(args map[string]any, _ *DataContext) (any, error) {
			s := coerceToString(args["value"])
			if emailPatternRe.MatchString(s) {
				return wrapValidation(true, "", ""), nil
			}
			return wrapValidation(
				false,
				"INVALID_EMAIL",
				"Please enter a valid email address (e.g. user@example.com).",
			), nil
		},

		"formatString": func(args map[string]any, ctx *DataContext) (any, error) {
			tpl := coerceToString(args["value"])
			if tpl == "" {
				return "", nil
			}
			parts, err := ParseExpressionTemplate(tpl)
			if err != nil {
				return nil, NewExpressionError(err.Error())
			}
			if len(parts) == 0 {
				return "", nil
			}
			atLeastV10 := isV10 || (ctx != nil && ctx.AtLeastV10())
			var activeCatID *string
			if ctx != nil && ctx.ActiveCatalogID != "" {
				cid := ctx.ActiveCatalogID
				activeCatID = &cid
			}
			var b strings.Builder
			for _, part := range parts {
				if ctx != nil {
					dynPart := part
					if atLeastV10 {
						dynPart = adaptExprASTPartForV10(part, activeCatID)
					}
					resolved, rErr := ctx.ResolveWithoutAgent(dynPart)
					if rErr != nil {
						return nil, rErr
					}
					b.WriteString(coerceToString(resolved))
				} else {
					b.WriteString(coerceToString(part))
				}
			}
			return b.String(), nil
		},

		"formatNumber": func(args map[string]any, ctx *DataContext) (any, error) {
			rawVal, hasVal := args["value"]
			if !hasVal || rawVal == nil {
				rawVal = 0.0
			}
			valF, okNum := toStrictFloat(rawVal)
			if !okNum {
				return "", nil
			}
			var decPtr *int
			if rawDec, ok := args["decimals"]; ok && rawDec != nil {
				if df, okD := toStrictFloat(rawDec); okD && !math.IsNaN(df) && !math.IsInf(df, 0) {
					d := int(df)
					decPtr = &d
				}
			}
			grouping := true
			if rawGrp, ok := args["grouping"]; ok && rawGrp != nil {
				grouping = coerceDynamicBoolean(rawGrp)
			}
			return formatting.FormatNumber(valF, decPtr, grouping, effectiveLocale(ctx, locale)), nil
		},

		"formatCurrency": func(args map[string]any, ctx *DataContext) (any, error) {
			rawVal, hasVal := args["value"]
			if !hasVal || rawVal == nil {
				rawVal = 0.0
			}
			valF, okNum := toStrictFloat(rawVal)
			if !okNum {
				return "", nil
			}
			currency := "USD"
			if rawCur, ok := args["currency"]; ok && rawCur != nil {
				currency = coerceToString(rawCur)
			}
			decimals := 2
			if rawDec, ok := args["decimals"]; ok && rawDec != nil {
				if df, okD := toStrictFloat(rawDec); okD && !math.IsNaN(df) && !math.IsInf(df, 0) {
					decimals = int(df)
				}
			}
			grouping := true
			if rawGrp, ok := args["grouping"]; ok && rawGrp != nil {
				grouping = coerceDynamicBoolean(rawGrp)
			}
			return formatting.FormatCurrency(valF, currency, decimals, grouping, effectiveLocale(ctx, locale)), nil
		},

		"formatDate": func(args map[string]any, ctx *DataContext) (any, error) {
			rawVal := args["value"]
			if rawVal == nil {
				return "", nil
			}
			fmtStr := "yyyy-MM-dd"
			if rawFmt, ok := args["format"]; ok && rawFmt != nil {
				if s := coerceToString(rawFmt); s != "" {
					fmtStr = s
				}
			}
			return formatting.FormatDate(coerceToString(rawVal), fmtStr, effectiveLocale(ctx, locale)), nil
		},

		"pluralize": func(args map[string]any, ctx *DataContext) (any, error) {
			rawVal, hasVal := args["value"]
			if !hasVal || rawVal == nil {
				rawVal = 0.0
			}
			valF, _ := toStrictFloat(rawVal)
			forms := map[string]string{}
			present := map[string]bool{}
			for _, cat := range []string{"zero", "one", "two", "few", "many", "other"} {
				if rawForm, ok := args[cat]; ok && rawForm != nil {
					forms[cat] = coerceToString(rawForm)
					present[cat] = true
				}
			}
			return formatting.Pluralize(valF, forms, present, effectiveLocale(ctx, locale)), nil
		},

		"openUrl": func(args map[string]any, _ *DataContext) (any, error) {
			rawURL, ok := args["url"].(string)
			if !ok || strings.TrimSpace(rawURL) == "" {
				return nil, nil
			}
			parsed, err := url.Parse(strings.TrimSpace(rawURL))
			if err != nil {
				return nil, NewExpressionErrorf("Invalid URL specified: %s", rawURL)
			}
			scheme := strings.ToLower(parsed.Scheme)
			if !allowedURLSchemes[scheme] {
				return nil, NewExpressionErrorf("Unsupported URL scheme: %s", parsed.Scheme)
			}
			return nil, nil
		},

		"and": func(args map[string]any, _ *DataContext) (any, error) {
			values, ok := CloneJSONValue(args["values"]).([]any)
			if !ok || len(values) < 2 {
				return nil, NewExpressionError("AndFunction requires at least 2 values")
			}
			for _, v := range values {
				if !coerceDynamicBoolean(v) {
					return false, nil
				}
			}
			return true, nil
		},

		"or": func(args map[string]any, _ *DataContext) (any, error) {
			values, ok := CloneJSONValue(args["values"]).([]any)
			if !ok || len(values) < 2 {
				return nil, NewExpressionError("OrFunction requires at least 2 values")
			}
			for _, v := range values {
				if coerceDynamicBoolean(v) {
					return true, nil
				}
			}
			return false, nil
		},

		"not": func(args map[string]any, _ *DataContext) (any, error) {
			return !coerceDynamicBoolean(args["value"]), nil
		},
	}
}

func effectiveLocale(ctx *DataContext, fallback string) string {
	if ctx != nil && ctx.Surface != nil && ctx.Surface.Locale != "" {
		return ctx.Surface.Locale
	}
	if fallback != "" {
		return fallback
	}
	return "en-US"
}

func adaptExprASTPartForV10(part any, catalogID *string) any {
	switch typed := part.(type) {
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = adaptExprASTPartForV10(item, catalogID)
		}
		return out
	case map[string]any:
		if p, ok := typed["path"].(string); ok && !hasKey(typed, "componentId") && !hasKey(typed, "@path") {
			return map[string]any{"@path": p}
		}
		callName, hasCall := typed["call"].(string)
		if !hasCall {
			callName, hasCall = typed["@call"].(string)
		}
		if hasCall {
			args := map[string]any{}
			if rawArgs, ok := typed["args"].(map[string]any); ok {
				for k, v := range rawArgs {
					args[k] = adaptExprASTPartForV10(v, catalogID)
				}
			}
			res := map[string]any{
				"@call": callName,
				"args":  args,
			}
			if cid, hasExplicit := typed["catalogId"]; hasExplicit && cid != nil {
				res["catalogId"] = cid
			} else if catalogID != nil && !strings.HasPrefix(callName, "@") {
				res["catalogId"] = *catalogID
			}
			return res
		}
		out := make(map[string]any, len(typed))
		for k, v := range typed {
			out[k] = adaptExprASTPartForV10(v, catalogID)
		}
		return out
	default:
		return part
	}
}
