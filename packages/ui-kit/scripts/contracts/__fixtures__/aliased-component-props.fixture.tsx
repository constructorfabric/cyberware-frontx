// Fixture for extract.test.ts (M1): `ComponentProps` imported under a
// different local name. The old text-only match (`parts.name ===
// 'ComponentProps'`) compared the identifier at the use site, so this would
// have read as "not ComponentProps at all" and silently dropped the DOM
// passthrough kind/origin - the same silent-loss shape F16 documents for
// cva, reintroduced here through import aliasing rather than file
// relocation. classifyHeritageReference resolves through the checker (real
// declared name + declaration file), so the alias is transparent to it.
import type { ComponentProps as ReactComponentProps } from 'react';

export type CardProps = ReactComponentProps<'section'> & {
  heading: string;
};

export function Card({ heading, ...props }: CardProps) {
  return (
    <section {...props}>
      <h2>{heading}</h2>
    </section>
  );
}
