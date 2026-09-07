// Fixture for extract.test.ts (M2): ComponentProps<'tag'> with a hyphenated
// custom element tag name - a normal pattern (a component wrapping
// <my-custom-element>). The dom_ origin branch built its token as
// `dom_${tag}` verbatim, leaking the tag's hyphen into a token grammar
// that must be snake_case everywhere else (the base_ui branch normalizes
// every token; this one did not) - a real GTS id grammar violation with
// nothing to catch it before this fixture existed.
import type { ComponentProps } from 'react';

export type WidgetProps = ComponentProps<'my-custom-element'>;

export function Widget(props: WidgetProps) {
  return <div data-widget {...props} />;
}
