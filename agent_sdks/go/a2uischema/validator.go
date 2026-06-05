package a2uischema

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
	a2uiv010 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v010"
)

var (
	jsonPointerPattern         = regexp.MustCompile(`^(?:/(?:[^~/]|~[01])*)*$`)
	relativeJSONPointerPattern = regexp.MustCompile(`^(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])*)*$`)
)

// Validator validates A2UI payloads against the selected catalog and protocol rules.
type Validator struct {
	catalog           *Catalog
	allowedComponents map[string]struct{}
	allowedFunctions  map[string]struct{}
}

// NewValidator constructs a validator for a catalog.
func NewValidator(catalog *Catalog) *Validator {
	v := &Validator{
		catalog:           catalog,
		allowedComponents: make(map[string]struct{}),
		allowedFunctions:  make(map[string]struct{}),
	}
	if catalog == nil {
		return v
	}
	if components, ok := catalog.CatalogSchema[CatalogComponentsKey].(map[string]any); ok {
		for name := range components {
			v.allowedComponents[name] = struct{}{}
		}
	}
	switch functions := catalog.CatalogSchema[CatalogFunctionsKey].(type) {
	case map[string]any:
		for name := range functions {
			v.allowedFunctions[name] = struct{}{}
		}
	case []any:
		for _, item := range functions {
			name, _ := item.(map[string]any)["name"].(string)
			if name != "" {
				v.allowedFunctions[name] = struct{}{}
			}
		}
	}
	return v
}

// ParseMessages parses a single message object or an array of messages.
func (v *Validator) ParseMessages(data []byte) ([]a2ui.ServerMessage, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return nil, fmt.Errorf("schema: empty payload")
	}
	if data[0] == '[' {
		var msgs []a2ui.ServerMessage
		if err := json.Unmarshal(data, &msgs); err != nil {
			return nil, fmt.Errorf("schema: parse messages: %w", err)
		}
		return msgs, nil
	}
	var msg a2ui.ServerMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("schema: parse message: %w", err)
	}
	return []a2ui.ServerMessage{msg}, nil
}

// ValidateJSON parses and validates a raw JSON payload.
func (v *Validator) ValidateJSON(data []byte) error {
	if v.catalog != nil && v.catalog.Version == Version010 {
		msgs, err := v.parseMessagesV010(data)
		if err != nil {
			return err
		}
		return v.validateMessagesV010(msgs)
	}
	msgs, err := v.ParseMessages(data)
	if err != nil {
		return err
	}
	return v.ValidateMessages(msgs)
}

// ValidateExample validates either a raw message payload or an example file
// with a top-level messages array.
func (v *Validator) ValidateExample(data []byte) error {
	err := v.ValidateJSON(data)
	if err == nil {
		return nil
	}
	var example struct {
		Messages json.RawMessage `json:"messages"`
	}
	if json.Unmarshal(data, &example) != nil || len(bytes.TrimSpace(example.Messages)) == 0 {
		return err
	}
	return v.ValidateJSON(example.Messages)
}

// ValidateVersionMessages validates a batch of A2UI messages for any supported version.
func (v *Validator) ValidateVersionMessages(msgs any) error {
	switch msgs := msgs.(type) {
	case []a2ui.ServerMessage:
		return v.ValidateMessages(msgs)
	case []a2uiv010.ServerMessage:
		return v.validateMessagesV010(msgs)
	default:
		return fmt.Errorf("schema: unsupported messages type %T", msgs)
	}
}

// ValidateMessages validates a batch of A2UI v0.9 messages.
func (v *Validator) ValidateMessages(msgs []a2ui.ServerMessage) error {
	if len(msgs) == 0 {
		return fmt.Errorf("schema: no messages to validate")
	}
	surfaces := make(map[string]string)
	surfaceComponents := make(map[string]map[string]bool)
	for i, msg := range msgs {
		if err := v.validateMessage(msg); err != nil {
			return fmt.Errorf("schema: message[%d]: %w", i, err)
		}
		switch {
		case msg.CreateSurface != nil:
			surfaces[msg.CreateSurface.SurfaceID] = msg.CreateSurface.CatalogID
			if surfaceComponents[msg.CreateSurface.SurfaceID] == nil {
				surfaceComponents[msg.CreateSurface.SurfaceID] = make(map[string]bool)
			}
		case msg.UpdateComponents != nil:
			if catalogID, ok := surfaces[msg.UpdateComponents.SurfaceID]; ok {
				_ = catalogID
			}
			known := surfaceComponents[msg.UpdateComponents.SurfaceID]
			if err := v.validateComponents(msg.UpdateComponents.Components, known); err != nil {
				return fmt.Errorf("updateComponents: %w", err)
			}
			if known == nil {
				known = make(map[string]bool)
				surfaceComponents[msg.UpdateComponents.SurfaceID] = known
			}
			for _, component := range msg.UpdateComponents.Components {
				known[component.ID] = true
			}
		case msg.UpdateDataModel != nil:
			if err := validatePath(msg.UpdateDataModel.Path, true); err != nil {
				return fmt.Errorf("updateDataModel.path: %w", err)
			}
		}
	}
	return nil
}

