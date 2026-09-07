// Fixture for extract.test.ts (M1): a local type literally named `Omit`,
// shadowing TypeScript's global utility type for this file. `Omit` is a
// global ambient type with no module export of its own - there is no way
// to `import { Omit as ... }` it, so the failure mode that actually matters
// for Omit is the opposite direction from ComponentProps's alias case: a
// local name collision, not a renamed import. This shadow is generic (so
// the checker resolves it cleanly, no type error) but forwards its FIRST
// argument verbatim instead of omitting keys from it - nothing like the
// real Omit<T, K>. The old identifier-text match (`name === 'Omit' &&
// args.length > 0`) did not know or care what the resolved shadow actually
// does: it would have unwrapped `args[0]` (`ComponentProps<'span'>`) as if
// it were the real Omit<T, K> pattern and silently resolved a `span`
// passthrough kind/origin for props that DO exist on the checker-resolved
// type (this shadow really does forward them) but were never reached
// through the real Omit path the origin resolver is built around.
// classifyHeritageReference distinguishes the two by declaration file
// (TypeScript's own lib.es5.d.ts vs this fixture file), so the shadow
// correctly falls through to the ordinary named-reference unwrap instead -
// which then hits the walk's own honest limit (a bare, unsubstituted type
// parameter reference inside the shadow's own body) and reports it, rather
// than silently mis-attributing real inherited props to a coincidentally
// name-matched utility type.
import type { ComponentProps } from 'react';

type Omit<Source, _Excluded> = Source;

export type GadgetProps = Omit<ComponentProps<'span'>, 'unused'> & { count: number };

export function Gadget({ count, ...props }: GadgetProps) {
  return (
    <span {...props}>{count}</span>
  );
}
