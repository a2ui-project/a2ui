# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Pytest configuration for the ADK integration tests."""

from a2ui.a2a._compat import IS_A2A_V1

# test_runner_pipeline.py drives ADK's A2A executor with the a2a-sdk 0.3 types
# (MessageSendParams, Part(root=...), TaskState.completed). The main Python CI
# job runs it on 0.3; the a2a-sdk 1.x job skips it.
collect_ignore = ["test_runner_pipeline.py"] if IS_A2A_V1 else []
