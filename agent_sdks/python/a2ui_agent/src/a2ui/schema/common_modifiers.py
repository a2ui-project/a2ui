# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


def remove_strict_validation(schema):
  if isinstance(schema, dict):
    new_schema = {k: remove_strict_validation(v) for k, v in schema.items()}
    if (
        'additionalProperties' in new_schema
        and new_schema['additionalProperties'] is False
    ):
      del new_schema['additionalProperties']
    return new_schema
  elif isinstance(schema, list):
    return [remove_strict_validation(item) for item in schema]
  return schema
