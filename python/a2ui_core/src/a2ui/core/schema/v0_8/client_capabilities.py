# Copyright 2024 Google LLC
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

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict
from .common_types import StrictBaseModel
from .constants import SPEC_VERSION, SPEC_VERSION_TYPE


class InlineCatalog(BaseModel):
    model_config = ConfigDict(extra="allow")


Catalog = InlineCatalog


class FunctionDefinition(BaseModel):
    model_config = ConfigDict(extra="allow")


class V08Capabilities(StrictBaseModel):
    pass


V0_8Capabilities = V08Capabilities


class A2uiRendererCapabilities(StrictBaseModel):
    v0_8: Optional[V08Capabilities] = Field(None, alias=SPEC_VERSION)


A2uiClientCapabilities = A2uiRendererCapabilities
