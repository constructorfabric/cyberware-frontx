// @cpt-dod:cpt-frontx-dod-studio-devtools-control-panel:p1
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';
import { ButtonVariant, ButtonSize } from '../types';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        [ButtonVariant.Default]:
          'bg-primary text-primary-foreground shadow hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)]',
        [ButtonVariant.Destructive]:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--destructive)_90%,transparent)]',
        [ButtonVariant.Outline]:
          'border border-input bg-background text-foreground shadow-sm hover:bg-accent data-[state=open]:bg-accent',
        [ButtonVariant.Secondary]:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--secondary)_80%,transparent)]',
        [ButtonVariant.Ghost]: 'hover:bg-accent data-[state=open]:bg-accent',
        [ButtonVariant.Link]: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        [ButtonSize.Default]: 'h-9 px-4 py-2',
        [ButtonSize.Sm]: 'h-8 rounded-md px-3 text-xs',
        [ButtonSize.Lg]: 'h-10 rounded-md px-8',
        [ButtonSize.Icon]: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: ButtonVariant.Default,
      size: ButtonSize.Default,
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = ({
  ref,
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps & {
  ref?: React.Ref<HTMLButtonElement>;
}) => {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
};
Button.displayName = 'Button';

export { Button, buttonVariants };
