/**
 * Navigation Elements Category
 *
 * Demonstrates: Tabs
 */

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gears-frontx/ui-kit';
import { ElementDemo } from './ElementDemo';
import styles from '../UIKitElements.module.css';

interface NavigationElementsProps {
  t: (key: string) => string;
}

export const NavigationElements: React.FC<NavigationElementsProps> = ({ t }) => {
  return (
    <section id="category-navigation" className={styles.category}>
      <h2 className={styles.categoryTitle}>{t('category.navigation')}</h2>

      <ElementDemo
        id="tab"
        title={t('element.tab.title')}
        description={t('element.tab.description')}
      >
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="settings" disabled>
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p>Usage and quota for the current billing period.</p>
          </TabsContent>
          <TabsContent value="activity">
            <p>The last 30 deployments, newest first.</p>
          </TabsContent>
          <TabsContent value="settings">
            <p>Only an owner can change these.</p>
          </TabsContent>
        </Tabs>

        {/* The second variant the kit offers; `default` is the raised one above. */}
        <Tabs defaultValue="overview">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p>Usage and quota for the current billing period.</p>
          </TabsContent>
          <TabsContent value="activity">
            <p>The last 30 deployments, newest first.</p>
          </TabsContent>
        </Tabs>
      </ElementDemo>
    </section>
  );
};

NavigationElements.displayName = 'NavigationElements';
