import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

let bookSeatFn: ((seatId: string) => Promise<void>) | null = null;
let currentVenue: string | null = null;

const app = new App({ name: `seating-app`, version: "1.0.0" }, {});

app.onhostcontextchanged = async (ctx) => {
    // wait for ontoolinput instead!
};

app.ontoolinput = async (request) => {
    const venueId = request.arguments?.venue_id as string;
    if (!venueId) return;

    // Switch layout
    document.querySelectorAll('.venue-layout').forEach(el => el.classList.remove('active'));
    const layout = document.getElementById(`layout-${venueId}`);
    if (layout) layout.classList.add('active');

    currentVenue = venueId;

    // Fetch state
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
        console.error("Failed to fetch initial state", e);
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

const transport = new PostMessageTransport(window.parent);
app.connect(transport);

function renderSeats(venueId: string, state: Record<string, string>) {
    const container = document.getElementById(`seats-${venueId}`) || document.getElementById(`seats-arena`);
    if (!container) return;
    container.innerHTML = "";

    const seatIds = Object.keys(state);

    if (venueId === 'concert') {
        seatIds.sort((a,b) => parseInt(a.replace('C','')) - parseInt(b.replace('C','')));
    } else if (venueId === 'theater') {
        const rows: Record<string, HTMLElement> = {};
        for (let i = 0; i < 4; i++) {
            const row = document.createElement('div');
            row.className = `row row-${i}`;
            rows[`T${i}`] = row;
            container.appendChild(row);
        }
        seatIds.sort().forEach(seatId => {
            const status = state[seatId];
            const div = document.createElement("div");
            div.className = `seat ${status}`;
            div.innerText = seatId;
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
    } else if (venueId === 'arena') {
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
            div.innerText = seatId.replace('A', '');

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

        if (status !== "booked") {
            div.onclick = () => {
                div.className = "seat booked";
                if (bookSeatFn) bookSeatFn(seatId);
            };
        }
        container.appendChild(div);
    });
}
