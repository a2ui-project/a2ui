import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

let bookSeatFn: ((seatId: string) => Promise<void>) | null = null;
let currentVenue: string | null = null;

const app = new App({ name: `seating-app`, version: "1.0.0" }, {});

/**
 * Applies highlights (animated glow) to the DOM elements.
 */
function highlightSeats(seatIds: string[] = [], style: string = "glow") {
    // Clear existing glow or recommended highlights
    document.querySelectorAll(".seat.glow, .seat.recommended").forEach(el => {
        el.classList.remove("glow", "recommended");
    });

    if (style === "clear") return;

    seatIds.forEach(id => {
        const normalizedId = id.trim().toUpperCase();
        const seat = document.querySelector(`.seat[data-seat-id="${normalizedId}"]`) ||
            Array.from(document.querySelectorAll(".seat")).find(
                el => (el as HTMLElement).dataset.seatId?.toUpperCase() === normalizedId ||
                      el.textContent?.trim().toUpperCase() === normalizedId ||
                      el.textContent?.trim().toUpperCase() === normalizedId.replace(/^[A-Z]/, "")
            );
        if (seat) {
            seat.classList.add(style === "recommended" ? "recommended" : "glow");
        }
    });
}

/**
 * Updates the seating DOM classes based on the server state.
 * Only modifies classes, does not recreate DOM elements to prevent flickering/focus loss.
 */
function updateSeatsState(state: Record<string, string>, highlights: string[] = []) {
    Object.keys(state).forEach(seatId => {
        const status = state[seatId];
        const seat = document.querySelector(`.seat[data-seat-id="${seatId}"]`);
        if (seat) {
            // Keep basic seat class and add status (available/booked)
            seat.className = `seat ${status}`;
            // If it's not booked, reattach onclick just in case
            if (status !== "booked") {
                (seat as HTMLElement).onclick = () => {
                    seat.className = "seat booked";
                    if (bookSeatFn) bookSeatFn(seatId);
                };
            } else {
                (seat as HTMLElement).onclick = null;
            }
        }
    });
    
    // Apply server-directed highlights
    if (highlights.length > 0) {
        highlightSeats(highlights, "glow");
    }
}

/**
 * Switches the active venue layout, renders initial DOM, and starts polling.
 */
async function switchVenue(venueId: string) {
    if (!venueId) return;

    document.querySelectorAll(".venue-layout").forEach(el => el.classList.remove("active"));
    const layout = document.getElementById(`layout-${venueId}`);
    if (layout) layout.classList.add("active");

    currentVenue = venueId;
    try {
        localStorage.setItem("mcp-seating-current-venue", venueId);
    } catch (e) {}

    // Fetch and render initial seats from server
    await fetchAndUpdateState(true);
}

/**
 * Fetches the latest seating state from the server and updates the UI.
 * @param initialRender If true, recreates the DOM elements. If false, just updates classes.
 */
async function fetchAndUpdateState(initialRender: boolean = false) {
    if (!currentVenue) return;
    try {
        const result = await app.callServerTool({
            name: "get_seating_state",
            arguments: { venue_id: currentVenue }
        });
        
        if (result && result.content && result.content[0].text) {
            const data = JSON.parse(result.content[0].text as string);
            // Support both old format (just state object) and new format { seats: {}, highlights: [] }
            const state = data.seats || data;
            const highlights = data.highlights || [];
            
            if (initialRender) {
                renderSeatsDOM(currentVenue, state);
            }
            updateSeatsState(state, highlights);
        }
    } catch (e) {
        console.error("Failed to fetch state for venue", currentVenue, e);
    }
}

// ----------------------------------------------------
// Start Polling (Server State acts as the Source of Truth)
// ----------------------------------------------------
setInterval(() => {
    // Only poll if we have a venue active
    if (currentVenue) {
        fetchAndUpdateState(false);
    }
}, 1000);

app.onhostcontextchanged = async () => {};

app.ontoolinput = async (request) => {
    const args = request.arguments || {};

    // 2. Handle Venue Switch: open_venue
    if (args.venue_id) {
        await switchVenue(args.venue_id as string);
    } else if (!currentVenue) {
        // If this iframe opened without a venue, restore the last active venue
        const savedVenue = localStorage.getItem("mcp-seating-current-venue") || "concert";
        await switchVenue(savedVenue);
    }
};

