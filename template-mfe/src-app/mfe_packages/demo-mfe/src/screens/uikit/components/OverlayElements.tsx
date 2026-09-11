/**
 * Overlay Elements Category
 *
 * Demonstrates: Dialog
 */

import React from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldLabel,
  Input,
} from '@gears-frontx/ui-kit';
import { ElementDemo } from './ElementDemo';
import styles from '../UIKitElements.module.css';

interface OverlayElementsProps {
  t: (key: string) => string;
  /**
   * Element inside this MFE's shadow root that the dialog portals into. Left to
   * the kit's `<body>` default the popup lands in the light DOM, where neither
   * the adopted component stylesheets nor this host's tokens reach it.
   */
  portalContainer: React.RefObject<HTMLElement | null>;
}

export const OverlayElements: React.FC<OverlayElementsProps> = ({ t, portalContainer }) => {
  return (
    <section id="category-overlays" className={styles.category}>
      <h2 className={styles.categoryTitle}>{t('category.overlays')}</h2>

      <ElementDemo
        id="dialog"
        title={t('element.dialog.title')}
        description={t('element.dialog.description')}
      >
        <div className={styles.row}>
          <Dialog>
            {/*
              DialogTrigger and DialogClose render unstyled native buttons; the
              kit's Button arrives through `render`, not by wrapping them.
            */}
            <DialogTrigger render={<Button variant="outline" />}>
              New project
            </DialogTrigger>
            <DialogContent container={portalContainer}>
              <DialogHeader>
                {/* Required: it is the dialog's accessible name. */}
                <DialogTitle>New project</DialogTitle>
                <DialogDescription>Projects group deployments and their settings.</DialogDescription>
              </DialogHeader>
              {/* Field wires no ids of its own, so the pair is joined by hand. */}
              <Field>
                <FieldLabel htmlFor="overlay-demo-project">Project name</FieldLabel>
                <Input id="overlay-demo-project" placeholder="acme-web" />
              </Field>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <DialogClose render={<Button />}>Create</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger render={<Button variant="destructive" />}>
              Delete project
            </DialogTrigger>
            <DialogContent container={portalContainer}>
              <DialogHeader>
                <DialogTitle>Delete project</DialogTitle>
                <DialogDescription>
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <DialogClose render={<Button variant="destructive" />}>
                  Delete
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ElementDemo>
    </section>
  );
};

OverlayElements.displayName = 'OverlayElements';
