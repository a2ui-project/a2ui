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

from typing import Any, List, Dict, Optional, TYPE_CHECKING
from a2ui.core.state import Signal, ComponentNode

if TYPE_CHECKING:
    from a2ui.core.state import SurfaceModel, NodeGraph


class A2uiTextRenderer:
    """
    A reactive text-based layout renderer for A2UI Python SDK.
    Consumes the living reactive Node Layer (ComponentNode tree) and maps it recursively
    into structured textual UI layouts, reactively updating whenever properties or templates change.
    """

    def __init__(self, node_graph: "NodeGraph"):
        self.node_graph = node_graph
        self.surface = node_graph.surface
        self.output: Signal[str] = Signal("")
        self._root_sub = None
        self._node_subs: Dict[str, Any] = {}  # Map of node instanceId to Subscription
        self._node_signals: Dict[str, Any] = (
            {}
        )  # Map of sub_id to active Signal instance

        # Subscribe reactively to the rootNode of the node graph
        self._root_sub = self.node_graph.rootNode.subscribe(self._on_root_node_changed)

    def _on_root_node_changed(self, root_node: Optional[ComponentNode]) -> None:
        self._updating = False

        def rebuild_output(dummy_val: Any = None) -> None:
            if self._updating:
                return
            self._updating = True
            try:
                if not root_node:
                    self.output.value = ""
                    return

                # Collect all nodes active in tree
                active_tree_nodes = self._collect_nodes_in_tree(root_node)
                active_ids = {n.instance_id for n in active_tree_nodes}

                # Unsubscribe and discard old subscriptions
                for n_id in list(self._node_subs.keys()):
                    if (
                        "::" not in n_id and n_id not in active_ids
                    ) or "::" in n_id:  # Resubscribe prop signals
                        sub = self._node_subs.pop(n_id, None)
                        if sub:
                            try:
                                sub.unsubscribe()
                            except Exception:
                                pass

                # Ensure active subscriptions
                for node in active_tree_nodes:
                    # 1. Subscribe to node property updates
                    if node.instance_id not in self._node_subs:
                        self._node_subs[node.instance_id] = None
                        sub = node.props.subscribe(rebuild_output)
                        self._node_subs[node.instance_id] = sub

                    # 2. Subscribe to any nested Signals in props (like templated lists)
                    props = node.props.value
                    for k, val in props.items():
                        if isinstance(val, Signal):
                            sub_id = f"{node.instance_id}::prop::{k}"
                            if self._node_signals.get(sub_id) is not val:
                                old_sub = self._node_subs.pop(sub_id, None)
                                if old_sub:
                                    try:
                                        old_sub.unsubscribe()
                                    except Exception:
                                        pass

                                self._node_signals[sub_id] = val
                                self._node_subs[sub_id] = None
                                sub = val.subscribe(rebuild_output)
                                self._node_subs[sub_id] = sub

                self.output.value = self.render_node_to_string(root_node)
            finally:
                self._updating = False

        rebuild_output()

    def _collect_nodes_in_tree(self, node: ComponentNode) -> List[ComponentNode]:
        nodes = [node]
        props = node.props.value

        for val in props.values():
            if isinstance(val, ComponentNode):
                nodes.extend(self._collect_nodes_in_tree(val))
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, ComponentNode):
                        nodes.extend(self._collect_nodes_in_tree(item))
                    elif isinstance(item, dict) and isinstance(
                        item.get("child"), ComponentNode
                    ):
                        nodes.extend(self._collect_nodes_in_tree(item["child"]))
            elif isinstance(val, Signal) and isinstance(val.value, list):
                for item in val.value:
                    if isinstance(item, ComponentNode):
                        nodes.extend(self._collect_nodes_in_tree(item))
        return nodes

    def render_node_to_string(self, node: ComponentNode, depth: int = 0) -> str:
        if node.type == "Placeholder":
            return "  " * depth + f"[Placeholder: {node.component_id}]"

        props = node.props.value
        indent = "  " * depth

        if node.type == "Text":
            text_val = props.get("text", "")
            variant = props.get("variant", "body")
            return f"{indent}<Text variant={variant!r}>{text_val}</Text>"

        elif node.type == "Button":
            child_rendered = ""
            child_node = props.get("child")
            if isinstance(child_node, ComponentNode):
                child_rendered = "\n" + self.render_node_to_string(
                    child_node, depth + 1
                )
            valid_marker = ""
            if "isValid" in props:
                valid_marker = f" isValid={props['isValid']}"
            return f"{indent}<Button{valid_marker}>{child_rendered}\n{indent}</Button>"

        elif node.type in ("Column", "Row"):
            children_rendered = []
            children_prop = props.get("children", [])

            # Resolve if list property is stored in a Signal wrapper (templates)
            actual_children = (
                children_prop.value
                if isinstance(children_prop, Signal)
                else children_prop
            )

            for child in actual_children:
                if isinstance(child, ComponentNode):
                    children_rendered.append(
                        self.render_node_to_string(child, depth + 1)
                    )
                elif isinstance(child, dict) and isinstance(
                    child.get("child"), ComponentNode
                ):
                    children_rendered.append(
                        f"{indent}  [Tab title={child.get('title')!r}]:\n"
                        + self.render_node_to_string(child["child"], depth + 2)
                    )

            children_joined = "\n".join(children_rendered)
            children_block = f"\n{children_joined}\n" if children_joined else ""
            return f"{indent}<{node.type}>{children_block}{indent}</{node.type}>"

        elif node.type == "Card":
            child_rendered = ""
            child_node = props.get("child")
            if isinstance(child_node, ComponentNode):
                child_rendered = (
                    "\n" + self.render_node_to_string(child_node, depth + 1) + "\n"
                )
            return f"{indent}<Card>{child_rendered}{indent}</Card>"

        return f"{indent}<{node.type} id={node.component_id!r} />"

    def _cleanup_subs(self) -> None:
        for sub in list(self._node_subs.values()):
            if sub:
                try:
                    sub.unsubscribe()
                except Exception:
                    pass
        self._node_subs.clear()
        self._node_signals.clear()

    def dispose(self) -> None:
        """Disposes of the renderer and cleans up all reactive listeners."""
        if self._root_sub:
            try:
                self._root_sub.unsubscribe()
            except Exception:
                pass
            self._root_sub = None
        self._cleanup_subs()
