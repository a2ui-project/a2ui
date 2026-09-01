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
from typing import Any
from pydantic import BaseModel, Field, ConfigDict
from ...schema.common_types import StrictBaseModel


class Theme(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    primary_color: str | None = Field(
        None,
        alias="primaryColor",
        description=(
            "The primary brand color used for highlights (e.g., primary buttons, active"
            " borders). Renderers may generate variants of this color for different"
            " contexts. Format: Hexadecimal code (e.g., '#00BFFF')."
        ),
        pattern=r"^#[0-9a-fA-F]{6}$",
    )
    icon_url: str | None = Field(
        None,
        alias="iconUrl",
        description=(
            "A URL for an image that identifies the agent or tool associated with the"
            " surface."
        ),
    )
    agent_display_name: str | None = Field(
        None,
        alias="agentDisplayName",
        description=(
            "Text to be displayed next to the surface to identify the agent or tool"
            " that created it."
        ),
    )
