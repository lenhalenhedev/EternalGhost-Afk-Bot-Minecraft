# React Runtime and Chrome Warning Audit

## Findings

The production exception `Minified React error #185` is React's **Maximum update depth exceeded** error [1]. The dashboard was using Zustand selectors that returned a new array on every read:

```js
useDashboardStore((state) => Object.values(state.bots));
```

The log panel also returned a fresh empty array whenever a bot had no logs:

```js
useDashboardStore((state) => state.logsByBot[botId] || []);
```

Zustand integrates with React's external-store subscription model. React requires repeated external-store snapshots to remain referentially stable until the store actually changes; React's `useSyncExternalStore` documentation states that a new object on every `getSnapshot` call can create an infinite loop [2]. The official Zustand guidance recommends `useShallow` when a selector derives multiple values or collections [3].

## Fixes applied

`Sidebar.jsx` and `DashboardPage.jsx` now wrap the `Object.values(state.bots)` selector with Zustand's official `useShallow` helper. `LogPanel.jsx` now uses a module-level frozen `EMPTY_LOGS` value for the no-log case, so the selector returns the same reference until data exists. The log virtualizer also sets `useFlushSync: false`, following TanStack Virtual's current React 19 compatibility guidance [4]. No state setter, store action, or navigation call remains in component render logic; writes occur in effects, event handlers, or asynchronous request callbacks.

A regression test in `tests/webProtocol.test.js` covers the existing protocol behavior. The selector fix is additionally guarded by a whole-source audit that checks the remaining Zustand selectors and by the production build/lint checks.

## Chrome ad-intervention warning

The Chrome message about blocking ads is separate from React error #185. Chrome's official help says it removes ads from sites with poor ad experiences, including excessive ads, flashing/autoplaying ads, or ad walls, and directs site owners to the Ad Experience Report [5]. The checked-in dashboard shell contains only one local module script and no ad tags, ad SDKs, iframes, popups, or third-party ad endpoints. Therefore there is no ad implementation in this repository to remove. A domain or hosting-level reputation/intervention cannot be cleared by React code; the site owner must inspect the domain's Ad Experience Report and hosting/proxy injection settings.

## Official references

[1]: https://react.dev/errors/185 'React official error reference: Minified React error #185'
[2]: https://react.dev/reference/react/useSyncExternalStore#im-getting-an-error-the-result-of-getsnapshot-should-be-cached 'React official useSyncExternalStore troubleshooting'
[3]: https://zustand.docs.pmnd.rs/learn/guides/beginner-typescript 'Zustand official guide: selectors and useShallow'
[4]: https://tanstack.com/virtual/latest/docs/framework/react/react-virtual 'TanStack Virtual official React adapter documentation'
[5]: https://support.google.com/chrome/answer/7632919?hl=en&co=GENIE.Platform%3DDesktop 'Google Chrome official help: intrusive ad blocking'
