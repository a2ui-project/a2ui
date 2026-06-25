# Summary of Custom Catalog negotiation changes in A2UI v0.8

This document summarizes the changes made to the A2UI protocol in v0.8 to support a more flexible and powerful custom catalog negotiation mechanism. It is intended as a guide for developers implementing these changes in agent or renderer libraries.

The previous mechanism, which involved a single, one-time `clientUiCapabilities` message, has been deprecated. The new approach allows for a more dynamic, per-request declaration of capabilities, enabling a single client to support multiple catalogs and allowing the agent to choose the most appropriate one for each UI surface.

## Key changes to the protocol

1.  **Agent capability advertisement (`supportedCatalogIds`, `acceptsInlineCatalogs`)**: The agent's role in negotiation has been expanded. It now can declare a list of supported catalog IDs, in addition to whether it is capable of processing catalogs defined "inline" by the client.
    - **Relevant Doc**: [`a2ui_extension_specification.md`](./a2ui_extension_specification.md)

2.  **Client capabilities via A2A metadata**: The client now sends its capabilities in an `a2uiClientCapabilities` object. Crucially, this is no longer a standalone message but is included in the `metadata` field of the A2A `Message` for **every** A2A `Message` sent to the agent.
    - This object contains `supportedCatalogIds` (an array of known catalog IDs) and an optional `inlineCatalogs` (an array of full catalog definitions).
    - **Relevant doc**: The new process is explained in the [`a2ui_protocol.md`](./a2ui_protocol.md#catalog-negotiation) section on Catalog Negotiation.
    - **Relevant schema**: [`a2ui_client_capabilities_schema.json`](../json/a2ui_client_capabilities_schema.json)

3.  **Per-Surface catalog selection (`beginRendering`)**: The agent is now responsible for selecting which catalog to use for each UI surface. It signals its choice using the new optional `catalogId` field in the `beginRendering` message. If this field is omitted, the client must default to the Standard Catalog.
    - **Relevant doc**: [`a2ui_protocol.md`](./a2ui_protocol.md#catalog-negotiation)
    - **Relevant schema**: The change is reflected in [`server_to_client.json`](../json/server_to_client.json).

4.  **Catalog definition ID (`catalogId`)**: To facilitate identification, the catalog definition schema itself now has a required `catalogId` field.
    - **Relevant schema**: [`catalog_description_schema.json`](../json/catalog_description_schema.json)

---

## Implementation guide for developers

### For Agent (server) library developers

Your responsibilities are to process the client's declared capabilities and make a rendering choice.

1.  **Advertise capability**: In the agent's capability card, add the `supportedCatalogIds` array and the `acceptsInlineCatalogs: true` parameter within the A2UI extension block to declare which catalogs you support and whether you can handle dynamic ones.

2.  **Parse client capabilities**: On every incoming A2A `Message`, your library must parse the `a2uiClientCapabilities` object in the `metadata` field of the A2A `Message` to determine which catalogs the client supports. You will get a list of `supportedCatalogIds` and potentially a list of `inlineCatalogs`.

3.  **Choose a Catalog**: Before rendering a UI, decide which catalog to use. Your choice must be one of the catalogs advertised by the client in the capabilities object.

4.  **Specify Catalog on render**: When sending the `beginRendering` message for a surface, set the `catalogId` field to the ID of your chosen catalog (e.g., `"https://my-company.com/inline_catalogs/my-custom-catalog"`). If you do not set this field, you are implicitly requesting the use of the standard catalog.

5.  **Generate compliant UI**: Ensure that all components generated in subsequent `surfaceUpdate` messages for that surface conform to the properties and types defined in the chosen catalog.

### For Renderer (client) library developers

Your responsibilities are to accurately declare your capabilities and render surfaces using the catalog selected by the agent.

1.  **Declare capabilities on every request**: For every A2A `Message` your application sends, your library must inject the `a2uiClientCapabilities` object into the `metadata` field of the A2A `Message`.

2.  **Populate `supportedCatalogIds`**: In the capabilities object, populate this array with the string identifiers of all pre-compiled catalogs your renderer supports. If your renderer supports the standard catalog for v0.8, you **should** include its ID: `https://a2ui.org/specification/v0_8/standard_catalog_definition.json`.

3.  **Provide `inlineCatalogs` (optional)**: If your renderer supports dynamically generating or defining catalogs at runtime, include their full, valid Catalog Definition Documents in the `inlineCatalogs` array.

4.  **Process `beginRendering`**: When your renderer receives a `beginRendering` message, it must inspect the new `catalogId` field.

5.  **Select Catalog for surface**:
    - If `catalogId` is present, use the corresponding catalog to render that surface. Your renderer must be able to look up the catalog from its pre-compiled list or from the inline definitions it just sent.
    - If `catalogId` is **absent**, you **must** default to using the Standard Catalog for v0.8 for that surface.

6.  **Manage multiple Catalogs**: Your renderer must be architected to handle multiple surfaces being rendered with different catalogs simultaneously. A dictionary mapping `surfaceId` to the chosen `catalog` is a common approach.
