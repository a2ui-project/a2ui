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


class Styles(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    font: str | None = Field(None, description="The primary font for the UI.")
    primary_color: str | None = Field(
        None,
        alias="primaryColor",
        description="The primary UI color as a hexadecimal code (e.g., '#00BFFF').",
        pattern=r"^#[0-9a-fA-F]{6}$",
    )


Theme = Styles
