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

"""Experimental A2UI extensions and proposals."""

from __future__ import annotations

from . import a2ui_xml as a2ui_xml
from . import atom as atom
from . import elemental as elemental
from .a2ui_xml import (
    A2uiXmlCompileDiagnostics,
    A2uiXmlCompiler,
    A2uiXmlDecompiler,
    A2uiXmlFormat,
    A2uiXmlFormatFactory,
    A2uiXmlParser,
    A2uiXmlPromptGenerator,
    A2uiXmlResponseStream,
    A2uiXmlStrictViolation,
)
from .atom import AtomFormat, AtomFormatFactory, AtomParser
from .elemental import (
    ElementalFormat,
    ElementalFormatFactory,
    ElementalParser,
)

__all__ = [
    "A2uiXmlCompileDiagnostics",
    "A2uiXmlCompiler",
    "A2uiXmlDecompiler",
    "A2uiXmlFormat",
    "A2uiXmlFormatFactory",
    "A2uiXmlParser",
    "A2uiXmlPromptGenerator",
    "A2uiXmlResponseStream",
    "A2uiXmlStrictViolation",
    "AtomFormat",
    "AtomFormatFactory",
    "AtomParser",
    "ElementalFormat",
    "ElementalFormatFactory",
    "ElementalParser",
    "a2ui_xml",
    "atom",
    "elemental",
]
