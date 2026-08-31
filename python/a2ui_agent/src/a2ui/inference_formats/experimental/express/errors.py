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

"""Custom exception types raised by the A2UI Express compiler."""


class ExpressCompilerError(ValueError):
    """Base class for all Express DSL compilation errors."""

    def __init__(self, message: str, help_message: str | None = None):
        """Initializes an Express compiler error with a message and optional help hint.

        Args:
            message: The detailed compilation error description.
            help_message: Practical suggestion or hint for resolving the error.
        """
        super().__init__(message)
        self.help_message = help_message


class ExpressUnknownPropertyError(ExpressCompilerError):
    """Raised when a component argument is not a valid property in the catalog schema."""

    def __init__(self, comp_name: str, prop_name: str, valid_props: list[str]):
        """Initializes an unknown property error.

        Args:
            comp_name: The name of the target component.
            prop_name: The name of the invalid property provided.
            valid_props: List of valid property names defined for the component schema.
        """
        msg = (
            f"Property '{prop_name}' is not a valid property of component"
            f" '{comp_name}'."
        )
        help_msg = (
            f"Component '{comp_name}' accepts properties:"
            f" {', '.join(sorted(valid_props))}."
            if valid_props
            else f"Component '{comp_name}' has no configurable properties."
        )
        super().__init__(msg, help_message=help_msg)
        self.comp_name = comp_name
        self.prop_name = prop_name
        self.valid_props = valid_props


class ExpressDuplicatePropertyError(ExpressCompilerError):
    """Raised when a property is provided multiple times for a single component instance."""

    def __init__(self, comp_name: str, prop_name: str):
        """Initializes a duplicate property error.

        Args:
            comp_name: The name of the target component.
            prop_name: The name of the property provided multiple times.
        """
        msg = (
            f"Property '{prop_name}' of component '{comp_name}' was provided multiple"
            " times."
        )
        help_msg = (
            f"Remove duplicate specification of property '{prop_name}' for component"
            f" '{comp_name}'."
        )
        super().__init__(msg, help_message=help_msg)
        self.comp_name = comp_name
        self.prop_name = prop_name


class ExpressInvalidParamError(ExpressCompilerError):
    """Raised when a function argument is not a valid parameter in the function schema."""

    def __init__(self, fn_name: str, param_name: str, valid_params: list[str]):
        """Initializes an invalid function parameter error.

        Args:
            fn_name: The name of the function being called.
            param_name: The name of the invalid parameter provided.
            valid_params: List of valid parameter names for the function schema.
        """
        msg = (
            f"Argument '{param_name}' is not a valid parameter of function '{fn_name}'."
        )
        help_msg = (
            f"Function '{fn_name}' accepts parameters:"
            f" {', '.join(sorted(valid_params))}."
            if valid_params
            else f"Function '{fn_name}' accepts no parameters."
        )
        super().__init__(msg, help_message=help_msg)
        self.fn_name = fn_name
        self.param_name = param_name
        self.valid_params = valid_params


class ExpressDuplicateParamError(ExpressCompilerError):
    """Raised when a function parameter is provided multiple times."""

    def __init__(self, fn_name: str, param_name: str):
        """Initializes a duplicate function parameter error.

        Args:
            fn_name: The name of the function being called.
            param_name: The name of the parameter provided multiple times.
        """
        msg = (
            f"Argument '{param_name}' of function '{fn_name}' was provided multiple"
            " times."
        )
        help_msg = (
            f"Remove duplicate specification of parameter '{param_name}' for function"
            f" '{fn_name}'."
        )
        super().__init__(msg, help_message=help_msg)
        self.fn_name = fn_name
        self.param_name = param_name


class ExpressForbiddenDatabindingError(ExpressCompilerError):
    """Raised when dynamic databinding ($path) is used on a property that forbids databinding."""

    def __init__(self, comp_name: str, prop_name: str):
        """Initializes a forbidden databinding error.

        Args:
            comp_name: The name of the target component.
            prop_name: The name of the property that forbids dynamic databinding.
        """
        msg = (
            f"Property '{prop_name}' of component '{comp_name}' does not support"
            " dynamic data bindings (paths)."
        )
        help_msg = (
            f"Property '{prop_name}' on '{comp_name}' must be a static literal value,"
            " not a dynamic databinding ($path)."
        )
        super().__init__(msg, help_message=help_msg)
        self.comp_name = comp_name
        self.prop_name = prop_name


class ExpressUndefinedRootError(ExpressCompilerError):
    """Raised when a root component reference is missing from the DSL."""

    def __init__(self, root_target: str):
        """Initializes an undefined root error.

        Args:
            root_target: The target root component variable name expected.
        """
        msg = f"Root target '{root_target}' is not defined."
        help_msg = (
            f"Ensure root component '{root_target}' is assigned in your Express DSL."
        )
        super().__init__(msg, help_message=help_msg)
        self.root_target = root_target


class ExpressUndefinedChildError(ExpressCompilerError):
    """Raised when a child component variable reference is missing from the DSL."""

    def __init__(self, child_id: str):
        """Initializes an undefined child reference error.

        Args:
            child_id: The identifier of the referenced child component missing from the DSL.
        """
        msg = f"Child target '{child_id}' is not defined."
        help_msg = (
            f"Ensure component reference '{child_id}' is defined in your Express DSL."
        )
        super().__init__(msg, help_message=help_message)
        self.child_id = child_id
