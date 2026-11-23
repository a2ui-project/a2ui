# Inbox decisions (`@a2ui/embed` prototype)

Internal proof of concept for [`@a2ui/embed`](../../../../typescript/embed/README.md). Not published, not for production.

An inbox assistant as an MCP App: the agent prepares every email decision that needs the person in one card, with its pick pre-selected and the reason, and the person confirms once. The mailbox is synthetic and shaped like Gmail and Calendar data. This sample is built up over a series of commits; the last one adds the MCP server, the e2e harness and the full README.

```sh
yarn build
yarn test
```