func (v *Validator) validateMessage(msg a2ui.ServerMessage) error {
	wantVersion := wireVersion(v.catalog.Version)
	if msg.Version != string(wantVersion) {
		return fmt.Errorf("version = %q, want %q", msg.Version, wantVersion)
	}
	switch {
	case msg.CreateSurface != nil:
		if msg.CreateSurface.SurfaceID == "" {
			return fmt.Errorf("createSurface.surfaceId is required")
		}
		if msg.CreateSurface.CatalogID == "" {
			return fmt.Errorf("createSurface.catalogId is required")
		}
		if v.catalog != nil {
			id, err := v.catalog.ID()
			if err == nil && len(v.allowedComponents) > 0 && msg.CreateSurface.CatalogID != id {
				return fmt.Errorf("createSurface.catalogId = %q, want %q", msg.CreateSurface.CatalogID, id)
			}
		}
	case msg.UpdateComponents != nil:
		if msg.UpdateComponents.SurfaceID == "" {
			return fmt.Errorf("updateComponents.surfaceId is required")
		}
		if len(msg.UpdateComponents.Components) == 0 {
			return fmt.Errorf("updateComponents.components must not be empty")
		}
	case msg.UpdateDataModel != nil:
		if msg.UpdateDataModel.SurfaceID == "" {
			return fmt.Errorf("updateDataModel.surfaceId is required")
		}
	case msg.DeleteSurface != nil:
		if msg.DeleteSurface.SurfaceID == "" {
			return fmt.Errorf("deleteSurface.surfaceId is required")
		}
	default:
		return fmt.Errorf("message has no payload")
	}
	return nil
}

func isV09WireVersion(version Version) bool {
	return version == Version09 || version == Version091
}

func wireVersion(version Version) Version {
	if version == Version091 {
		return Version09
	}
	return version
}

func (v *Validator) validateComponents(components []a2ui.Component, known map[string]bool) error {
	ids := make(map[string]int, len(components))
	for i, component := range components {
		if err := v.validateComponent(component); err != nil {
			return fmt.Errorf("component[%d] (%s): %w", i, component.ID, err)
		}
		if _, ok := ids[component.ID]; ok {
			return validationError(ValidationDuplicateComponent, "", component.ID, "", "", fmt.Sprintf("duplicate component id %q", component.ID))
		}
		ids[component.ID] = i
	}
	graph := make(map[string][]string, len(components))
	for _, component := range components {
		refs, err := componentRefs(component)
		if err != nil {
			return fmt.Errorf("component %q: %w", component.ID, err)
		}
		graph[component.ID] = nil
		for _, ref := range refs {
			if _, ok := ids[ref]; ok {
				graph[component.ID] = append(graph[component.ID], ref)
				continue
			}
			if known != nil && known[ref] {
				continue
			}
			return validationError(ValidationUnknownComponentRef, "", component.ID, ref, "", fmt.Sprintf("component %q references unknown component %q", component.ID, ref))
		}
	}
	if _, ok := ids["root"]; !ok && len(known) == 0 {
		return validationError(ValidationMissingRootComponent, "", "root", "", "", fmt.Sprintf("components must include id %q", "root"))
	}
	if _, ok := ids["root"]; ok {
		if err := validateTopology(graph, "root"); err != nil {
			return err
		}
	}
	return nil
}

