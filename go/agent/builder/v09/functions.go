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

package v09

import "github.com/a2ui-project/a2ui/go/agent/builder"

// RangeOption configures optional min/max bounds on Length and Numeric function builders.
type RangeOption func(args map[string]any)

// WithRangeMin sets the "min" bound on Length or Numeric function calls.
func WithRangeMin(min float64) RangeOption {
	return func(args map[string]any) { args["min"] = min }
}

// WithRangeMax sets the "max" bound on Length or Numeric function calls.
func WithRangeMax(max float64) RangeOption {
	return func(args map[string]any) { args["max"] = max }
}

// NumberFormatOption configures optional decimals and grouping arguments on FormatNumber and FormatCurrency.
type NumberFormatOption func(args map[string]any)

// WithDecimals sets the "decimals" argument on FormatNumber or FormatCurrency.
func WithDecimals(decimals DynamicNumber) NumberFormatOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(decimals) {
			args["decimals"] = decimals
		}
	}
}

// WithGrouping sets the "grouping" argument on FormatNumber or FormatCurrency.
func WithGrouping(grouping DynamicBoolean) NumberFormatOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(grouping) {
			args["grouping"] = grouping
		}
	}
}

// PluralizeOption configures optional CLDR plural category forms on Pluralize.
type PluralizeOption func(args map[string]any)

// WithPluralZero sets the "zero" category form on Pluralize.
func WithPluralZero(s DynamicString) PluralizeOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(s) {
			args["zero"] = s
		}
	}
}

// WithPluralOne sets the "one" category form on Pluralize.
func WithPluralOne(s DynamicString) PluralizeOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(s) {
			args["one"] = s
		}
	}
}

// WithPluralTwo sets the "two" category form on Pluralize.
func WithPluralTwo(s DynamicString) PluralizeOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(s) {
			args["two"] = s
		}
	}
}

// WithPluralFew sets the "few" category form on Pluralize.
func WithPluralFew(s DynamicString) PluralizeOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(s) {
			args["few"] = s
		}
	}
}

// WithPluralMany sets the "many" category form on Pluralize.
func WithPluralMany(s DynamicString) PluralizeOption {
	return func(args map[string]any) {
		if !builder.IsNilValue(s) {
			args["many"] = s
		}
	}
}

// Required constructs a v0.9 "required" validation FunctionCall.
func Required(value any) FunctionCall {
	return NewFunctionCall("required", map[string]any{"value": value})
}

// Regex constructs a v0.9 "regex" validation FunctionCall.
func Regex(value DynamicString, pattern string) FunctionCall {
	return NewFunctionCall("regex", map[string]any{"value": value, "pattern": pattern})
}

// Length constructs a v0.9 "length" validation FunctionCall.
func Length(value DynamicString, opts ...RangeOption) FunctionCall {
	args := map[string]any{"value": value}
	for _, opt := range opts {
		opt(args)
	}
	return NewFunctionCall("length", args)
}

// Numeric constructs a v0.9 "numeric" validation FunctionCall.
func Numeric(value DynamicNumber, opts ...RangeOption) FunctionCall {
	args := map[string]any{"value": value}
	for _, opt := range opts {
		opt(args)
	}
	return NewFunctionCall("numeric", args)
}

// Email constructs a v0.9 "email" validation FunctionCall.
func Email(value DynamicString) FunctionCall {
	return NewFunctionCall("email", map[string]any{"value": value})
}

// FormatString constructs a v0.9 "formatString" interpolation FunctionCall.
func FormatString(value DynamicString) FunctionCall {
	return NewFunctionCall("formatString", map[string]any{"value": value})
}

// FormatNumber constructs a v0.9 "formatNumber" FunctionCall.
func FormatNumber(value DynamicNumber, opts ...NumberFormatOption) FunctionCall {
	args := map[string]any{"value": value}
	for _, opt := range opts {
		opt(args)
	}
	return NewFunctionCall("formatNumber", args)
}

// FormatCurrency constructs a v0.9 "formatCurrency" FunctionCall.
func FormatCurrency(value DynamicNumber, currency DynamicString, opts ...NumberFormatOption) FunctionCall {
	args := map[string]any{"value": value, "currency": currency}
	for _, opt := range opts {
		opt(args)
	}
	return NewFunctionCall("formatCurrency", args)
}

// FormatDate constructs a v0.9 "formatDate" FunctionCall.
func FormatDate(value any, format DynamicString) FunctionCall {
	return NewFunctionCall("formatDate", map[string]any{"value": value, "format": format})
}

// Pluralize constructs a v0.9 "pluralize" CLDR FunctionCall.
func Pluralize(value DynamicNumber, other DynamicString, opts ...PluralizeOption) FunctionCall {
	args := map[string]any{"value": value, "other": other}
	for _, opt := range opts {
		opt(args)
	}
	return NewFunctionCall("pluralize", args)
}

// OpenURL constructs a v0.9 "openUrl" FunctionCall.
func OpenURL(url string) FunctionCall {
	return NewFunctionCall("openUrl", map[string]any{"url": url})
}

// And constructs a v0.9 logical "and" FunctionCall.
func And(values ...DynamicBoolean) FunctionCall {
	if values == nil {
		values = []DynamicBoolean{}
	}
	return NewFunctionCall("and", map[string]any{"values": values})
}

// Or constructs a v0.9 logical "or" FunctionCall.
func Or(values ...DynamicBoolean) FunctionCall {
	if values == nil {
		values = []DynamicBoolean{}
	}
	return NewFunctionCall("or", map[string]any{"values": values})
}

// Not constructs a v0.9 logical "not" FunctionCall.
func Not(value DynamicBoolean) FunctionCall {
	return NewFunctionCall("not", map[string]any{"value": value})
}
