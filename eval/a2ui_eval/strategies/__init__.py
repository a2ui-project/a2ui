from inspect_ai.solver import Solver
from .direct import direct_solver
from .subagent_tool import subagent_tool_solver

STRATEGIES = {
    "direct": direct_solver,
    "subagent_tool": subagent_tool_solver,
}

def get_solver(strategy: str, schema_path: str, catalog_path: str) -> list[Solver]:
    """Returns the solver chain for the specified evaluation strategy."""
    if strategy not in STRATEGIES:
        raise ValueError(f"Unknown evaluation strategy: {strategy}")
        
    return STRATEGIES[strategy](schema_path, catalog_path)
