//
// Runtime accessibility gate: axe-core over composed ui-kit markup.
//
// The static half of this check is eslint-plugin-jsx-a11y (see
// eslint.config.js), which reads one JSX file at a time. axe inspects the
// rendered DOM after React composes components, so it catches problems that
// only exist in the final tree — a Field whose label never gets associated
// with its Input, ARIA references pointing at ids that don't render, controls
// without an accessible name once composition is done.
//
// The fixture mirrors what generated apps actually build from the kit (the
// design-guardrails pilot's login/tasks screens): a labelled form, a checkbox,
// buttons, and status badges. It is a canary for the kit's composed a11y
// contract, not a page test — app screens get their own coverage in scaffolded
// projects.
//
// color-contrast is a browser-only rule (needs real paint/canvas), so axe
// skips it under jsdom; contrast stays covered by the design-guardrails
// review flow.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import 'vitest-axe/extend-expect';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  FieldLabel,
  Input,
  Label,
} from '@gears-frontx/ui-kit';

expect.extend(axeMatchers);

describe('ui-kit composed accessibility', () => {
  it('renders a kit-built form without axe violations', async () => {
    const { container } = render(
      <main>
        <h1>Sign in</h1>
        <form aria-label="Sign in">
          {/*
            The kit's Field is layout-only (a shadcn base-Field port, see
            field.tsx): label/control association is the consumer's job, done
            with htmlFor/id — exactly the wiring this gate exists to verify
            survives composition.
          */}
          <Field>
            <FieldLabel htmlFor="a11y-login">Login</FieldLabel>
            <Input id="a11y-login" type="text" autoComplete="username" />
          </Field>
          <Field>
            <FieldLabel htmlFor="a11y-password">Password</FieldLabel>
            <Input id="a11y-password" type="password" autoComplete="current-password" />
          </Field>
          <Label>
            <Checkbox /> Remember me
          </Label>
          <Button type="submit">Sign in</Button>
        </form>
      </main>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders kit list affordances without axe violations', async () => {
    const { container } = render(
      <main>
        <h1>Tasks</h1>
        <Button>Add</Button>
        <ul>
          <li>
            Ship the release <Badge>done</Badge>
          </li>
          <li>
            Write the report <Badge variant="secondary">open</Badge>
          </li>
        </ul>
      </main>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  // Canary: proves the gate is live under jsdom. If axe ever starts silently
  // skipping rules in this environment, the two green tests above would be
  // vacuous — this one fails first.
  it('still detects a known violation (unlabelled input)', async () => {
    const { container } = render(
      <main>
        <input type="text" />
      </main>,
    );

    const results = await axe(container);
    expect(results.violations.map((v) => v.id)).toContain('label');
  });
});
