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

// StatementKind distinguishes variable/path assignments from standalone expressions.
type StatementKind int

const (
	// StmtAssign represents `<identifier | $path> = <expression>`.
	StmtAssign StatementKind = iota
	// StmtExpr represents a standalone `<expression>` statement.
	StmtExpr
)

// Statement represents a top-level parsed Express statement.
type Statement struct {
	Kind   StatementKind
	Target string
	Value  any
	Line   int
}

// PathNode represents a dynamic data binding path (such as `$/user/name`),
// storing the text after the leading `$`.
type PathNode struct {
	Path string
}

// VariableNode represents a reference to a variable identifier.
type VariableNode struct {
	Name string
}

// SkippedNode represents the `_` placeholder for skipping a positional argument.
type SkippedNode struct{}

// NamedArg represents a `name = value` keyword argument inside a CallNode.
type NamedArg struct {
	Name  string
	Value any
}

// CallNode represents a component, function, helper, or system function call.
type CallNode struct {
	Name   string
	Args   []any
	Kwargs []NamedArg
}

// Kwarg looks up the last keyword argument matching key.
func (c *CallNode) Kwarg(key string) (any, bool) {
	if c == nil {
		return nil, false
	}
	for i := len(c.Kwargs) - 1; i >= 0; i-- {
		if c.Kwargs[i].Name == key {
			return c.Kwargs[i].Value, true
		}
	}
	return nil, false
}

// WithoutKwarg returns a shallow copy of c with all keyword arguments named key removed.
func (c *CallNode) WithoutKwarg(key string) (*CallNode, any, bool) {
	if c == nil {
		return nil, nil, false
	}
	var foundVal any
	found := false
	filtered := make([]NamedArg, 0, len(c.Kwargs))
	for _, kw := range c.Kwargs {
		if kw.Name == key {
			foundVal = kw.Value
			found = true
			continue
		}
		filtered = append(filtered, kw)
	}
	if !found {
		return c, nil, false
	}
	return &CallNode{
		Name:   c.Name,
		Args:   c.Args,
		Kwargs: filtered,
	}, foundVal, true
}

// CheckNode represents a validation check rule prefixed with `?` (such as `?required` or `?regex(...)`).
type CheckNode struct {
	Name string
	Args []any
}
