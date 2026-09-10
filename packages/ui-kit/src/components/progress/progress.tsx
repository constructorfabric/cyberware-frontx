import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { cx } from 'class-variance-authority';

import styles from './progress.module.css';

/*
 * No variant/size axis — upstream ships none either (a single visual
 * treatment), so every part stays a plain `cx` composition rather than
 * inventing a CVA axis nothing calls for.
 *
 * Five exports, matching upstream's part set 1:1: `Progress` is the
 * convenience wrapper (Root + an auto-rendered Track/Indicator, mirroring
 * upstream's own composition), with Track/Indicator/Label/Value also
 * exported standalone for consumers composing their own layout — e.g. a
 * label above the bar, or a live percentage readout beside it.
 */

export interface ProgressProps extends Omit<ProgressPrimitive.Root.Props, 'className'> {
  className?: string;
}

export function Progress({ className, children, value, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root value={value} className={cx(styles.root, className)} {...props}>
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

export interface ProgressTrackProps extends Omit<ProgressPrimitive.Track.Props, 'className'> {
  className?: string;
}

export function ProgressTrack({ className, ...props }: ProgressTrackProps) {
  return <ProgressPrimitive.Track className={cx(styles.track, className)} {...props} />;
}

export interface ProgressIndicatorProps
  extends Omit<ProgressPrimitive.Indicator.Props, 'className'> {
  className?: string;
}

export function ProgressIndicator({ className, ...props }: ProgressIndicatorProps) {
  return <ProgressPrimitive.Indicator className={cx(styles.indicator, className)} {...props} />;
}

export interface ProgressLabelProps extends Omit<ProgressPrimitive.Label.Props, 'className'> {
  className?: string;
}

export function ProgressLabel({ className, ...props }: ProgressLabelProps) {
  return <ProgressPrimitive.Label className={cx(styles.label, className)} {...props} />;
}

export interface ProgressValueProps extends Omit<ProgressPrimitive.Value.Props, 'className'> {
  className?: string;
}

export function ProgressValue({ className, ...props }: ProgressValueProps) {
  return <ProgressPrimitive.Value className={cx(styles.value, className)} {...props} />;
}
