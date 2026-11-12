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

// Package envelope names the wire keys of the component envelope mixin properties.
//
// The ComponentCommon and Checkable mixins add catalogId, metadata, accessibility,
// and checks to every flat component object. From v1.0 these keys carry an "@"
// prefix on the wire (@catalogId, @metadata, @accessibility, @checks) so they never
// collide with properties a catalog defines. Before v1.0, accessibility and checks
// are bare, and components carry no catalogId or metadata. id and component stay
// bare in every version.
//
// Writers emit the key for the protocol version. Readers of v1.0 components also
// accept the bare keys that payloads used before the cutover, unless the component
// declares a custom property of that bare name.
package envelope

// MixinNames are the bare names of the component envelope mixin properties.
var MixinNames = [...]string{"catalogId", "metadata", "accessibility", "checks"}

var atKeys = map[string]bool{
	"@catalogId":     true,
	"@metadata":      true,
	"@accessibility": true,
	"@checks":        true,
}

var mixinNames = map[string]bool{
	"catalogId":     true,
	"metadata":      true,
	"accessibility": true,
	"checks":        true,
}

// IsAtKey reports whether key is one of the @-prefixed v1.0 envelope mixin keys.
func IsAtKey(key string) bool {
	return atKeys[key]
}

// IsMixinName reports whether name is the bare name of an envelope mixin property.
func IsMixinName(name string) bool {
	return mixinNames[name]
}

// Key returns the wire key a writer uses for the envelope mixin property name:
// "@" + name from v1.0, otherwise name.
func Key(name string, atLeastV10 bool) string {
	if atLeastV10 {
		return "@" + name
	}
	return name
}

// ReadKey returns the key that holds the envelope mixin property name on component,
// and false when neither key is present.
//
// From v1.0 the @-prefixed key wins. The bare key is the legacy fallback unless
// custom names it, in which case it is an ordinary catalog property.
func ReadKey(component map[string]any, name string, atLeastV10 bool, custom map[string]bool) (string, bool) {
	if atLeastV10 {
		atKey := "@" + name
		if _, ok := component[atKey]; ok {
			return atKey, true
		}
		if custom[name] {
			return "", false
		}
	}
	if _, ok := component[name]; ok {
		return name, true
	}
	return "", false
}

// Value reads the envelope mixin property name from component, choosing the key as
// ReadKey does. It returns nil when the component does not set the property.
func Value(component map[string]any, name string, atLeastV10 bool, custom map[string]bool) any {
	if key, ok := ReadKey(component, name, atLeastV10, custom); ok {
		return component[key]
	}
	return nil
}

// IsEnvelopeKey reports whether key holds an envelope mixin property on a component.
// custom lists the bare names the component's schema declares as its own properties.
func IsEnvelopeKey(key string, atLeastV10 bool, custom map[string]bool) bool {
	if atKeys[key] {
		return atLeastV10
	}
	return mixinNames[key] && !custom[key]
}
