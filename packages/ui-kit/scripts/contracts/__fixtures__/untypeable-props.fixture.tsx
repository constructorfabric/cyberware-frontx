// Fixture for compile.test.ts: a component whose props are untypeable on
// BOTH sides of the own/inherited split, so one extraction exercises the
// whole "a property schema that asserts nothing must still say what the
// type is" rule.
//
// Own side: `selection` depends on the component's own type parameter and
// `onSelectionChange` is a function - neither has a JSON Schema
// representation, so both land in the slot branch; `label` is a plain
// string and stays typed, which is what makes a test able to tell the rule
// apart from "describe everything".
//
// Inherited side: `ComponentProps<'div'>` brings in React's own event
// handlers, `style` and `children` - the same class of type the accordion
// root's `value`/`defaultValue`/`onValueChange` fall into, reproduced here
// without depending on a specific Base UI version's prop set.
import type { ComponentProps } from 'react';

export interface PickerProps<Value> extends ComponentProps<'div'> {
  selection: Value[];
  onSelectionChange: (next: Value[]) => void;
  label: string;
}

export function Picker<Value>({ selection, onSelectionChange, label, ...props }: PickerProps<Value>) {
  return (
    <div {...props} onClick={() => onSelectionChange(selection)}>
      {label}
    </div>
  );
}
