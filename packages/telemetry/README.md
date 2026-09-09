# @gears-frontx/telemetry

Browser telemetry SDK. Batches application events and sends them to an endpoint you control.
Session tracking, device and navigation context, DOM autocapture, and a plugin system for
everything else.

Standalone by design: nothing under `src/` imports another `@gears-frontx` package, and nothing
imports React. `bowser` is the only runtime dependency.

## Install

```sh
npm install @gears-frontx/telemetry
```

Inside this monorepo it is a workspace package - npm workspaces resolves `@gears-frontx/telemetry`
for anything in the repo, so there is nothing to install.

Built as CJS + ESM with type declarations, one entry point (`.`). Requires a browser environment
(`window`, `document`, `localStorage`, `fetch`). `start()`, `plugin()` and `destroy()` are no-ops
when `window` is undefined, so importing the package on a server is safe - it just collects
nothing.

## Usage

```ts
import { createTelemetry } from '@gears-frontx/telemetry';

const telemetry = createTelemetry({
  appName: 'my-app',
  appVersion: '1.4.2',
  url: 'https://telemetry.example.com/api/events',
});

telemetry.identify(user.id);
telemetry.start();

telemetry.logEvent('settings_saved', { theme: 'dark' });
```

`start()` registers the built-in plugins - session, device, navigation, app info and autocapture -
and installs their listeners. All but navigation are registered unconditionally; see
`navigationCapture` below. Out of the box that gives you a `session_start` event for a new session, a
`page_view` on every path change (`pushState`, `replaceState`, `popstate`), device, OS, client,
viewport and timezone fields on every record, and captured user interactions.

An application that routes page views itself can turn page-view capture off with
`navigationCapture: false`. The navigation plugin is then never registered, which has four
consequences worth knowing:

- `window.history` is left alone. Nothing wraps `pushState` or `replaceState`.
- No `page_view` event is emitted.
- No record carries a `caused_by_id`, so autocapture events are no longer attributed to a page. A
  host that owns its page views can stamp the field itself from an `event` hook - see *Writing a
  plugin* - or register its own plugin under the `navigation` name, which is free once the built-in
  is off.
- A path change no longer refreshes the session. Scroll, keypress and click stay the only activity
  the session manager watches, so an application that moves users by timer or redirect can see one
  visit split across two sessions.

Events are queued in memory and flushed on a 5 second debounce, reset by each new event, plus an
immediate flush when the page goes to `visibilitychange` / hidden. The POST uses `keepalive`.

Log events after `start()`. The built-in plugins are only registered there, so anything logged
earlier goes out without session, device or app context.

Call `destroy()` on teardown. It runs the `destroy` hooks, sends whatever is still queued, and
removes the listeners.

## Configuration

`createTelemetry(config: TelemetryConfig)`

| Option              | Type      | Default    | Description                                                                                                                                                     |
| ------------------- | --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appName`           | `string`  | *required* | Sent as `context_source_app_name`, and the default for `context_service_name` and `context_app_name`.                                                             |
| `appVersion`        | `string`  | *required* | Application version, sent as `context_source_app_version` and mirrored into `context_app_version`.                                                                |
| `url`               | `string`  | see below  | Endpoint events are POSTed to. Defaults to the same-origin path `/api/events` when `apiVersion` is `1`, otherwise `/api/telemetry/v{apiVersion}/events`.           |
| `autocapture`       | `boolean` | `true`     | Automatically capture `click`, `change` and `submit` events from the page.                                                                                         |
| `navigationCapture` | `boolean` | `true`     | Record a `page_view` on every path change, and stamp later records with `caused_by_id`. When `false` the navigation plugin is not registered and `window.history` is left unwrapped. |
| `enabled`           | `boolean` | `true`     | When `false`, events are still collected, enriched and drained from the queue - only the POST is skipped.                                                          |
| `verbose`           | `boolean` | `false`    | Log SDK activity to the console.                                                                                                                                  |
| `storagePrefix`     | `string`  | none       | Infix for the `localStorage` keys the SDK owns: `telemetry_{storagePrefix}_device_id` and `telemetry_{storagePrefix}_session`. Set it to keep two clients apart.   |
| `sessionDuration`   | `number`  | `1800000`  | Inactivity window in milliseconds before a new session id is minted. 30 minutes.                                                                                  |
| `apiVersion`        | `number`  | `1`        | Event envelope version. `2` hoists fields shared by every record in a multi-record batch into `meta`, and drops `context_user_id` and `context_tenant_id`.         |

> **`url` defaults to the same-origin path `/api/events`, and a failed send loses the batch.**
> Always set it explicitly - see *Known gaps* below.

## API

`createTelemetry()` returns a `TelemetryService`:

| Method                 | Returns           | Description                                                                        |
| ---------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `start()`              | `TelemetryService`| Begin collecting. Registers the built-in plugins, installs listeners, starts the flush scheduler. |
| `identify(id)`         | `TelemetryService`| Attach a user id to subsequent events. `string \| number`.                          |
| `logEvent(name, data?)`| `void`            | Record a custom event. Also accepts a full record: `logEvent({ name, data, ... })`. |
| `plugin(...plugins)`   | `TelemetryService`| Register plugins. Falsy entries are ignored, so `cond && myPlugin()` is safe.       |
| `destroy()`            | `void`            | Run the `destroy` hooks, flush the queue, remove listeners, stop collecting.         |

All methods except `logEvent` and `destroy` are chainable.

Register plugins before `start()`. `setup()` runs inside `start()`, so a plugin passed to
`plugin()` afterwards is stored and never set up.

`destroy()` does not unregister plugin hooks, so calling `start()` again on the same client
registers them a second time. Build a new client instead.

## Framework integration

There is no app-wiring entry point in this package. The FrontX framework lives in template
territory, published from a repository of its own, and no ecosystem package may import template
territory at the source level - see
`packages/cyber-pilot-kit-frontx/guidelines/ecosystem-boundaries.md`. Binding this SDK to an app's
lifecycle or event bus is therefore template-side work, and this package exposes no API for it.
Create the client with `createTelemetry`, `start()` it where the app boots, `destroy()` it on
teardown.

## Locale plugin

Injects the current locale into every event record, normalized to BCP 47.

```ts
import { createTelemetry, telemetryLocalePlugin } from '@gears-frontx/telemetry';
import i18next from 'i18next';

