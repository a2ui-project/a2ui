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

from a2ui.core import remove_a2ui_thinking


def test_an_empty_thought_stays_empty():
    assert remove_a2ui_thinking("") == ""


def test_blank_lines_before_the_first_removed_line_stay():
    assert remove_a2ui_thinking("\n\nThe JSON is ready.\nShe wants red.") == (
        "\n\nShe wants red."
    )


def test_a_price_is_not_a_data_path():
    assert remove_a2ui_thinking("It costs $450.") == "It costs $450."
