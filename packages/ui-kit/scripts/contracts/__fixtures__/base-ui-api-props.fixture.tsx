// Fixture for extract.test.ts: two components extending a real Base UI
// primitive's Props type - the shape the declaration-site classification has
// to file as this component's API rather than as forwarded DOM surface.
// `WrapsButtonPrimitive` extends `ButtonPrimitive.Props` and
// `WrapsAccordionRootPrimitive` extends `AccordionPrimitive.Root.Props`, so
// each carries the props Base UI declares for that part (`nativeButton` and
// `render` for the button, `multiple` and `value` for the accordion root)
// alongside React's own attributes for the element underneath. Both resolve a
// host element through the same BaseUIComponentProps generic - `button` and
// `div` - and that element decides which hand-written passthrough type the
// contract names, while the part's own props reach the contract's
// properties. Two components wrapping the same primitive legitimately share
// the same element surface, which is the point: React's attributes for a
// `<button>` are the same attributes whoever renders it.
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';
import { Button as ButtonPrimitive } from '@base-ui/react/button';

export interface WrapsButtonPrimitiveProps extends Omit<ButtonPrimitive.Props, 'className'> {
  className?: string;
}

export function WrapsButtonPrimitive(props: WrapsButtonPrimitiveProps) {
  // The primitive, not a raw <button>: everything the extractor reads here is
  // the TYPE, and spreading Base UI's own props onto a bare element is a type
  // error - its `style` accepts a function of the part's state, which React's
  // does not. That difference is one of the facts this fixture exists to
  // exercise, so the render body has to be the shape a real wrapper uses.
  return <ButtonPrimitive {...props} />;
}

export interface WrapsAccordionRootPrimitiveProps extends Omit<AccordionPrimitive.Root.Props, 'className'> {
  className?: string;
}

export function WrapsAccordionRootPrimitive(props: WrapsAccordionRootPrimitiveProps) {
  return <AccordionPrimitive.Root {...props} />;
}
