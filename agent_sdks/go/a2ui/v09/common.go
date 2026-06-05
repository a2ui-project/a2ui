package v09

// DataBinding references a value in the client data model by JSON Pointer path.
type DataBinding struct {
	Path string `json:"path"`
}

// FunctionCall invokes a named client-side function.
type FunctionCall struct {
	Call       string         `json:"call"`
	Args       map[string]any `json:"args,omitempty"`
	ReturnType ReturnType     `json:"returnType,omitempty"`
}

// ChildList is either a static list of component IDs or a dynamic template.
// Exactly one of IDs or Template is set.
type ChildList struct {
	IDs      []string
	Template *ChildTemplate
}

// ChildTemplate generates a dynamic list of children from a data model list.
type ChildTemplate struct {
	ComponentID string `json:"componentId"`
	Path        string `json:"path"`
}

// CheckRule is a single validation rule applied to an input component.
type CheckRule struct {
	Condition DynamicBoolean `json:"condition"`
	Message   string         `json:"message"`
}

// AccessibilityAttributes enhance accessibility for assistive technologies.
type AccessibilityAttributes struct {
	Label       *DynamicString `json:"label,omitempty"`
	Description *DynamicString `json:"description,omitempty"`
}

// Theme defines visual theming for a surface.
type Theme struct {
	PrimaryColor         string         `json:"primaryColor,omitempty"`
	IconURL              string         `json:"iconUrl,omitempty"`
	AgentDisplayName     string         `json:"agentDisplayName,omitempty"`
	AdditionalProperties map[string]any `json:"-"`
}

// Action is an interaction handler that either triggers a server-side event
// or executes a client-side function. Exactly one field is non-nil.
type Action struct {
	Event        *EventAction  `json:"event,omitempty"`
	FunctionCall *FunctionCall `json:"functionCall,omitempty"`
}

// EventAction triggers a server-side event.
type EventAction struct {
	Name    string                  `json:"name"`
	Context map[string]DynamicValue `json:"context,omitempty"`
}

// IconNameOrPath is a well-known icon name, custom SVG path, or binding.
// Exactly one field is non-nil.
type IconNameOrPath struct {
	Name    *IconName
	SVGPath *string
	Binding *DataBinding
}
