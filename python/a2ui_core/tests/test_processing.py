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

from typing import Any, Literal
from pydantic import BaseModel, Field
import pytest

from a2ui.core.catalog import (
    Catalog,
    ComponentApi,
    FunctionImplementation,
    ModelComponentApi,
)
from a2ui.core.processing import (
    CapabilitiesOptions,
    MessageProcessor,
    MessageProcessorOptions,
)
from a2ui.core.resolution import (
    ComponentContext,
    DataContext,
    GenericBinder,
    MissingDataBindingWarning,
)
from a2ui.core.rpc import CallOptions
from a2ui.core.schema.v0_9.constants import PROTOCOL_VERSION
from a2ui.core.schema.v1_0.common_types import FunctionCall
from a2ui.core.validation import STRICT_VALIDATION


@pytest.fixture
def mock_catalog():
    class MockCatalog:

        def __init__(self):
            self.protocol_version = PROTOCOL_VERSION
            self.version = PROTOCOL_VERSION
            self.catalog_id = "https://a2ui.org/mock.json"
            self.validation_schema = {"components": {}}
            self.single_refs = set()
            self.list_refs = set()

        @property
        def id(self) -> str:
            return self.catalog_id

        def validate_components(self, components):
            pass

        def validate_theme(self, theme):
            pass

    return MockCatalog()


def test_message_processor_multi_catalog_surface_propagation():
    cat1 = Catalog(catalog_id="cat1", protocol_version="v1.0", components=[])
    cat2 = Catalog(catalog_id="cat2", protocol_version="v1.0", components=[])
    processor = MessageProcessor(catalogs=[cat1, cat2])

    create_msg = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "surface_multi",
            "catalogId": "cat1",
        },
    }
    processor.process_messages([create_msg])

    surface = processor.model.get_surface("surface_multi")
    assert surface is not None
    assert surface.available_catalogs == {"cat1": cat1, "cat2": cat2}


def test_message_processor_get_renderer_capabilities_requires_options(
    mock_catalog,
):
    processor = MessageProcessor(catalogs=[mock_catalog])

    with pytest.raises(TypeError):
        CapabilitiesOptions()  # type: ignore[call-arg]

    with pytest.raises(TypeError):
        processor.get_renderer_capabilities()  # type: ignore[call-arg]


def test_message_processor_missing_data_model_path_reactive_binding(
    mock_catalog,
):
    processor = MessageProcessor(catalogs=[mock_catalog])

    processor.process_messages([
        {
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": mock_catalog.catalog_id,
            },
        },
        {
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": {"path": "/missing/username"},
                }],
            },
        },
    ])

    surface = processor.model.get_surface("s1")
    assert surface is not None
    text_comp = surface.components_model.get("root")
    assert text_comp is not None

    ctx = DataContext(surface, path="/")
    context = ComponentContext(text_comp, ctx)

    with pytest.warns(MissingDataBindingWarning):
        binder = GenericBinder(context)
        text_val = binder.current_props.get("text")
        assert text_val is None

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "updateDataModel": {
            "surfaceId": "s1",
            "path": "/missing/username",
            "value": "Alice",
        },
    }])

    assert binder.current_props.get("text") == "Alice"
    binder.dispose()


def test_message_processor_custom_catalog_component_validation():
    class ChartComponent(BaseModel):
        id: str
        component: Literal["Chart"] = "Chart"
        title: str = Field(..., description="Chart title.")
        value: float = Field(..., description="Chart numeric value.")

    class CustomCatalog(Catalog):

        def __init__(self):
            super().__init__(
                catalog_id="https://rizzcharts.com/catalog.json",
                protocol_version=PROTOCOL_VERSION,
                components=[ModelComponentApi(ChartComponent, "Chart")],
                functions=[],
            )

    catalog = CustomCatalog()
    processor = MessageProcessor(
        catalogs=[catalog],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }])

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{
                "id": "root",
                "component": "Chart",
                "title": "Sales",
                "value": 45.6,
            }],
        },
    }])

    surface = processor.model.get_surface("s1")
    assert surface is not None
    chart_comp = surface.components_model.get("root")
    assert chart_comp is not None
    assert chart_comp.properties.get("title") == "Sales"
    assert chart_comp.properties.get("value") == 45.6

    with pytest.raises(
        ValueError,
        match=(
            r"Validation failed for component 'Chart': (?:\[value\] Field"
            r" required|components.root: 'value' is a required property)"
        ),
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Chart", "title": "Sales"}],
            },
        }])