func (v *Validator) validateComponent(component a2ui.Component) error {
	if component.ID == "" {
		return fmt.Errorf("id is required")
	}
	componentType := component.ComponentType()
	if componentType == "" {
		return fmt.Errorf("exactly one concrete component type must be set")
	}
	if len(v.allowedComponents) > 0 {
		if _, ok := v.allowedComponents[componentType]; !ok {
			return validationError(ValidationUnknownComponentType, "", component.ID, "", "", fmt.Sprintf("component type %q is not allowed by the selected catalog", componentType))
		}
	}
	for _, check := range component.Checks {
		if check.Message == "" {
			return fmt.Errorf("check message is required")
		}
		if err := v.validateDynamicBoolean(check.Condition, 0); err != nil {
			return fmt.Errorf("check condition: %w", err)
		}
	}
	if component.Accessibility != nil {
		if component.Accessibility.Label != nil {
			if err := v.validateDynamicString(*component.Accessibility.Label, 0); err != nil {
				return fmt.Errorf("accessibility.label: %w", err)
			}
		}
		if component.Accessibility.Description != nil {
			if err := v.validateDynamicString(*component.Accessibility.Description, 0); err != nil {
				return fmt.Errorf("accessibility.description: %w", err)
			}
		}
	}
	switch {
	case component.Text != nil:
		return v.validateTextComponent(*component.Text)
	case component.Image != nil:
		return v.validateImageComponent(*component.Image)
	case component.Icon != nil:
		return v.validateIconComponent(*component.Icon)
	case component.Video != nil:
		return v.validateVideoComponent(*component.Video)
	case component.AudioPlayer != nil:
		return v.validateAudioPlayerComponent(*component.AudioPlayer)
	case component.Row != nil:
		return v.validateContainerChildren(component.Row.Children)
	case component.Column != nil:
		return v.validateContainerChildren(component.Column.Children)
	case component.List != nil:
		return v.validateContainerChildren(component.List.Children)
	case component.Card != nil:
		if component.Card.Child == "" {
			return fmt.Errorf("card.child is required")
		}
	case component.Tabs != nil:
		if len(component.Tabs.Tabs) == 0 {
			return fmt.Errorf("tabs.tabs must not be empty")
		}
		for _, tab := range component.Tabs.Tabs {
			if tab.Child == "" {
				return fmt.Errorf("tabs.child is required")
			}
			if err := v.validateDynamicString(tab.Title, 0); err != nil {
				return fmt.Errorf("tabs.title: %w", err)
			}
		}
	case component.Modal != nil:
		if component.Modal.Content == "" || component.Modal.Trigger == "" {
			return fmt.Errorf("modal.content and modal.trigger are required")
		}
	case component.Divider != nil:
		return nil
	case component.Button != nil:
		if component.Button.Child == "" {
			return fmt.Errorf("button.child is required")
		}
		if err := v.validateAction(component.Button.Action, 0); err != nil {
			return fmt.Errorf("button.action: %w", err)
		}
	case component.TextField != nil:
		if err := v.validateDynamicString(component.TextField.Label, 0); err != nil {
			return fmt.Errorf("textField.label: %w", err)
		}
		if component.TextField.Value != nil {
			if err := v.validateDynamicString(*component.TextField.Value, 0); err != nil {
				return fmt.Errorf("textField.value: %w", err)
			}
		}
	case component.CheckBox != nil:
		if err := v.validateDynamicString(component.CheckBox.Label, 0); err != nil {
			return fmt.Errorf("checkBox.label: %w", err)
		}
		if err := v.validateDynamicBoolean(component.CheckBox.Value, 0); err != nil {
			return fmt.Errorf("checkBox.value: %w", err)
		}
	case component.ChoicePicker != nil:
		if len(component.ChoicePicker.Options) == 0 {
			return fmt.Errorf("choicePicker.options must not be empty")
		}
		if component.ChoicePicker.Label != nil {
			if err := v.validateDynamicString(*component.ChoicePicker.Label, 0); err != nil {
				return fmt.Errorf("choicePicker.label: %w", err)
			}
		}
		for _, option := range component.ChoicePicker.Options {
			if option.Value == "" {
				return fmt.Errorf("choicePicker option value is required")
			}
			if err := v.validateDynamicString(option.Label, 0); err != nil {
				return fmt.Errorf("choicePicker option label: %w", err)
			}
		}
		if err := v.validateDynamicStringList(component.ChoicePicker.Value, 0); err != nil {
			return fmt.Errorf("choicePicker.value: %w", err)
		}
	case component.Slider != nil:
		if err := v.validateDynamicNumber(component.Slider.Value, 0); err != nil {
			return fmt.Errorf("slider.value: %w", err)
		}
		if component.Slider.Label != nil {
			if err := v.validateDynamicString(*component.Slider.Label, 0); err != nil {
				return fmt.Errorf("slider.label: %w", err)
			}
		}
	case component.DateTimeInput != nil:
		if err := v.validateDynamicString(component.DateTimeInput.Value, 0); err != nil {
			return fmt.Errorf("dateTimeInput.value: %w", err)
		}
		for name, value := range map[string]*a2ui.DynamicString{
			"label": component.DateTimeInput.Label,
			"max":   component.DateTimeInput.Max,
			"min":   component.DateTimeInput.Min,
		} {
			if value != nil {
				if err := v.validateDynamicString(*value, 0); err != nil {
					return fmt.Errorf("dateTimeInput.%s: %w", name, err)
				}
			}
		}
	}
	return nil
}

