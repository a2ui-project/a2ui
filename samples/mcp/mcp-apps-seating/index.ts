import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

// Unique ID for this iframe instance to prevent echo loops
const iframeId = Math.random().toString(36).substring(2, 9);

type ActionHandler = (params: any) => void | Promise<void>;

interface ActionPayload {
    action: string;
    params: any;
    senderId: string;
    timestamp: number;
}

/**
 * Generic BroadcastChannel Event Bus for MCP Apps.
 * Bridges actions across multiple iframes loaded within the same host session.
 */
class BroadcastChannelBus {
    private channel: BroadcastChannel | null = null;
    private handlers: Map<string, ActionHandler> = new Map();

    constructor(channelName: string = "webmcp-action-bus") {
        try {
            this.channel = new BroadcastChannel(channelName);
            this.channel.onmessage = (event: MessageEvent<ActionPayload>) => {
                this.handleIncoming(event.data);
            };
        } catch (e) {
            console.warn("BroadcastChannel not available, falling back to storage events", e);
        }

        // Secondary fallback: storage event for cross-iframe sync
        window.addEventListener("storage", (event) => {
            if (event.key === "webmcp-app-action" && event.newValue) {
                try {
                    const payload: ActionPayload = JSON.parse(event.newValue);
                    this.handleIncoming(payload);
                } catch (err) {
                    console.error("Failed to parse storage event data", err);
                }
            }
        });
    }

    /**
     * Registers a local JS function to handle a specific action name.
     */
    register(actionName: string, handler: ActionHandler) {
        this.handlers.set(actionName, handler);
        // Also register snake_case and camelCase aliases if applicable
        const camelCase = actionName.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const snakeCase = actionName.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        this.handlers.set(camelCase, handler);
        this.handlers.set(snakeCase, handler);
    }

    /**
     * Dispatches an action: executes locally AND broadcasts to all other iframes.
     */
    dispatch(actionName: string, params: any = {}, broadcast: boolean = true) {
        const payload: ActionPayload = {
            action: actionName,
            params: params,
            senderId: iframeId,
            timestamp: Date.now()
        };

        // 1. Execute locally on this iframe
        this.executeHandler(actionName, params);

        // 2. Broadcast to other iframes
        if (broadcast) {
            if (this.channel) {
                this.channel.postMessage(payload);
            }
            try {
                localStorage.setItem("webmcp-app-action", JSON.stringify(payload));
            } catch (e) {
                // Ignore storage quota/permission errors
            }
        }
    }

    private handleIncoming(payload: ActionPayload) {
        if (!payload || payload.senderId === iframeId) return; // Skip own messages
        this.executeHandler(payload.action, payload.params);
    }

    private executeHandler(actionName: string, params: any) {
        const handler = this.handlers.get(actionName);
        if (handler) {
            try {
                handler(params);
            } catch (e) {
                console.error(`Error executing action '${actionName}':`, e);
            }
        } else {
            console.warn(`No handler registered for action '${actionName}'`);
        }
    }
}

// Instantiate the generic bus
const bus = new BroadcastChannelBus("mcp-seating-bus");

let bookSeatFn: ((seatId: string) => Promise<void>) | null = null;
let currentVenue: string | null = null;

const app = new App({ name: `seating-app`, version: "1.0.0" }, {});

// --- Registered JS Action Handlers ---

/**
 * Highlights specific seats with an animated golden glow or custom style.
 */
