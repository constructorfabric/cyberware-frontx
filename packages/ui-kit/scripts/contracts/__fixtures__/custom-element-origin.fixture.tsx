// Fixture for extract.test.ts (M2): ComponentProps<'tag'> with a hyphenated
// custom element tag name - a normal pattern (a component wrapping
// <my-custom-element>). The dom_ origin branch built its token as
// `dom_${tag}` verbatim, leaking the tag's hyphen into a token grammar
// that must be snake_case everywhere else (the base_ui branch normalizes
// every token; this one did not) - a real GTS id grammar violation with
// nothing to catch it before this fixture existed.
//
// `keyof JSX.IntrinsicElements` (React's own ComponentProps constraint)
// only recognizes tags React ships types for, so a genuinely unknown custom
// element name needs its own IntrinsicElements entry the same way a real
// consumer would add one - this augments the module React's own types
// export it from (JSX resolves through react/jsx-runtime under `jsx:
// "react-jsx"`, not a bare global namespace, since @types/react 19 no
// longer declares one), scoped to this file only. The origin resolution
// this fixture exercises reads the TYPE (ComponentProps<'my-custom-element'>),
// never the render body, so rendering the real tag instead of a stand-in
// element is what keeps the augmented props type (whose `ref` targets
// HTMLElement) assignable - a literal <div> would conflict on `ref`.
import type { ComponentProps } from 'react';

declare global {
  // Declaration merging into a JSX namespace has no ES module syntax
  // equivalent - the rule's own default (`allowDefinitionFiles`) already
  // accepts this shape in a .d.ts file; a fixture that must also compile
  // as ordinary source needs the same exemption spelled out locally.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace React.JSX {
    interface IntrinsicElements {
      'my-custom-element': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export type WidgetProps = ComponentProps<'my-custom-element'>;

export function Widget(props: WidgetProps) {
  return <my-custom-element data-widget {...props} />;
}