func (v *Validator) validateTextComponent(component a2ui.TextComponent) error {
	return v.validateDynamicString(component.Text, 0)
}

func (v *Validator) validateImageComponent(component a2ui.ImageComponent) error {
	if err := v.validateDynamicString(component.URL, 0); err != nil {
		return err
	}
	if component.Description != nil {
		if err := v.validateDynamicString(*component.Description, 0); err != nil {
			return err
		}
	}
	return nil
}

func (v *Validator) validateIconComponent(component a2ui.IconComponent) error {
	if component.Name.Name == nil && component.Name.SVGPath == nil && component.Name.Binding == nil {
		return fmt.Errorf("icon.name is required")
	}
	return nil
}

func (v *Validator) validateVideoComponent(component a2ui.VideoComponent) error {
	return v.validateDynamicString(component.URL, 0)
}

func (v *Validator) validateAudioPlayerComponent(component a2ui.AudioPlayerComponent) error {
	if err := v.validateDynamicString(component.URL, 0); err != nil {
		return err
	}
	if component.Description != nil {
		return v.validateDynamicString(*component.Description, 0)
	}
	return nil
}

func (v *Validator) validateContainerChildren(children a2ui.ChildList) error {
	if len(children.IDs) == 0 && children.Template == nil {
		return fmt.Errorf("children must not be empty")
	}
	if children.Template != nil {
		if children.Template.ComponentID == "" {
			return fmt.Errorf("children.template.componentId is required")
		}
		if err := validatePath(children.Template.Path, false); err != nil {
			return fmt.Errorf("children.template.path: %w", err)
		}
	}
	return nil
}

func (v *Validator) validateAction(action a2ui.Action, depth int) error {
	switch {
	case action.Event != nil && action.FunctionCall != nil:
		return fmt.Errorf("action must not have both event and functionCall")
	case action.Event != nil:
		if action.Event.Name == "" {
			return fmt.Errorf("event.name is required")
		}
		for key, value := range action.Event.Context {
			if err := v.validateDynamicValue(value, depth+1); err != nil {
				return fmt.Errorf("event.context[%q]: %w", key, err)
			}
		}
	case action.FunctionCall != nil:
		if err := v.validateFunctionCall(*action.FunctionCall, depth+1); err != nil {
			return err
		}
	default:
		return fmt.Errorf("action must have event or functionCall")
	}
	return nil
}

func (v *Validator) validateDynamicString(value a2ui.DynamicString, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCall(*value.FunctionCall, depth+1)
	default:
		return fmt.Errorf("dynamic string has no value")
	}
}

func (v *Validator) validateDynamicNumber(value a2ui.DynamicNumber, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCall(*value.FunctionCall, depth+1)
	default:
		return fmt.Errorf("dynamic number has no value")
	}
}

func (v *Validator) validateDynamicBoolean(value a2ui.DynamicBoolean, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCall(*value.FunctionCall, depth+1)
	default:
		return fmt.Errorf("dynamic boolean has no value")
	}
}

func (v *Validator) validateDynamicStringList(value a2ui.DynamicStringList, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCall(*value.FunctionCall, depth+1)
	default:
		return fmt.Errorf("dynamic string list has no value")
	}
}

func (v *Validator) validateDynamicValue(value a2ui.DynamicValue, depth int) error {
	switch {
	case value.String != nil, value.Number != nil, value.Bool != nil, value.Array != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCall(*value.FunctionCall, depth+1)
	default:
		return fmt.Errorf("dynamic value has no value")
	}
}

