package v010

import (
	"encoding/json"
	"fmt"
)

// MarshalJSON implements json.Marshaler for Theme.
func (t Theme) MarshalJSON() ([]byte, error) {
	fields := make(map[string]any, len(t.AdditionalProperties)+3)
	for k, v := range t.AdditionalProperties {
		fields[k] = v
	}
	if t.PrimaryColor != "" {
		fields["primaryColor"] = t.PrimaryColor
	}
	if t.IconURL != "" {
		fields["iconUrl"] = t.IconURL
	}
	if t.AgentDisplayName != "" {
		fields["agentDisplayName"] = t.AgentDisplayName
	}
	return json.Marshal(fields)
}

// UnmarshalJSON implements json.Unmarshaler for Theme.
func (t *Theme) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("a2ui: unmarshal theme: %w", err)
	}
	*t = Theme{}
	for key, raw := range fields {
		switch key {
		case "primaryColor":
			if err := json.Unmarshal(raw, &t.PrimaryColor); err != nil {
				return fmt.Errorf("a2ui: unmarshal theme.primaryColor: %w", err)
			}
		case "iconUrl":
			if err := json.Unmarshal(raw, &t.IconURL); err != nil {
				return fmt.Errorf("a2ui: unmarshal theme.iconUrl: %w", err)
			}
		case "agentDisplayName":
			if err := json.Unmarshal(raw, &t.AgentDisplayName); err != nil {
				return fmt.Errorf("a2ui: unmarshal theme.agentDisplayName: %w", err)
			}
		default:
			if t.AdditionalProperties == nil {
				t.AdditionalProperties = make(map[string]any)
			}
			var value any
			if err := json.Unmarshal(raw, &value); err != nil {
				return fmt.Errorf("a2ui: unmarshal theme.%s: %w", key, err)
			}
			t.AdditionalProperties[key] = value
		}
	}
	return nil
}

// MarshalJSON implements json.Marshaler for ChildList.
func (c ChildList) MarshalJSON() ([]byte, error) {
	if c.Template != nil && c.IDs != nil {
		return nil, fmt.Errorf("a2ui: ChildList has both ids and template set")
	}
	switch {
	case c.Template != nil:
		return json.Marshal(c.Template)
	case c.IDs != nil:
		return json.Marshal(c.IDs)
	default:
		return []byte("[]"), nil
	}
}

// UnmarshalJSON implements json.Unmarshaler for ChildList.
func (c *ChildList) UnmarshalJSON(data []byte) error {
	*c = ChildList{}
	var ids []string
	if err := json.Unmarshal(data, &ids); err == nil {
		c.IDs = ids
		return nil
	}
	var t ChildTemplate
	if err := json.Unmarshal(data, &t); err != nil {
		return fmt.Errorf("a2ui: unmarshal child list: %w", err)
	}
	c.Template = &t
	return nil
}

// MarshalJSON implements json.Marshaler for Action.
func (a Action) MarshalJSON() ([]byte, error) {
	type actionAlias Action
	switch countSet(a.Event != nil, a.FunctionCall != nil) {
	case 1:
		return json.Marshal(actionAlias(a))
	case 0:
		return nil, fmt.Errorf("a2ui: Action has no value set")
	default:
		return nil, fmt.Errorf("a2ui: Action has multiple values set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for Action.
func (a *Action) UnmarshalJSON(data []byte) error {
	type actionAlias Action
	var aa actionAlias
	if err := json.Unmarshal(data, &aa); err != nil {
		return fmt.Errorf("a2ui: unmarshal action: %w", err)
	}
	switch countSet(aa.Event != nil, aa.FunctionCall != nil) {
	case 1:
		*a = Action(aa)
		return nil
	case 0:
		return fmt.Errorf("a2ui: action must have event or functionCall")
	default:
		return fmt.Errorf("a2ui: action must not have both event and functionCall")
	}
}

// MarshalJSON implements json.Marshaler for IconNameOrPath.
func (i IconNameOrPath) MarshalJSON() ([]byte, error) {
	switch countSet(i.Name != nil, i.Path != nil) {
	case 1:
		switch {
		case i.Name != nil:
			return json.Marshal(string(*i.Name))
		case i.Path != nil:
			return json.Marshal(struct {
				Path string `json:"path"`
			}{Path: *i.Path})
		}
	case 0:
		return nil, fmt.Errorf("a2ui: IconNameOrPath has no value set")
	default:
		return nil, fmt.Errorf("a2ui: IconNameOrPath has multiple values set")
	}
	return nil, fmt.Errorf("a2ui: IconNameOrPath has no value set")
}

// UnmarshalJSON implements json.Unmarshaler for IconNameOrPath.
func (i *IconNameOrPath) UnmarshalJSON(data []byte) error {
	*i = IconNameOrPath{}
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		name := IconName(s)
		i.Name = &name
		return nil
	}
	var obj struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(data, &obj); err != nil {
		return fmt.Errorf("a2ui: unmarshal icon name or path: %w", err)
	}
	if obj.Path == "" {
		return fmt.Errorf("a2ui: icon path must not be empty")
	}
	i.Path = &obj.Path
	return nil
}

func countSet(values ...bool) int {
	var count int
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}
