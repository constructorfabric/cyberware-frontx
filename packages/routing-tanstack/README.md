# @gears-frontx/routing-tanstack

FrontX's default routing-engine provider: the published library that binds the navigation
substrate's shared browser history (`@gears-frontx/routing`) to TanStack Router. It projects the
one entry a microfrontend was mounted at into a virtual location that engine can navigate,
constructs the engine's router over that virtual history, and mounts it into that microfrontend's
own component tree — the same construction path whether the microfrontend is composed inside an
application or served standalone.

The navigation substrate stays engine-agnostic by constraint; this package is the deliberately
concrete side of that boundary. It is the only package in the ecosystem that imports a concrete
router engine, so a microfrontend can adopt a different conforming provider without a change to
the substrate, the host, or a sibling microfrontend.

See `architecture/` for the requirements (PRD), structure and constraints (DESIGN), and the
behavior the `engine-provider` FEATURE specifies.

## `EngineProvider`

`EngineProvider` is the component that mounts the adapted router into a microfrontend's own tree.
It takes one of two prop shapes:

- `{ routeTree, history }` — build a router from a route tree and an already-adapted virtual
  history (the usual case, whether the microfrontend is composed inside an application or served
  standalone).
- `{ router }` — mount a router that was already constructed elsewhere, for example through
  `createEngineProviderRouter`.

Mounting through `EngineProvider` — either shape — is what releases the shared navigation history
subscription when the microfrontend unmounts. `EngineProvider` re-establishes that subscription on
mount and tears it down on unmount, so a component that mounts and unmounts repeatedly (including
React's development-mode double-mount) never leaks or duplicates it.

A raw `RouterProvider` mounted directly, bypassing `EngineProvider`, does not do this: nothing
calls the router's history's teardown when that raw mount unmounts, so a microfrontend choosing
that path owns releasing the history itself.

## License

Apache-2.0. `LICENSE` and `NOTICE` ship inside the package.