func (v *Validator) validateFunctionCall(call a2ui.FunctionCall, depth int) error {
	if depth > 32 {
		return fmt.Errorf("function call recursion depth exceeded")
	}
	if call.Call == "" {
		return fmt.Errorf("function call name is required")
	}
	if len(v.allowedFunctions) > 0 {
		if _, ok := v.allowedFunctions[call.Call]; !ok {
			return validationError(ValidationUnknownFunction, "", "", "", call.Call, fmt.Sprintf("unknown function %q", call.Call))
		}
	}
	for key, arg := range call.Args {
		if err := v.validateFunctionArg(arg, depth+1); err != nil {
			return fmt.Errorf("function arg %q: %w", key, err)
		}
	}
	return nil
}

func (v *Validator) validateFunctionArg(arg any, depth int) error {
	switch value := arg.(type) {
	case nil, string, bool, float64, int:
		return nil
	case []string:
		return nil
	case []any:
		for i, item := range value {
			if err := v.validateFunctionArg(item, depth+1); err != nil {
				return fmt.Errorf("[%d]: %w", i, err)
			}
		}
		return nil
	case map[string]any:
		if _, ok := value["path"]; ok {
			path, _ := value["path"].(string)
			return validatePath(path, false)
		}
		if _, ok := value["call"]; ok {
			data, err := json.Marshal(value)
			if err != nil {
				return err
			}
			var call a2ui.FunctionCall
			if err := json.Unmarshal(data, &call); err != nil {
				return err
			}
			return v.validateFunctionCall(call, depth+1)
		}
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			if err := v.validateFunctionArg(value[key], depth+1); err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
		}
		return nil
	case a2ui.DynamicValue:
		return v.validateDynamicValue(value, depth+1)
	case a2ui.DynamicString:
		return v.validateDynamicString(value, depth+1)
	case a2ui.DynamicNumber:
		return v.validateDynamicNumber(value, depth+1)
	case a2ui.DynamicBoolean:
		return v.validateDynamicBoolean(value, depth+1)
	case a2ui.DynamicStringList:
		return v.validateDynamicStringList(value, depth+1)
	default:
		return nil
	}
}

func componentRefs(component a2ui.Component) ([]string, error) {
	switch {
	case component.Button != nil:
		return []string{component.Button.Child}, nil
	case component.Card != nil:
		return []string{component.Card.Child}, nil
	case component.Column != nil:
		return childListRefs(component.Column.Children)
	case component.List != nil:
		return childListRefs(component.List.Children)
	case component.Row != nil:
		return childListRefs(component.Row.Children)
	case component.Modal != nil:
		return []string{component.Modal.Trigger, component.Modal.Content}, nil
	case component.Tabs != nil:
		refs := make([]string, 0, len(component.Tabs.Tabs))
		for _, tab := range component.Tabs.Tabs {
			refs = append(refs, tab.Child)
		}
		return refs, nil
	default:
		return nil, nil
	}
}

func childListRefs(children a2ui.ChildList) ([]string, error) {
	if children.Template != nil {
		return []string{children.Template.ComponentID}, nil
	}
	return append([]string(nil), children.IDs...), nil
}

func validateTopology(graph map[string][]string, root string) error {
	seen := make(map[string]bool, len(graph))
	stack := make(map[string]bool, len(graph))
	var visit func(string) error
	visit = func(node string) error {
		if stack[node] {
			return validationError(ValidationCycle, "", node, "", "", fmt.Sprintf("cycle detected at component %q", node))
		}
		if seen[node] {
			return nil
		}
		seen[node] = true
		stack[node] = true
		for _, child := range graph[node] {
			if err := visit(child); err != nil {
				return err
			}
		}
		delete(stack, node)
		return nil
	}
	if err := visit(root); err != nil {
		return err
	}
	if len(seen) != len(graph) {
		return validationError(ValidationOrphanedComponent, "", "", "", "", "orphaned components detected")
	}
	return nil
}

func validatePath(path string, allowEmpty bool) error {
	if path == "" {
		if allowEmpty {
			return nil
		}
		return validationError(ValidationInvalidPath, "", "", "", "", "path is required")
	}
	if path == "/" {
		return nil
	}
	if !jsonPointerPattern.MatchString(path) && !relativeJSONPointerPattern.MatchString(path) {
		return validationError(ValidationInvalidPath, path, "", "", "", fmt.Sprintf("invalid JSON Pointer %q", path))
	}
	return nil
}