app.ontoolresult = async () => {
    // We already poll every 1s, but we can do an immediate fetch on tool result
    if (currentVenue) {
        await fetchAndUpdateState(false);
    }
};

bookSeatFn = async (seatId: string) => {
    if (!currentVenue) return;
    try {
        await app.callServerTool({
            name: "book_seat",
            arguments: { venue_id: currentVenue, seat_id: seatId }
        });
        // Immediately fetch updated state to confirm booking
        await fetchAndUpdateState(false);
    } catch (e) {
        console.error("Failed to book seat", e);
    }
};

async function sendWebMcpHandshake() {
    try {
        const handshakePayload = {
            webmcp_capabilities: {
                tools: [
                    {
                        name: "highlight_seats",
                        description: "Highlights specific seats in the UI with an animated golden glow or recommended style.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                seat_ids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "List of seat IDs to highlight (e.g. ['C1', 'C2'] or ['S10', 'S11'])"
                                },
                                style: {
                                    type: "string",
                                    enum: ["glow", "recommended", "clear"],
                                    description: "Visual style: 'glow' for animated pulsing gold, 'clear' to remove highlights"
                                }
                            },
                            required: ["seat_ids"]
                        }
                    },
                    {
                        name: "clear_highlights",
                        description: "Clears all seat highlights in the active venue UI.",
                        inputSchema: {
                            type: "object",
                            properties: {}
                        }
                    }
                ]
            }
        };

        await app.sendMessage({
            role: "user",
            content: [{
                type: "text",
                text: JSON.stringify(handshakePayload, null, 2)
            }]
        });
    } catch (err) {
        console.log("WebMCP capability handshake notice:", err);
    }
}

const transport = new PostMessageTransport(window.parent);
app.connect(transport).then(() => {
    sendWebMcpHandshake();
    
    // Attempt to load the last venue immediately upon connection
    const savedVenue = localStorage.getItem("mcp-seating-current-venue");
    if (savedVenue && !currentVenue) {
        switchVenue(savedVenue);
    }
});

/**
 * Renders the initial DOM structure for the seats.
 * Only called once per venue switch.
 */
function renderSeatsDOM(venueId: string, state: Record<string, string>) {
    const container = document.getElementById(`seats-${venueId}`) || document.getElementById(`seats-arena`);
    if (!container) return;
    container.innerHTML = "";

    const seatIds = Object.keys(state);

    if (venueId === "concert") {
        seatIds.sort((a, b) => parseInt(a.replace("C", "")) - parseInt(b.replace("C", "")));
    } else if (venueId === "theater") {
        const rows: Record<string, HTMLElement> = {};
        for (let i = 0; i < 4; i++) {
            const row = document.createElement("div");
            row.className = `row row-${i}`;
            rows[`T${i}`] = row;
            container.appendChild(row);
        }
        seatIds.sort().forEach(seatId => {
            const div = document.createElement("div");
            div.className = `seat`;
            div.innerText = seatId;
            div.dataset.seatId = seatId;
            const rowPrefix = seatId.substring(0, 2);
            if (rows[rowPrefix]) rows[rowPrefix].appendChild(div);
            else container.appendChild(div);
        });
        return;
    } else if (venueId === "arena") {
        const total = seatIds.length;
        const radius = 120;
        seatIds.sort().forEach((seatId, i) => {
            const angle = (i / total) * 2 * Math.PI;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const rotation = angle * (180 / Math.PI) + 90;

            const wrapper = document.createElement("div");
            wrapper.className = "seat-wrapper";
            wrapper.style.left = `calc(50% + ${x}px)`;
            wrapper.style.top = `calc(50% + ${y}px)`;
            wrapper.style.transform = `rotate(${rotation}deg)`;

            const div = document.createElement("div");
            div.className = `seat`;
            div.innerText = seatId.replace("A", "");
            div.dataset.seatId = seatId;

            wrapper.appendChild(div);
            container.appendChild(wrapper);
        });
        return;
    } else {
        seatIds.sort();
    }

    seatIds.forEach(seatId => {
        const div = document.createElement("div");
        div.className = `seat`;
        div.innerText = seatId;
        div.dataset.seatId = seatId;
        container.appendChild(div);
    });
}