def test_message_processor_empty_catalogs_throws():
    with pytest.raises(ValueError, match="At least one catalog must be provided"):
        MessageProcessor(catalogs=[])


def test_message_processor_pydantic_model_payload(mock_catalog):
    from a2ui.core.schema.v0_9.server_to_client import (
        CreateSurface,
        CreateSurfaceMessage,
    )

    processor = MessageProcessor(catalogs=[mock_catalog])
    msg = CreateSurfaceMessage(
        create_surface=CreateSurface(
            surface_id="surface_pydantic",
            catalog_id=mock_catalog.catalog_id,
            send_data_model=True,
        )
    )
    processor.process_messages(msg)
    surface = processor.model.get_surface("surface_pydantic")
    assert surface is not None
    assert surface.id == "surface_pydantic"
    assert surface.send_data_model is True


def test_version_adapter_factory_unsupported_version_raises_validation_error():
    from a2ui.core.exceptions import A2uiValidationError
    from a2ui.core.processing.adapters import VersionAdapterFactory

    # Unparseable/unsupported version string in payload must raise A2uiValidationError
    with pytest.raises(
        A2uiValidationError, match="Unsupported protocol version 'v9999.0'"
    ):
        VersionAdapterFactory.resolve_from_payload(
            [{"version": "v9999.0", "createSurface": {}}]
        )

    with pytest.raises(
        A2uiValidationError, match="Unsupported protocol version 'invalid_ver'"
    ):
        VersionAdapterFactory.resolve_from_payload({"version": "invalid_ver"})


def test_message_processor_rpc_error_handling(mock_catalog):
    from a2ui.core.exceptions import A2uiRpcError

    options = MessageProcessorOptions(outbound_listener=lambda msg: None)
    processor = MessageProcessor(catalogs=[mock_catalog], options=options)
    fut = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="someFunc"),
        options=CallOptions(function_call_id="call_123"),
    )
    processor.process_messages([{
        "version": "v1.0",
        "agentFunctionResponse": {
            "functionCallId": "call_123",
            "error": {"code": "INVALID_PARAMS", "message": "Missing param"},
        },
    }])
    assert fut.done()
    with pytest.raises(A2uiRpcError) as exc_info:
        fut.result()
    assert exc_info.value.code == "INVALID_PARAMS"
    assert exc_info.value.function_call_id == "call_123"
    assert "Agent function error [INVALID_PARAMS]: Missing param" in str(exc_info.value)


@pytest.mark.asyncio
async def test_message_processor_call_renderer_function_async_coroutine():
    from a2ui.core.basic_catalog import v1_0

    cat = v1_0.BasicCatalog()

    async def async_fn(
        args: dict[str, Any], context: Any = None, abort_signal: Any = None
    ) -> str:
        return f"Hello {args.get('name', 'world')}"

    fn_impl = FunctionImplementation(
        name="asyncUrl",
        execute=async_fn,
        allowed_callers="rendererOrAgent",
    )
    cat.functions["asyncUrl"] = fn_impl

    processor = MessageProcessor(catalogs=[cat])
    resp = await processor.process_messages_async([{
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "async_call_1",
            "callFunction": {"call": "asyncUrl", "args": {}},
        },
    }])
    assert len(resp) == 1
    assert resp[0]["rendererFunctionResponse"]["functionCallId"] == "async_call_1"


