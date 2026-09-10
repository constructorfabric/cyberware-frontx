# Fixture Overlay

A minimal, self-contained synthetic "overlay"-shaped template used only by
the CLI's own test suite. It declares NO `package.json` in its ownership
boundaries — it only adds content under `src-app/mfe_packages/` onto a
self-contained "shell" template (`../fixture-shell`), the way `frontx add`
composes an add-only template onto an already-seeded project.

This file, `package.json`, and `package-lock.json` are authoring/build
machinery for this fixture directory itself — not part of the template's
declared, shipped content — the same "allow-listed, not shipped" pattern
real split templates use for their own monorepo build harness.