createTelemetry({ appName: 'my-app', appVersion: '1.4.2' })
  .plugin(telemetryLocalePlugin(i18next))
  .start();
```

The plugin takes any `LocaleSource` - an object with a `language: string` property, read fresh on
every event. An `i18next` instance satisfies it directly; anything else needs a one-line adapter:

```ts
telemetryLocalePlugin({ get language() { return intl.locale; } });
```

Without it, `context_language` falls back to `navigator.language`, unnormalized.

## Writing a plugin

A plugin is `{ name, setup }`. `setup` receives a context with the normalized config, a `logEvent`,
session accessors, a logger, and `addHook`:

```ts
telemetry.plugin({
  name: 'tenant',
  setup: (context) => {
    context.addHook('event', (record) => {
      record.context_tenant_id = tenantId;
    });
  },
});
```

`context` and `record` are typed contextually, so there is nothing to import.

The `event` hook runs on every record before it is queued, so it can enrich or overwrite fields.
`start` and `destroy` hooks are also available. Plugins are keyed by `name`, so registering the
same name twice keeps the last one. `plugin()` ignores falsy arguments and is chainable.

## Autocapture

When `autocapture` is on, the SDK listens for `click`, `change` and `submit` on `document` (capture
phase, passive). A captured event is named `autocapture_{type}` and carries the element's tag name
(`$el_tag_name`), its text for anchors, buttons and labels (`$el_text`, truncated at 1000
characters), and a safe subset of its attributes (`$el_attr_*`). Anchor clicks also get
`$el_attr_href`, plus `$external_click_url` when the host differs from the current page.

### Opting out

Add `data-telemetry-no-capture` to an element to suppress capture for its subtree. Only presence
matters - the value is never read, so the bare attribute, `="true"` and anything else all opt out.
Remove the attribute to opt back in.

> Earlier builds suppressed only on the literal `="false"` and ignored everything else, so markup
> written against that reading keeps working - but drop the value, it means nothing now.

### Element hooks

Any element can register a hook that governs how autocapture treats events from its subtree:

```ts
import { telemetryElementHookKey } from '@gears-frontx/telemetry';

