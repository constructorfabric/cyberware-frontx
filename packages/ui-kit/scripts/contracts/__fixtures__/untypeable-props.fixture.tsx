// Fixture for compile.test.ts and extract.test.ts: a component whose props
// sit on either side of the "how much of this type can JSON Schema state"
// line, so one extraction exercises the whole rule.
//
// `chosen` is the shape a reviewer's question on the accordion contract
// turned up: a named alias that unwraps to an array. Nothing about the NAME
// `Chosen` is expressible, and everything about the type behind it is - so a
// classifier reading the printed name declares it inexpressible while the
// checker has already resolved it to `string[]`.
//
// `selection` is the same alias one step harder: an array of the
// component's own type parameter, which no `items` can state. It is
// checkably an array all the same, so it lands on the partly-stated side -
// typed `array`, still a slot, still described.
//
// `onSelectionChange` is a function: nothing to state, prose only, and the
// case that must never carry a module specifier into the committed text.
// `label` is a plain string and stays typed and undescribed, which is what
// makes a test able to tell the rule apart from "describe everything".
//
// Inherited side: `ComponentProps<'div'>` brings in React's own event
// handlers, `style` and `children` - the same class of type the accordion
// root's `render`/`style`/`onValueChange` fall into, reproduced here
// without depending on a specific Base UI version's prop set.
import type { ComponentProps } from 'react';

export type Chosen<Value = string> = Value[];

export interface PickerProps<Value> extends ComponentProps<'div'> {
  selection: Value[];
  chosen: Chosen;
  onSelectionChange: (next: Value[]) => void;
  label: string;
}

export function Picker<Value>({ selection, chosen, onSelectionChange, label, ...props }: PickerProps<Value>) {
  return (
    <div {...props} onClick={() => onSelectionChange(selection)}>
      {label}
      {chosen.join(', ')}
    </div>
  );
}
