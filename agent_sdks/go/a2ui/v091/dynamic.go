package v091

// DynamicString represents a string that can be a literal, a data binding,
// or a function call. Exactly one field is non-nil.
type DynamicString struct {
	Literal      *string
	Binding      *DataBinding
	FunctionCall *FunctionCall
}

// StringLiteral creates a DynamicString from a literal string value.
func StringLiteral(s string) DynamicString { return DynamicString{Literal: &s} }

// StringBinding creates a DynamicString from a data model path.
func StringBinding(path string) DynamicString {
	return DynamicString{Binding: &DataBinding{Path: path}}
}

// StringFunc creates a DynamicString from a function call.
func StringFunc(call FunctionCall) DynamicString {
	return DynamicString{FunctionCall: &call}
}

// DynamicNumber represents a number that can be a literal, a data binding,
// or a function call. Exactly one field is non-nil.
type DynamicNumber struct {
	Literal      *float64
	Binding      *DataBinding
	FunctionCall *FunctionCall
}

// NumberLiteral creates a DynamicNumber from a literal float64 value.
func NumberLiteral(n float64) DynamicNumber { return DynamicNumber{Literal: &n} }

// NumberBinding creates a DynamicNumber from a data model path.
func NumberBinding(path string) DynamicNumber {
	return DynamicNumber{Binding: &DataBinding{Path: path}}
}

// NumberFunc creates a DynamicNumber from a function call.
func NumberFunc(call FunctionCall) DynamicNumber {
	return DynamicNumber{FunctionCall: &call}
}

// DynamicBoolean represents a boolean that can be a literal, a data binding,
// or a function call. Exactly one field is non-nil.
type DynamicBoolean struct {
	Literal      *bool
	Binding      *DataBinding
	FunctionCall *FunctionCall
}

// BoolLiteral creates a DynamicBoolean from a literal bool value.
func BoolLiteral(b bool) DynamicBoolean { return DynamicBoolean{Literal: &b} }

// BoolBinding creates a DynamicBoolean from a data model path.
func BoolBinding(path string) DynamicBoolean {
	return DynamicBoolean{Binding: &DataBinding{Path: path}}
}

// BoolFunc creates a DynamicBoolean from a function call.
func BoolFunc(call FunctionCall) DynamicBoolean {
	return DynamicBoolean{FunctionCall: &call}
}

// DynamicStringList represents a string list that can be a literal, a data
// binding, or a function call. Exactly one field is non-nil.
type DynamicStringList struct {
	Literal      []string
	Binding      *DataBinding
	FunctionCall *FunctionCall
}

// StringListLiteral creates a DynamicStringList from literal string values.
func StringListLiteral(ss []string) DynamicStringList {
	return DynamicStringList{Literal: ss}
}

// StringListBinding creates a DynamicStringList from a data model path.
func StringListBinding(path string) DynamicStringList {
	return DynamicStringList{Binding: &DataBinding{Path: path}}
}

// StringListFunc creates a DynamicStringList from a function call.
func StringListFunc(call FunctionCall) DynamicStringList {
	return DynamicStringList{FunctionCall: &call}
}

// DynamicValue represents a value of any type: string, number, boolean, array,
// data binding, or function call. Exactly one field is non-nil.
type DynamicValue struct {
	String       *string
	Number       *float64
	Bool         *bool
	Array        []any
	Binding      *DataBinding
	FunctionCall *FunctionCall
}

// ValueString creates a DynamicValue from a string.
func ValueString(s string) DynamicValue { return DynamicValue{String: &s} }

// ValueNumber creates a DynamicValue from a number.
func ValueNumber(n float64) DynamicValue { return DynamicValue{Number: &n} }

// ValueBool creates a DynamicValue from a boolean.
func ValueBool(b bool) DynamicValue { return DynamicValue{Bool: &b} }

// ValueArray creates a DynamicValue from an array.
func ValueArray(a []any) DynamicValue { return DynamicValue{Array: a} }

// ValueBinding creates a DynamicValue from a data model path.
func ValueBinding(path string) DynamicValue {
	return DynamicValue{Binding: &DataBinding{Path: path}}
}

// ValueFunc creates a DynamicValue from a function call.
func ValueFunc(call FunctionCall) DynamicValue {
	return DynamicValue{FunctionCall: &call}
}