el[telemetryElementHookKey] = () => ({
  context: {
    context_service_name: 'settings-panel',
    context_service_version: '1.0.0',
    context_call_chain: ['settings-panel'],
  },
  data: { section: 'appearance' },
});
```

The key is a `Symbol.for` registry symbol, so hooks work across multiple copies of the SDK loaded
on the same page. On each captured event, autocapture walks from the target element up through its
ancestors (crossing shadow-root hosts) and invokes every hook it finds:

- returning `{ capture: false }` from **any** ancestor hook suppresses the whole event;
- the closest hook returning a contribution wins its entire field set - `context` and `data` are
  never mixed across hooks, so a partial return means "this hook contributed nothing";
- `data` merges *underneath* autocapture's own keys, which always win. Keys starting with `$` are
  reserved for the SDK and are stripped from a hook's `data`;
- a hook that throws does not drop the event; that element degrades to no contribution and the
  error is rethrown after the event is emitted, so it reaches `window.onerror`.

Only `context_service_name`, `context_service_version` and `context_call_chain` may be set through
a hook - anything else is dropped, and most other record fields are overwritten by built-in plugins
before send anyway.

Set `context_call_chain` whenever you set `context_service_name`: the built-in `appInfo` plugin
prepends the app name and warns if the resulting chain does not contain the service. The value must
be the registering element's complete chain below the app - the SDK never stitches chains together
across hooks.

The hook is a cross-package, cross-deployment contract: reader and writers can be on different
versions at once. Evolve it additively only. A semantic change to a field, or to the suppression or
merge behavior, needs a new `telemetryElementHookKey` registry string, not a new meaning for the
existing one.

## PII

Autocapture applies redaction before recording element values. A `password` or `hidden` input, or an
element whose `name` or `id` looks sensitive (`cvv`, `ssn`, `cardnum`, `pwd`, `routing`, and
similar), anywhere on the walked path drops the whole event, not just that element's fields. On
`select`, `textarea`, `contenteditable="true"` and any `input` whose type is not `button`,
`checkbox`, `submit` or `reset`, only `name`, `id` and `aria-label` are read. Values matching
credit-card or US-SSN patterns are dropped. This is a
safety net, **not** a compliance guarantee. Audit what your own markup exposes, and use the opt-out
attribute or an element hook on any subtree that renders personal data.

### Identifiers the SDK stores

Two keys in `localStorage`, both owned by the SDK. `storagePrefix` is inserted into each when set,
so a second client on the same origin can keep its own:

| key | holds | lifetime |
| --- | --- | --- |
| `telemetry_device_id` | a UUID sent as `context_device_id` on **every** record | persists until the key is removed |
| `telemetry_session` | the current session id, start time and last activity | replaced when `sessionDuration` elapses without activity |

`context_device_id` is a persistent pseudonymous identifier: it is not derived from anything the
user typed, and `identify()` does not affect it, but it does correlate every event from this browser
across sessions, reloads and signed-out visits. Treat it as personal data in your own privacy
assessment, and disclose it wherever you disclose cookies.

`enabled: false` does not stop either key from being written - it only skips the POST (see
`enabled` above). Gate `start()` itself on consent if the device id must not be written before then.

To forget a device, remove the key, then build a new client and `start()` it — a client is
single-use, so the id is minted by the next client's `start()`:

```ts
localStorage.removeItem('telemetry_device_id'); // or `telemetry_${storagePrefix}_device_id`
```

## Browser support

Modern evergreen browsers. Requires `fetch`, `localStorage`, `crypto.randomUUID` and `Intl.Locale`.
No polyfills are bundled.

## Known gaps

The SDK is being extracted from an internal codebase. These are tracked and will change:

- `url` defaults to same-origin `/api/events` - set `url` explicitly.
- The queue is cleared before the POST and a rejected `fetch` only reaches `console.error`, so a
  failed send drops that batch. There is no retry.
- The request body uses a Kafka REST Proxy envelope and stringifies each nested object field, so
  `data: { a: 'b' }` arrives as `data: { a: '"b"' }`. A pluggable transport will replace it.
- `Content-Type` is not configurable.
- Several `context_*` record fields are declared but never populated (tenant, user profile,
  screen size, touch support, DOM element id and value).

## Development

Node >=24.14.0, npm workspaces.

```sh
npm run build --workspace=@gears-frontx/telemetry            # tsup: cjs + esm + dts
npm run type-check --workspace=@gears-frontx/telemetry
npm run type-check:test --workspace=@gears-frontx/telemetry
npm run test:unit --workspace=@gears-frontx/telemetry        # vitest, happy-dom
node scripts/run-monorepo-unit-tests.mjs --run --project=telemetry
npm run demo:telemetry                                      # browser example on port 5273
```

47 tests live in `src/__tests__/` - `telemetry.test.ts` (23) and `autocapture.test.ts` (24).
`vitest` is pinned to an exact version, guarded repo-wide by
`scripts/check-test-dependency-versions.mjs`. The vitest `globalSetup` pins `TZ=UTC`, so timezone
assertions do not depend on the machine.

The test script must stay named `test:unit`: `scripts/test-runner/discovery.mjs` skips any workspace
that does not have it.

The browser example is `demo/`, served on port 5273 with a dev-server collector that echoes received
batches to the terminal. It never ships: `files[]` is a whitelist and the tsup entry is `src/index.ts`
alone.

Boundaries are enforced in root config, not by convention: the `packages/telemetry/src` block in
`eslint.config.js` bans intra-ecosystem `@gears-frontx` imports, React, and deep
`@gears-frontx/*/src/**` imports,
and `.dependency-cruiser.cjs` adds `frontx-telemetry-1-no-template-content` and
`frontx-single-intra-ecosystem-edge-telemetry-standalone`.

## License

Apache-2.0. `LICENSE` and `NOTICE` ship inside the package - Apache-2.0 section 4(d) expects the
NOTICE to travel with the distribution.
