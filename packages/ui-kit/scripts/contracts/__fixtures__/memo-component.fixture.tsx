// Fixture for extract.test.ts (M8): a component wrapped in React's
// memo(...) - the initializer is a CallExpression, not a function value
// directly, which is exactly the shape isReactComponentCandidate's old
// arrow/function-expression-only check missed: the export would have been
// silently read as "not component-shaped," undercounting check.ts's own
// enrollment report. forwardRef gets the same unwrap through the same
// unwrapComponentInitializer helper - covered once here since both wrappers
// share one code path (see extract.ts's isReactWrapperCall).
import { memo } from 'react';

export interface PingProps {
  label: string;
}

export const Ping = memo(({ label }: PingProps) => <span>{label}</span>);
