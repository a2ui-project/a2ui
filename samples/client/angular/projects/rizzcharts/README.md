# Angular A2UI - RIZZ Charts

These are sample implementations of A2UI in Angular.

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. GoogleMap API ([How to get the API key](https://developers.google.com/maps/documentation/javascript/get-api-key))

## Running

1. Update the `src/environments/environment.ts` file with your Google Maps API key.
2. Build the shared dependencies by running `yarn install` from the root, then `yarn build` in the `renderers/web_core` directory
3. Install local dependencies: `yarn install`
4. Run the A2A server for the [rizzcharts agent](../../../../agent/adk/rizzcharts/python/)
5. Run the relevant app:

- `yarn start rizzcharts`

6. Open http://localhost:4200/
