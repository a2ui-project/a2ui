package v010

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// MarshalJSON implements json.Marshaler for DynamicString.
func (d DynamicString) MarshalJSON() ([]byte, error) {
	if count := countSet(d.Literal != nil, d.Binding != nil, d.FunctionCall != nil); count > 1 {
		return nil, fmt.Errorf("a2ui: DynamicString has multiple values set")
	}
	switch {
	case d.Literal != nil:
		return json.Marshal(*d.Literal)
	case d.Binding != nil:
		return json.Marshal(d.Binding)
	case d.FunctionCall != nil:
		return json.Marshal(d.FunctionCall)
	default:
		return nil, fmt.Errorf("a2ui: DynamicString has no value set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for DynamicString.
func (d *DynamicString) UnmarshalJSON(data []byte) error {
	*d = DynamicString{}
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		d.Literal = &s
		return nil
	}
	return unmarshalBindingOrFunc(data, &d.Binding, &d.FunctionCall)
}

// MarshalJSON implements json.Marshaler for DynamicNumber.
func (d DynamicNumber) MarshalJSON() ([]byte, error) {
	if count := countSet(d.Literal != nil, d.Binding != nil, d.FunctionCall != nil); count > 1 {
		return nil, fmt.Errorf("a2ui: DynamicNumber has multiple values set")
	}
	switch {
	case d.Literal != nil:
		return json.Marshal(*d.Literal)
	case d.Binding != nil:
		return json.Marshal(d.Binding)
	case d.FunctionCall != nil:
		return json.Marshal(d.FunctionCall)
	default:
		return nil, fmt.Errorf("a2ui: DynamicNumber has no value set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for DynamicNumber.
func (d *DynamicNumber) UnmarshalJSON(data []byte) error {
	*d = DynamicNumber{}
	var n float64
	if err := json.Unmarshal(data, &n); err == nil {
		d.Literal = &n
		return nil
	}
	return unmarshalBindingOrFunc(data, &d.Binding, &d.FunctionCall)
}

// MarshalJSON implements json.Marshaler for DynamicBoolean.
func (d DynamicBoolean) MarshalJSON() ([]byte, error) {
	if count := countSet(d.Literal != nil, d.Binding != nil, d.FunctionCall != nil); count > 1 {
		return nil, fmt.Errorf("a2ui: DynamicBoolean has multiple values set")
	}
	switch {
	case d.Literal != nil:
		return json.Marshal(*d.Literal)
	case d.Binding != nil:
		return json.Marshal(d.Binding)
	case d.FunctionCall != nil:
		return json.Marshal(d.FunctionCall)
	default:
		return nil, fmt.Errorf("a2ui: DynamicBoolean has no value set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for DynamicBoolean.
func (d *DynamicBoolean) UnmarshalJSON(data []byte) error {
	*d = DynamicBoolean{}
	var b bool
	if err := json.Unmarshal(data, &b); err == nil {
		d.Literal = &b
		return nil
	}
	return unmarshalBindingOrFunc(data, &d.Binding, &d.FunctionCall)
}

// MarshalJSON implements json.Marshaler for DynamicStringList.
func (d DynamicStringList) MarshalJSON() ([]byte, error) {
	if count := countSliceValues(d.Literal != nil, d.Binding != nil, d.FunctionCall != nil); count > 1 {
		return nil, fmt.Errorf("a2ui: DynamicStringList has multiple values set")
	}
	switch {
	case d.Literal != nil:
		return json.Marshal(d.Literal)
	case d.Binding != nil:
		return json.Marshal(d.Binding)
	case d.FunctionCall != nil:
		return json.Marshal(d.FunctionCall)
	default:
		return nil, fmt.Errorf("a2ui: DynamicStringList has no value set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for DynamicStringList.
func (d *DynamicStringList) UnmarshalJSON(data []byte) error {
	*d = DynamicStringList{}
	var ss []string
	if err := json.Unmarshal(data, &ss); err == nil {
		d.Literal = ss
		return nil
	}
	return unmarshalBindingOrFunc(data, &d.Binding, &d.FunctionCall)
}

// MarshalJSON implements json.Marshaler for DynamicValue.
func (d DynamicValue) MarshalJSON() ([]byte, error) {
	if count := countDynamicValueFields(d); count > 1 {
		return nil, fmt.Errorf("a2ui: DynamicValue has multiple values set")
	}
	switch {
	case d.String != nil:
		return json.Marshal(*d.String)
	case d.Number != nil:
		return json.Marshal(*d.Number)
	case d.Bool != nil:
		return json.Marshal(*d.Bool)
	case d.Array != nil:
		return json.Marshal(d.Array)
	case d.Binding != nil:
		return json.Marshal(d.Binding)
	case d.FunctionCall != nil:
		return json.Marshal(d.FunctionCall)
	default:
		return nil, fmt.Errorf("a2ui: DynamicValue has no value set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for DynamicValue.
func (d *DynamicValue) UnmarshalJSON(data []byte) error {
	*d = DynamicValue{}
	data = bytes.TrimSpace(data)
	// Try string.
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		d.String = &s
		return nil
	}
	// Try bool (before number, since Go's json decoder doesn't confuse them,
	// but we check bool first for clarity).
	var b bool
	if err := json.Unmarshal(data, &b); err == nil {
		if len(data) > 0 && (data[0] == 't' || data[0] == 'f') {
			d.Bool = &b
			return nil
		}
	}
	// Try number.
	var n float64
	if err := json.Unmarshal(data, &n); err == nil {
		d.Number = &n
		return nil
	}
	// Try array.
	var arr []any
	if err := json.Unmarshal(data, &arr); err == nil {
		d.Array = arr
		return nil
	}
	// Must be an object: binding or function call.
	return unmarshalBindingOrFunc(data, &d.Binding, &d.FunctionCall)
}

// unmarshalBindingOrFunc tries to unmarshal data as a DataBinding (has "path"
// key) or a FunctionCall (has "call" key).
func unmarshalBindingOrFunc(data []byte, binding **DataBinding, fn **FunctionCall) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return fmt.Errorf("a2ui: cannot unmarshal dynamic value: %w", err)
	}
	if _, ok := obj["path"]; ok {
		if _, ok := obj["call"]; ok {
			return fmt.Errorf("a2ui: object cannot be both a data binding and a function call")
		}
		var db DataBinding
		if err := json.Unmarshal(data, &db); err != nil {
			return fmt.Errorf("a2ui: unmarshal data binding: %w", err)
		}
		*binding = &db
		return nil
	}
	if _, ok := obj["call"]; ok {
		var fc FunctionCall
		if err := json.Unmarshal(data, &fc); err != nil {
			return fmt.Errorf("a2ui: unmarshal function call: %w", err)
		}
		*fn = &fc
		return nil
	}
	return fmt.Errorf("a2ui: object is neither a data binding nor a function call")
}

func countSliceValues(values ...bool) int {
	var count int
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}

func countDynamicValueFields(d DynamicValue) int {
	var count int
	if d.String != nil {
		count++
	}
	if d.Number != nil {
		count++
	}
	if d.Bool != nil {
		count++
	}
	if d.Array != nil {
		count++
	}
	if d.Binding != nil {
		count++
	}
	if d.FunctionCall != nil {
		count++
	}
	return count
}