def test_message_processor_disposal_cancels_pending_calls(mock_catalog):
    from a2ui.core.exceptions import A2uiRpcError, RpcErrorCode

    options = MessageProcessorOptions(outbound_listener=lambda msg: None)
    processor = MessageProcessor(catalogs=[mock_catalog], options=options)
    fut1 = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="func1"),
        options=CallOptions(function_call_id="call_1"),
    )
    fut2 = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="func2"),
        options=CallOptions(function_call_id="call_2"),
    )

    processor.rpc.dispose("Surface closed")
    assert processor.rpc.disposed is True
    assert fut1.done()
    assert fut2.done()
    with pytest.raises(A2uiRpcError) as exc_info:
        fut1.result()
    assert exc_info.value.code == RpcErrorCode.CANCELLED.value
    assert exc_info.value.function_call_id == "call_1"
    assert "Surface closed" in str(exc_info.value)


def test_a2ui_rpc_error_requires_function_call_id():
    from a2ui.core.exceptions import A2uiRpcError, RpcErrorCode

    err = A2uiRpcError(
        "Execution failed",
        function_call_id="fc_42",
        code=RpcErrorCode.EXECUTION_ERROR,
    )
    assert err.function_call_id == "fc_42"
    assert err.code == RpcErrorCode.EXECUTION_ERROR
    assert str(err) == "Execution failed"


@pytest.mark.asyncio
async def test_message_processor_call_agent_function(mock_catalog):
    outbound_msgs = []
    options = MessageProcessorOptions(
        outbound_listener=lambda msg: outbound_msgs.append(msg)
    )
    processor = MessageProcessor(catalogs=[mock_catalog], options=options)

    future = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(
            call="submitForm",
            catalogId="https://a2ui.org/mock.json",
            args={"field": "value"},
        ),
        options=CallOptions(function_call_id="call_proc_1"),
    )

    assert len(outbound_msgs) == 1
    assert outbound_msgs[0]["callAgentFunction"]["functionCallId"] == "call_proc_1"

    processor.process_messages([{
        "version": "v1.0",
        "agentFunctionResponse": {
            "functionCallId": "call_proc_1",
            "value": {"status": "ok"},
        },
    }])

    result = await future
    assert result == {"status": "ok"}


def test_message_processor_options(mock_catalog):
    outbound_msgs = []
    options = MessageProcessorOptions(
        validation_config=STRICT_VALIDATION,
        outbound_listener=lambda msg: outbound_msgs.append(msg),
        default_timeout_ms=10000.0,
    )
    processor = MessageProcessor(catalogs=[mock_catalog], options=options)

    assert processor.validation_config == STRICT_VALIDATION
    assert processor.rpc.default_timeout_ms == 10000.0


@pytest.mark.asyncio
async def test_message_processor_process_operation_async():
    from a2ui.core.basic_catalog import v1_0
    from a2ui.core.processing.operations import (
        InternalCallRendererFunctionOp,
        InternalCreateSurfaceOp,
    )

    cat = v1_0.BasicCatalog()

    def test_fn(
        args: dict[str, Any], context: Any = None, abort_signal: Any = None
    ) -> str:
        return "res"

    cat.functions["testFunc"] = FunctionImplementation(
        name="testFunc",
        execute=test_fn,
        allowed_callers="rendererOrAgent",
    )
    processor = MessageProcessor(catalogs=[cat])

    # 1. State op returns None
    create_op = InternalCreateSurfaceOp(surface_id="s_async", catalog_id=cat.catalog_id)
    res1 = await processor.process_operation_async(create_op)
    assert res1 is None
    assert "s_async" in processor.model.surfaces

    # 2. RPC op returns response dictionary
    rpc_op = InternalCallRendererFunctionOp(
        version="v1.0",
        function_call_id="call_async_1",
        call="testFunc",
        catalog_id=cat.catalog_id,
        args={},
    )
    res2 = await processor.process_operation_async(rpc_op)
    assert res2 is not None
    assert res2["rendererFunctionResponse"]["functionCallId"] == "call_async_1"
    assert res2["rendererFunctionResponse"]["value"] == "res"


