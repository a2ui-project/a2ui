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

from a2ui.core.catalog import (
    Catalog as Catalog,
    CatalogApi as CatalogApi,
    get_agent_to_renderer_schema_json as get_agent_to_renderer_schema_json,
    get_agent_to_renderer_schema_map as get_agent_to_renderer_schema_map,
    get_common_types_schema_json as get_common_types_schema_json,
    get_common_types_schema_map as get_common_types_schema_map,
    inline_local_refs as inline_local_refs,
    is_valid_uax31_identifier as is_valid_uax31_identifier,
)
from a2ui.core.exceptions import (
    A2uiCatalogError as A2uiCatalogError,
    A2uiDataError as A2uiDataError,
    A2uiError as A2uiError,
    A2uiErrorDetail as A2uiErrorDetail,
    A2uiExpressionError as A2uiExpressionError,
    A2uiIntegrityError as A2uiIntegrityError,
    A2uiParseError as A2uiParseError,
    A2uiRecursionError as A2uiRecursionError,
    A2uiRpcError as A2uiRpcError,
    A2uiStateError as A2uiStateError,
    A2uiValidationError as A2uiValidationError,
    RpcErrorCode as RpcErrorCode,
)
from a2ui.core.processing import (
    CapabilitiesOptions as CapabilitiesOptions,
    ExecutionContext as ExecutionContext,
    MessageProcessor as MessageProcessor,
    MessageProcessorOptions as MessageProcessorOptions,
)
from a2ui.core.resolution import DataContext as DataContext
from a2ui.core.rpc import CallOptions as CallOptions, RpcHandler as RpcHandler
from a2ui.core.schema import (
    A2uiRendererCapabilities as A2uiRendererCapabilities,
)
from a2ui.core.state import (
    ComponentModel as ComponentModel,
    DataModel as DataModel,
    SurfaceModel as SurfaceModel,
)
from a2ui.core.validation import (
    PayloadValidator as PayloadValidator,
    RELAXED_VALIDATION as RELAXED_VALIDATION,
    STRICT_VALIDATION as STRICT_VALIDATION,
    ValidationConfig as ValidationConfig,
)
from a2ui.core.version import __version__ as __version__

__all__ = [
    "A2uiCatalogError",
    "A2uiDataError",
    "A2uiError",
    "A2uiErrorDetail",
    "A2uiExpressionError",
    "A2uiIntegrityError",
    "A2uiParseError",
    "A2uiRecursionError",
    "A2uiRendererCapabilities",
    "A2uiRpcError",
    "A2uiStateError",
    "A2uiValidationError",
    "CallOptions",
    "CapabilitiesOptions",
    "Catalog",
    "CatalogApi",
    "ComponentModel",
    "DataContext",
    "DataModel",
    "ExecutionContext",
    "MessageProcessor",
    "MessageProcessorOptions",
    "PayloadValidator",
    "RELAXED_VALIDATION",
    "RpcErrorCode",
    "RpcHandler",
    "STRICT_VALIDATION",
    "SurfaceModel",
    "ValidationConfig",
    "__version__",
    "get_agent_to_renderer_schema_json",
    "get_agent_to_renderer_schema_map",
    "get_common_types_schema_json",
    "get_common_types_schema_map",
    "inline_local_refs",
    "is_valid_uax31_identifier",
]
