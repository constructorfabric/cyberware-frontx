/**
 * The frame one showcased kit component sits in.
 *
 * Shared by every category so the demos stay uniform, and so the DOM id the
 * category menu scrolls to is written in exactly one place.
 */

import React from 'react';
import styles from '../UIKitElements.module.css';

export interface ElementDemoProps {
  /** Element id from `CATEGORY_ELEMENTS`; the DOM id becomes `element-<id>`. */
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

export const ElementDemo: React.FC<ElementDemoProps> = ({
  id,
  title,
  description,
  children,
}) => (
  <div id={`element-${id}`} className={styles.demo}>
    <h3 className={styles.demoTitle}>{title}</h3>
    <p className={styles.demoDescription}>{description}</p>
    <div className={styles.demoStage}>{children}</div>
  </div>
);

ElementDemo.displayName = 'ElementDemo';
