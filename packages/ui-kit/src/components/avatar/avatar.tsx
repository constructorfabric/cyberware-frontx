import type { ComponentProps } from 'react';
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { cva, cx, type VariantProps } from 'class-variance-authority';

import styles from './avatar.module.css';

/*
 * Upstream (apps/v4/registry/bases/base/ui/avatar.tsx) is a six-part
 * composition: Avatar/AvatarImage/AvatarFallback wrap Base UI's Avatar
 * primitive; AvatarBadge/AvatarGroup/AvatarGroupCount are plain `<span>`/
 * `<div>` markup with no primitive underneath (Base UI ships no
 * group/badge concept for Avatar) that upstream styles purely through a
 * `data-size`/`group-data-[size=…]` Tailwind relationship — Avatar's own
 * `size` prop stamps `data-size` on the root, and every sibling part reads
 * it back off that ancestor via a `group/avatar` selector.
 *
 * This kit has no Tailwind `group-data` equivalent, so the same
 * ancestor-to-descendant relationship is expressed with CVA + plain CSS
 * class selectors instead: `size` drives one of the root's own
 * `.sizeDefault`/`.sizeSm`/`.sizeLg` classes (the kit's standard `size`
 * axis, see button.tsx), and AvatarFallback/AvatarBadge's per-size rules in
 * avatar.module.css select off that same class on the ancestor
 * (`.sizeSm .fallback`, `.sizeLg .badge`, …) — the "ANCESTOR part read via
 * descendant" idiom tokens.test.ts already sanctions for Card's
 * `--card-*` custom properties, applied here with a class instead of a
 * custom property. AvatarGroupCount has no `size` prop of its own upstream
 * either — it sizes itself from the group's siblings via a `:has()`
 * equivalent of Tailwind's `group-has-data-[size=…]` (see avatar.module.css).
 */
const avatarVariants = cva(styles.avatar, {
  variants: {
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
      lg: styles.sizeLg,
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

export interface AvatarProps
  extends Omit<AvatarPrimitive.Root.Props, 'className'>,
    VariantProps<typeof avatarVariants> {
  className?: string;
}

export function Avatar({ className, size, ...props }: AvatarProps) {
  return <AvatarPrimitive.Root className={avatarVariants({ size, className })} {...props} />;
}

export interface AvatarImageProps extends Omit<AvatarPrimitive.Image.Props, 'className'> {
  className?: string;
}

export function AvatarImage({ className, ...props }: AvatarImageProps) {
  return <AvatarPrimitive.Image className={cx(styles.image, className)} {...props} />;
}

/*
 * The fallback's fill, from the Figma spec sheet "Phase 3 / Avatar"
 * (node 40001346:4724): six identity tones crossed with a solid/soft
 * treatment, every cell bound to a theme variable rather than to a
 * per-person hex.
 *
 * Upstream ships AvatarFallback with no variants at all, painting one
 * --muted/--muted-foreground pair. That pair is exactly this matrix's
 * neutral+soft cell, so the mockup's palette lands as two additive CVA axes
 * whose defaults reproduce upstream's single look byte for byte — no
 * existing call site changes appearance, and the parts/props stay
 * shadcn-shaped.
 *
 * Tone is identity styling, not status — the mockup's own component
 * description says so, and it matters for the API: a tone is derived from
 * WHO the avatar stands for (a stable hash of a user id, a team color),
 * never from a live state. AvatarBadge remains the status channel.
 */
const fillAxes = {
  tone: {
    neutral: styles.toneNeutral,
    accent: styles.toneAccent,
    info: styles.toneInfo,
    success: styles.toneSuccess,
    warning: styles.toneWarning,
    danger: styles.toneDanger,
  },
  variant: {
    solid: styles.variantSolid,
    soft: styles.variantSoft,
  },
};

const avatarFallbackVariants = cva(styles.fallback, {
  variants: fillAxes,
  defaultVariants: { tone: 'neutral', variant: 'soft' },
});

export interface AvatarFallbackProps
  extends Omit<AvatarPrimitive.Fallback.Props, 'className'>,
    VariantProps<typeof avatarFallbackVariants> {
  className?: string;
}

export function AvatarFallback({ className, tone, variant, ...props }: AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      className={avatarFallbackVariants({ tone, variant, className })}
      {...props}
    />
  );
}

export interface AvatarBadgeProps extends Omit<ComponentProps<'span'>, 'className'> {
  className?: string;
}

// No Base UI primitive backs this part upstream either — a plain <span>
// there and here, positioned onto the Avatar root's corner via CSS (see
// avatar.module.css's `.badge`, which relies on `.avatar` being its
// `position: relative` offset parent).
export function AvatarBadge({ className, ...props }: AvatarBadgeProps) {
  return <span className={cx(styles.badge, className)} {...props} />;
}

export interface AvatarGroupProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
}

export function AvatarGroup({ className, ...props }: AvatarGroupProps) {
  return <div className={cx(styles.group, className)} {...props} />;
}

/*
 * The overflow chip carries the SAME fill axes as AvatarFallback (one
 * shared `fillAxes`, one shared set of CSS cells) rather than a private
 * copy: it is a circle sitting in the same overlapping stack as the toned
 * members it caps off, so "+3" has to be able to match them. Its size still
 * comes from its siblings via `:has()` (see avatar.module.css) — only the
 * fill is a prop, because size is a property of the group while tone is a
 * choice about this one chip.
 */
const avatarGroupCountVariants = cva(styles.groupCount, {
  variants: fillAxes,
  defaultVariants: { tone: 'neutral', variant: 'soft' },
});

export interface AvatarGroupCountProps
  extends Omit<ComponentProps<'div'>, 'className'>,
    VariantProps<typeof avatarGroupCountVariants> {
  className?: string;
}

export function AvatarGroupCount({ className, tone, variant, ...props }: AvatarGroupCountProps) {
  return <div className={avatarGroupCountVariants({ tone, variant, className })} {...props} />;
}
