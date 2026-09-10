// Fixture for extract.test.ts (M1): a heritage member wrapped in a generic
// type helper that is none of the six recognized shapes (Omit/Pick/
// VariantProps/ComponentProps/ComponentPropsWithRef/BaseUIComponentProps).
// `Readonly<T>` IS a real, resolvable type alias (declared in TypeScript's
// own lib.es5.d.ts), so the walk correctly unwraps into it - but its
// underlying type is a MappedTypeNode, a node kind walkPropsType/
// resolveTopLevelMembers do not understand at all. The old code's fallback
// for "not a type reference" (`if (!parts) return;`) silently gave up here
// with no note that a real heritage member - and whatever DOM/Base UI
// anchor or props it might have carried - went unclassified. This is the
// general "any type-reference node in heritage position that cannot be
// classified into a known shape" case M1 asks for, one level past the
// aliased-import cases the other two fixtures cover.
import type { ComponentProps } from 'react';

export interface UnknownWrapperProps extends Readonly<ComponentProps<'div'>> {
  label: string;
}

export function UnknownWrapper({ label, ...props }: UnknownWrapperProps) {
  return (
    <div aria-label={label} {...props}>
      {label}
    </div>
  );
}