function highlightSeats(params: { seat_ids?: string[]; seatIds?: string[]; style?: string } = {}) {
    const seatIds = params.seat_ids || params.seatIds || [];
    const style = params.style || "glow";

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
 * Clears all seat highlights in the active venue.
 */
function clearHighlights() {
    highlightSeats({ seat_ids: [], style: "clear" });
}

/**
 * Switches the active venue layout and loads its seating state.
 */
async function switchVenue(params: { venue_id?: string; venueId?: string }) {
    const venueId = params.venue_id || params.venueId;
    if (!venueId) return;

    document.querySelectorAll(".venue-layout").forEach(el => el.classList.remove("active"));
    const layout = document.getElementById(`layout-${venueId}`);
    if (layout) layout.classList.add("active");

    currentVenue = venueId;
    try {
        localStorage.setItem("mcp-seating-current-venue", venueId);
    } catch (e) {}

    // Fetch and render seats from server
    try {
        const result = await app.callServerTool({
            name: "get_seating_state",
            arguments: { venue_id: venueId }
        });
        if (result && result.content && result.content[0].text) {
            const state = JSON.parse(result.content[0].text as string);
            renderSeats(venueId, state);
        }
    } catch (e) {
        console.error("Failed to fetch state for venue", venueId, e);
    }
}

// Register all actions on the generic bus
bus.register("highlightSeats", highlightSeats);
bus.register("clearHighlights", clearHighlights);
bus.register("switchVenue", switchVenue);

app.onhostcontextchanged = async () => {
    // wait for ontoolinput instead!
};

app.ontoolinput = async (request) => {
    const args = request.arguments || {};

    // If this newly opened iframe has no active venue yet, restore last active venue
    if (!currentVenue && !args.venue_id) {
        const savedVenue = localStorage.getItem("mcp-seating-current-venue") || "concert";
        await switchVenue({ venue_id: savedVenue });
    }

    // 1. Handle WebMCP Tool Dispatcher: call_webmcp_tool
    if (args.inner_tool) {
        const innerTool = args.inner_tool as string;
        const innerArgs = (args.args || {}) as Record<string, any>;

        // Dispatch through generic bus (executes locally + broadcasts to prior iframes)
        bus.dispatch(innerTool, innerArgs);
        return;
    }

    // 2. Handle Venue Switch: open_venue
    if (args.venue_id) {
        bus.dispatch("switchVenue", { venue_id: args.venue_id as string });
    }
};

app.ontoolresult = async () => {
    if (!currentVenue) return;
    try {
        const result = await app.callServerTool({
            name: "get_seating_state",
            arguments: { venue_id: currentVenue }
        });
        if (result && result.content && result.content[0].text) {
            const state = JSON.parse(result.content[0].text as string);
            renderSeats(currentVenue, state);
        }
    } catch (e) {
        console.error("Failed to fetch state after tool result", e);
    }
};

bookSeatFn = async (seatId: string) => {
    if (!currentVenue) return;
    try {
        await app.callServerTool({
            name: "book_seat",
            arguments: { venue_id: currentVenue, seat_id: seatId }
        });
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
});

function renderSeats(venueId: string, state: Record<string, string>) {
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
            const status = state[seatId];
            const div = document.createElement("div");
            div.className = `seat ${status}`;
            div.innerText = seatId;
            div.dataset.seatId = seatId;
            if (status !== "booked") {
                div.onclick = () => {
                    div.className = "seat booked";
                    if (bookSeatFn) bookSeatFn(seatId);
                };
            }
            const rowPrefix = seatId.substring(0, 2);
            if (rows[rowPrefix]) rows[rowPrefix].appendChild(div);
            else container.appendChild(div);
        });
        return;
    } else if (venueId === "arena") {
        const total = seatIds.length;
        const radius = 120;
        seatIds.sort().forEach((seatId, i) => {
            const status = state[seatId];
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
            div.className = `seat ${status}`;
            div.innerText = seatId.replace("A", "");
            div.dataset.seatId = seatId;

            if (status !== "booked") {
                div.onclick = () => {
                    div.className = "seat booked";
                    if (bookSeatFn) bookSeatFn(seatId);
                };
            }
            wrapper.appendChild(div);
            container.appendChild(wrapper);
        });
        return;
    } else {
        seatIds.sort();
    }

    seatIds.forEach(seatId => {
        const status = state[seatId];
        const div = document.createElement("div");
        div.className = `seat ${status}`;
        div.innerText = seatId;
        div.dataset.seatId = seatId;

        if (status !== "booked") {
            div.onclick = () => {
                div.className = "seat booked";
                if (bookSeatFn) bookSeatFn(seatId);
            };
        }
        container.appendChild(div);
    });
}
