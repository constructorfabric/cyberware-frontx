/**
 * Action Elements Category
 *
 * Demonstrates: Button, DropdownMenu
 */

import React, { useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit';
import { ElementDemo } from './ElementDemo';
import styles from '../UIKitElements.module.css';

interface ActionElementsProps {
  t: (key: string) => string;
  /**
   * Element inside this MFE's shadow root that the menu popup portals into.
   * Left to the kit's `<body>` default the popup lands in the light DOM, where
   * neither the adopted component stylesheets nor this host's tokens reach it.
   */
  portalContainer: React.RefObject<HTMLElement | null>;
}

export const ActionElements: React.FC<ActionElementsProps> = ({ t, portalContainer }) => {
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [view, setView] = useState('list');

  return (
    <section id="category-actions" className={styles.category}>
      <h2 className={styles.categoryTitle}>{t('category.actions')}</h2>

      <ElementDemo
        id="button"
        title={t('element.button.title')}
        description={t('element.button.description')}
      >
        <div className={styles.row}>
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
        </div>

        <div className={styles.row}>
          <Button size="sm">Small</Button>
          <Button>Default size</Button>
          <Button size="lg">Large</Button>
        </div>

        <div className={styles.row}>
          <Button disabled>Disabled</Button>
          {/*
            `loading` keeps the button focusable and reports `aria-busy` rather
            than setting the native disabled attribute, which would blur it.
          */}
          <Button loading>Loading</Button>
        </div>
      </ElementDemo>

      <ElementDemo
        id="dropdown"
        title={t('element.dropdown.title')}
        description={t('element.dropdown.description')}
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Options
          </DropdownMenuTrigger>
          <DropdownMenuContent container={portalContainer}>
            {/* DropdownMenuLabel throws outside a group; the group is not optional. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>
                Profile
                <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>Billing (unavailable)</DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuCheckboxItem
              checked={showBookmarks}
              onCheckedChange={setShowBookmarks}
            >
              Show bookmarks
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator />

            <DropdownMenuRadioGroup
              value={view}
              onValueChange={(value) => setView(String(value))}
            >
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuRadioItem value="list">
                List view
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="grid">
                Grid view
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More tools</DropdownMenuSubTrigger>
              {/* The submenu inherits the parent's container; naming it again costs nothing and documents it. */}
              <DropdownMenuSubContent container={portalContainer}>
                <DropdownMenuItem>Export</DropdownMenuItem>
                <DropdownMenuItem>Import</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem variant="destructive">
              Delete account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ElementDemo>
    </section>
  );
};

ActionElements.displayName = 'ActionElements';
