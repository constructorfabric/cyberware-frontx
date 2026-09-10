import React from 'react';
import { Button } from '../base/button';
import { ButtonVariant } from '../types';

interface GlassmorphicButtonProps {
  icon: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  isDragging?: boolean;
  /**
   * Declared rather than picked up from a rest spread, because this component
   * takes a closed prop set on purpose: the caller supplies an icon and the
   * component owns everything about how the control looks. The test id is the
   * one attribute a caller has to be able to put on the rendered control, so
   * it is admitted by name and nothing else comes with it.
   */
  'data-testid'?: string;
}

/**
 * Glassmorphic Button
 * Circular button with glassmorphic styling (blur, transparency, saturation)
 * Renders content behind it with a frosted glass effect
 */
export const GlassmorphicButton: React.FC<GlassmorphicButtonProps> = ({
  icon,
  onMouseDown,
  onClick,
  title,
  isDragging = false,
  'data-testid': testId,
}) => {
  return (
    <Button
      variant={ButtonVariant.Ghost}
      data-testid={testId}
      onMouseDown={onMouseDown}
      onClick={onClick}
      title={title}
      className="w-12 h-12 p-0 rounded-full flex items-center justify-center pointer-events-auto bg-white/20 dark:bg-black/50 backdrop-blur-md backdrop-saturate-[180%] border border-white/30 dark:border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.2)] hover:bg-white/30 dark:hover:bg-black/60 transition-colors"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {icon}
    </Button>
  );
};

GlassmorphicButton.displayName = 'GlassmorphicButton';
