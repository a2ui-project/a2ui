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
)
from a2ui.core.common import (
    assert_uax31_identifier as assert_uax31_identifier,
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
    ExecutionContext as ExecutionContext,
    MessageProcessor as MessageProcessor,
    MessageProcessorOptions as MessageProcessorOptions,
)
from a2ui.core.rpc import CallOptions as CallOptions, RpcHandler as RpcHandler
from a2ui.core.state import (
    DataModel as DataModel,
    SurfaceComponentsModel as SurfaceComponentsModel,
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
    "A2uiRpcError",
    "A2uiStateError",
    "A2uiValidationError",
    "CallOptions",
    "Catalog",
    "DataModel",
    "ExecutionContext",
    "MessageProcessor",
    "MessageProcessorOptions",
    "PayloadValidator",
    "RELAXED_VALIDATION",
    "RpcErrorCode",
    "RpcHandler",
    "STRICT_VALIDATION",
    "SurfaceComponentsModel",
    "SurfaceModel",
    "ValidationConfig",
    "__version__",
    "assert_uax31_identifier",
    "is_valid_uax31_identifier",
]
