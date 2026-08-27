# Current Dashboard Fix Audit

## Confirmed runtime/data-path finding

The `/api/events` endpoint is reachable and returns an SSE stream, as established by the supplied HAR analysis. The current client hook registers `bot:log` handlers and the store appends log entries. The server-side live-log bridge is incomplete: `src/services/logger.js` emits `botLog`, while `src/web/sse/eventHub.js` exposes `publish/subscribe`, but no runtime module currently subscribes logger events and publishes `bot:log` into `eventHub`. `src/web/sse/WebNotifier.js` contains the intended bridge but is not instantiated, and its `publish` symbol is not imported. Therefore initial logs can appear from REST/SSE snapshots while subsequent logger lines are not sent through the active SSE hub. This is the primary confirmed realtime root cause; the detail-page `setLogs` replacement remains a separate race risk and will be changed to merge rather than overwrite.

## Official source findings

- Mineflayer 4.37.1 official API: `bot.chat(message)` is documented as the outbound chat method, and the official method list does not document `bot.command`. The shared dispatcher must therefore classify leading-slash input but use the documented `bot.chat` transport with the original slash-preserving message. Source: https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md
- Mineflayer official tutorial states that `bot.chat()` sends a message to chat. Source: https://github.com/PrismarineJS/mineflayer/blob/master/docs/tutorial.md
- TanStack Virtual official API documents `measureElement` with `data-index` for dynamically measured row sizes. It recommends estimating the largest comfortable possible size for dynamically measured elements. It also documents `anchorTo: 'end'` and `followOnAppend` for chat/log feeds. Source: https://tanstack.com/virtual/latest/docs/api/virtualizer
- TanStack Virtual's official dynamic React example uses `data-index`, `ref={virtualizer.measureElement}`, absolute row positioning, and a relative measured container. Source: https://tanstack.com/virtual/latest/docs/framework/react/examples/dynamic
- React official `useEffect` documentation requires setup/cleanup symmetry for external subscriptions and shows dependency-aware cleanup. It also describes effects as external-system synchronization and warns that development Strict Mode runs an extra setup/cleanup cycle. Source: https://react.dev/reference/react/useEffect

## Implementation constraints

- Preserve owner authorization and canonical UUID behavior for REST.
- `/select-bot` may resolve only an owned UUID prefix of at least 8 hexadecimal characters, and only when exactly one owned bot matches.
- Web and Discord must call one shared dispatch path. Leading `/` is command classification; because Mineflayer has no documented `bot.command` API, transport remains `bot.chat(message)` so Minecraft receives the slash command unchanged. Whitespace before `/` is ordinary chat because classification is based on the first character without trimming.
- Offline/unconnected bots must be rejected clearly, not queued for later.
- Frontend logs must be dynamically measured and wrap on narrow screens.
- The whole dashboard uses the dark semantic palette; form controls must have explicit unique `id` and `name` attributes.
