/**
 * Layout Elements Category
 *
 * Demonstrates: Card, Separator
 */

import React from 'react';
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,
} from '@gears-frontx/ui-kit';
import { ElementDemo } from './ElementDemo';
import styles from '../UIKitElements.module.css';

interface LayoutElementsProps {
  t: (key: string) => string;
}

export const LayoutElements: React.FC<LayoutElementsProps> = ({ t }) => {
  return (
    <section id="category-layout" className={styles.category}>
      <h2 className={styles.categoryTitle}>{t('category.layout')}</h2>

      <ElementDemo
        id="card"
        title={t('element.card.title')}
        description={t('element.card.description')}
      >
        <Card>
          <CardHeader>
            <CardTitle>Team plan</CardTitle>
            <CardDescription>Billed monthly, 5 seats in use.</CardDescription>
            {/* CardHeader lays itself out in two columns once it holds a CardAction. */}
            <CardAction>
              <Button variant="ghost" size="sm">
                Manage
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p>Next invoice on the 1st.</p>
          </CardContent>
          <CardFooter>
            <p className={styles.note}>Cancel any time before renewal.</p>
          </CardFooter>
        </Card>

        <Card size="sm">
          <CardContent>
            <p>A compact card, size="sm".</p>
          </CardContent>
        </Card>
      </ElementDemo>

      <ElementDemo
        id="separator"
        title={t('element.separator.title')}
        description={t('element.separator.description')}
      >
        <div>
          <p>Content above the separator</p>
          <Separator />
          <p>Content below the separator</p>
        </div>

        {/*
          A vertical Separator stretches to its flex parent's cross size, so it
          measures zero outside one — the row below is what gives it height.
        */}
        <div className={styles.row}>
          <span>Left content</span>
          <Separator orientation="vertical" />
          <span>Right content</span>
        </div>
      </ElementDemo>
    </section>
  );
};

LayoutElements.displayName = 'LayoutElements';
