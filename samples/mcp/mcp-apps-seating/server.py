import anyio
import click
import pathlib
import mcp.types as types
from mcp.server.fastmcp import FastMCP
import json

# Mock seating state
venues = {
    "stadium": {"name": "Grand Stadium", "seats": {f"S{i}": "available" for i in range(1, 21)}},
    "concert": {"name": "Symphony Hall", "seats": {f"C{i}": "available" for i in range(1, 16)}},
    "theater": {"name": "Classic Theater", "seats": {f"T{i}": "available" for i in range(1, 26)}},
    "arena": {"name": "Mega Arena", "seats": {f"A{i}": "available" for i in range(1, 31)}},
    "cinema": {"name": "Starlight Cinema", "seats": {f"M{i}": "available" for i in range(1, 13)}},
}

app = FastMCP("mcp-apps-seating")

@app.resource("ui://seating/app", name="Seating App UI", mime_type="text/html;profile=mcp-app")
def get_seating_app() -> str:
    """Get the HTML UI for the venue application"""
    try:
        return (pathlib.Path(__file__).parent / "dist" / "index.html").read_text()
    except FileNotFoundError:
        raise ValueError("Resource file not found. Did you run npm run build?")


@app.tool(
    meta={
        "ui": {
            "resourceUri": "ui://seating/app"
        }
    }
)
def open_venue(venue_id: str) -> types.CallToolResult:
    """Open the seating UI for a specific venue.
    
    Args:
        venue_id: The ID of the venue (stadium, concert, theater, arena, cinema)
    """
    if venue_id not in venues:
        return types.CallToolResult(
            isError=True,
            content=[types.TextContent(type="text", text=f"Unknown venue: {venue_id}")]
        )
        
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=f"Opening venue: {venue_id}")]
    )


@app.tool()
def book_seat(venue_id: str, seat_id: str) -> str:
    """Books a specific seat at a venue.
    Args:
        venue_id: The ID of the venue (stadium, concert, theater, arena, cinema)
        seat_id: The ID of the seat to book
    """
    if venue_id not in venues:
        raise ValueError(f"Invalid venue: {venue_id}")
    
    seats = venues[venue_id]["seats"]
    if seat_id not in seats:
        raise ValueError(f"Error: Seat {seat_id} does not exist.")
    
    if seats[seat_id] == "booked":
        raise ValueError(f"Error: Seat {seat_id} is already booked.")
    
    seats[seat_id] = "booked"
    return f"Successfully booked seat {seat_id} at {venues[venue_id]['name']}."


@app.tool()
def get_seating_state(venue_id: str) -> str:
    """Gets the current seating state for a venue.
    Args:
        venue_id: The ID of the venue (stadium, concert, theater, arena, cinema)
    """
    if venue_id not in venues:
        raise ValueError(f"Invalid venue: {venue_id}")
    return json.dumps(venues[venue_id]["seats"])


@click.command()
@click.option("--host", default="127.0.0.1", help="Host to listen on for SSE")
@click.option("--port", default=8000, help="Port to listen on for SSE")
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse"]),
    default="stdio",
    help="Transport type: stdio (for Claude Desktop / CLI) or sse (via Uvicorn for web hosts)",
)
def main(host: str, port: int, transport: str) -> int:
    if transport == "sse":
        print(f"Starting SSE server on {host}:{port} via Uvicorn...")
        app.settings.port = port
        starlette_app = app.sse_app()
        from starlette.middleware.cors import CORSMiddleware
        starlette_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        import uvicorn
        uvicorn.run(starlette_app, host=host, port=port)
    else:
        app.run(transport="stdio")
    return 0

if __name__ == "__main__":
    main()
