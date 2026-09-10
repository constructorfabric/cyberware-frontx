// Fixture for extract.test.ts and compile.test.ts: a cva config with a
// BOOLEAN variant alongside a string one.
//
// class-variance-authority keys a boolean variant's map by `true`/`false`
// and `VariantProps` types the resulting prop as `boolean`. Read as an
// ordinary string axis, the compiled contract stated a prop accepting only
// the strings "true" and "false" - a shape no caller can satisfy, since
// `fullWidth` takes a boolean - and its default was lost outright: a
// `defaultVariants` entry written as `false` is not a string literal, so the
// old walk recorded "not a string literal" in a note that did not begin
// `cva:` and therefore failed nothing.
//
// `emphasis` is the control: a real string axis in the same config, so a
// test can tell "read a boolean axis as boolean" apart from "read every axis
// as boolean".
import { cva, type VariantProps } from 'class-variance-authority';

const panelVariants = cva('panel', {
  variants: {
    fullWidth: {
      true: 'panel-full',
      false: 'panel-auto',
    },
    // The `true`-only form, which is the common one in real configs: a
    // variant with no styling for the false branch.
    raised: {
      true: 'panel-raised',
    },
    // The mirrored single-key form: cva resolves `StringToBoolean<'false'>`
    // to `boolean` just as it does for `'true'`, so this is a boolean prop
    // too - read as a string axis it stated a prop accepting only the
    // string "false".
    unstyled: {
      false: 'panel-styled',
    },
    emphasis: {
      low: 'panel-low',
      high: 'panel-high',
    },
  },
  defaultVariants: {
    fullWidth: false,
    emphasis: 'low',
  },
});

export type PanelProps = VariantProps<typeof panelVariants>;

export function Panel({ fullWidth, raised, unstyled, emphasis }: PanelProps) {
  return <div className={panelVariants({ fullWidth, raised, unstyled, emphasis })} />;
}
