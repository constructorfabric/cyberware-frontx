// Fixture for extract.test.ts: two components extending a real Base UI
// primitive's Props type - the shape resolvePassthroughOrigin has to key by
// DECLARATION FILE, not by DOM tag. `WrapsButtonPrimitive` extends
// `ButtonPrimitive.Props`, declared directly in `button/Button.d.mts` (no
// part subdirectory - Base UI's Button has no separate parts), so its
// origin has no trailing part token. `WrapsAccordionRootPrimitive` extends
// `AccordionPrimitive.Root.Props`, declared in `accordion/root/AccordionRoot.d.mts`
// (a part subdirectory), so its origin gets a trailing `_root`. Both resolve
// to DOM tag `button`/`div` respectively through the same BaseUIComponentProps
// generic, but that tag is NOT what the origin key is built from - a real
// kit component (a future IconButton, say) built the same way as
// `WrapsButtonPrimitive` legitimately shares Button's own generated file,
// which is exactly the point (see PILOT-NOTES.md's passthrough-key fix).
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';
import { Button as ButtonPrimitive } from '@base-ui/react/button';

export interface WrapsButtonPrimitiveProps extends Omit<ButtonPrimitive.Props, 'className'> {
  className?: string;
}

export function WrapsButtonPrimitive(props: WrapsButtonPrimitiveProps) {
  return <button {...props} />;
}

export interface WrapsAccordionRootPrimitiveProps extends Omit<AccordionPrimitive.Root.Props, 'className'> {
  className?: string;
}

export function WrapsAccordionRootPrimitive(props: WrapsAccordionRootPrimitiveProps) {
  return <AccordionPrimitive.Root {...props} />;
}
