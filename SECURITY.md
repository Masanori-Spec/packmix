# Security and privacy

This prototype calculates entirely in the browser. It has no backend, analytics, cookies, localStorage, third-party fonts, paid APIs, or account integration. The static hosting provider will still receive ordinary page requests and may log them; the application does not send plan input.

## Import boundary

- File size is checked before reading: maximum 65,536 UTF-8 bytes
- JSON is parsed as data; no eval, dynamic code, or imported URLs
- Iterative traversal rejects dangerous property names and excessive depth
- Exact structural keys, primitive types, safe integers, lengths, ranges, and unique IDs are enforced
- The accepted shape is reconstructed as fresh objects; unknown fields are not merged
- Labels resembling HTML remain inert text. Rendering uses textContent/text nodes; no innerHTML
- Import errors retain the current plan. Closing the dialog invalidates an asynchronous in-flight import
- Text/JSON exports have fixed filenames and do not execute imported values

The CSP disallows external connections, inline scripts, object content, and form submission. On deployment, setting the equivalent CSP plus `frame-ancestors 'none'` as HTTP headers is recommended. A meta CSP cannot enforce frame-ancestors. The development server is loopback-only and intended for local use, not production hosting.

## Limits

This is not a security audit. The initial restricted authoring environment could not run browser tests; the ordinary GitHub Actions workflow subsequently passed 17 headless Chromium checks, including malicious JSON rejection, inert HTML-shaped labels, cancelled in-flight imports, and observation of no external application requests. See [verification status](docs/verification-status.md) for the exact tested commit, browser version and limits. These synthetic tests do not establish security for every payload, browser or hosting configuration.

Do not place secrets or personal data in demo files, bug reports, screenshots, or public CI artifacts. The shipped fixtures are synthetic. Do not submit sensitive vulnerability details through a public issue. No reporting address is specified until the repository owner chooses one.
