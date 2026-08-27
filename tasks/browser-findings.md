# Browser findings

- React official error reference: https://react.dev/errors/185
  - React error #185 expands to: "Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops."
  - React recommends using the development build locally because it includes fuller diagnostics.
- ChromeStatus feature URL from the user: https://www.chromestatus.com/feature/5738264052891648
  - The page loaded without readable extracted content in the sandbox viewport. The warning text supplied by the user is a Chrome intervention notice about ad-related site behavior, not evidence that this repository injects advertising.
- Repository `web/index.html` contains only local app bootstrap content and no ad scripts, iframe embeds, or third-party ad tags.

- Live deployment check: `http://hk1.quvo.pro:15029/dashboard` loaded with title `EternalGhost Dashboard`, but the visible page was blank and the sandbox browser console had no captured output. This is consistent with a runtime failure in the deployed minified bundle, but the sandbox could not reproduce the exact console exception from the live page.