def test_message_processor_component_catalog_change_recreates():
    cat_a = Catalog(
        catalog_id="cat_a",
        protocol_version="v1.0",
        components=[ComponentApi(name="Box", schema={"type": "object"})],
    )
    cat_b = Catalog(
        catalog_id="cat_b",
        protocol_version="v1.0",
        components=[ComponentApi(name="Box", schema={"type": "object"})],
    )
    processor = MessageProcessor(catalogs=[cat_a, cat_b])
    processor.process_messages([{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": "cat_a",
            "components": [{"id": "c1", "component": "Box", "catalogId": "cat_a"}],
        },
    }])
    surface = processor.model.get_surface("s1")
    assert surface is not None
    original_comp = surface.components_model.get("c1")
    assert original_comp is not None
    assert original_comp.catalog is cat_a

    events: list[str] = []
    surface.components_model.on_deleted.subscribe(
        lambda cid: events.append(f"del_{cid}")
    )
    surface.components_model.on_created.subscribe(
        lambda c: events.append(f"create_{c.id}")
    )

    # Update component with different catalogId
    processor.process_messages([{
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "c1", "component": "Box", "catalogId": "cat_b"}],
        },
    }])
    updated_comp = surface.components_model.get("c1")
    assert updated_comp is not None
    assert updated_comp.catalog is cat_b
    assert updated_comp is not original_comp
    assert events == ["del_c1", "create_c1"]


def test_create_surface_data_model_before_components_avoids_warning():
    import warnings
    from a2ui.core.basic_catalog.v1_0 import BasicCatalog as BasicCatalogV10

    processor = MessageProcessor(catalogs=[BasicCatalogV10()])
    with warnings.catch_warnings(record=True) as recorded_warnings:
        warnings.simplefilter("always")
        processor.process_messages([{
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s_ordered",
                "dataModel": {"userName": "Alice"},
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": {"path": "/userName"},
                }],
            },
        }])

    missing_warnings = [
        w
        for w in recorded_warnings
        if issubclass(w.category, MissingDataBindingWarning)
    ]
    assert len(missing_warnings) == 0

    surface = processor.model.get_surface("s_ordered")
    assert surface is not None
    assert surface.data_model.get("/userName") == "Alice"


def test_v1_0_adapter_drops_theme_from_create_surface():
    from a2ui.core.processing.adapters.v1_0 import V1Point0Adapter
    from a2ui.core.processing.operations import InternalCreateSurfaceOp

    adapter = V1Point0Adapter()
    ops = adapter.extract_operations({
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s_v1",
            "catalogId": "basic",
        },
    })
    create_op = next(
        (op for op in ops if isinstance(op, InternalCreateSurfaceOp)), None
    )
    assert create_op is not None
    assert create_op.theme is None

    # Even if raw message dict has theme, v1.0 adapter ignores it
    raw_ops = adapter._extract_operations_for_action(
        "createSurface",
        {
            "createSurface": {
                "surfaceId": "s_v1",
                "catalogId": "basic",
                "theme": {"primaryColor": "#ff0000"},
            }
        },
    )
    assert raw_ops[0].theme is None


def test_message_processor_component_partial_update_preserves_catalog_when_omitted():
    cat_a = Catalog(
        catalog_id="cat_a",
        protocol_version="v1.0",
        components=[ComponentApi(name="Box", schema={"type": "object"})],
    )
    cat_b = Catalog(
        catalog_id="cat_b",
        protocol_version="v1.0",
        components=[ComponentApi(name="Box", schema={"type": "object"})],
    )
    processor = MessageProcessor(catalogs=[cat_a, cat_b])
    processor.process_messages([{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": "cat_a",
            "components": [{"id": "c1", "component": "Box", "catalogId": "cat_b"}],
        },
    }])
    surface = processor.model.get_surface("s1")
    assert surface is not None
    original_comp = surface.components_model.get("c1")
    assert original_comp is not None
    assert original_comp.catalog is cat_b

    events: list[str] = []
    surface.components_model.on_deleted.subscribe(
        lambda cid: events.append(f"del_{cid}")
    )
    surface.components_model.on_created.subscribe(
        lambda c: events.append(f"create_{c.id}")
    )

    # Partial update without catalogId should preserve existing catalog and NOT recreate component
    processor.process_messages([{
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "c1", "title": "Updated Title"}],
        },
    }])
    updated_comp = surface.components_model.get("c1")
    assert updated_comp is not None
    assert updated_comp.catalog is cat_b
    assert updated_comp is original_comp
    assert updated_comp.properties.get("title") == "Updated Title"
    assert events == []
