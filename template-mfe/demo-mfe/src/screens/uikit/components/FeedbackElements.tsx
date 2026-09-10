/**
 * Feedback Elements Category
 *
 * Demonstrates: Toast, Skeleton
 */

import React from 'react';
import { Button, Card, CardContent, Skeleton, toast } from '@gears-frontx/ui-kit';
import { ElementDemo } from './ElementDemo';
import styles from '../UIKitElements.module.css';

interface FeedbackElementsProps {
  t: (key: string) => string;
}

export const FeedbackElements: React.FC<FeedbackElementsProps> = ({ t }) => {
  /*
   * Toasts are fired imperatively against the manager the screen's Toaster
   * shares — the kit exports no toast parts to compose as JSX. A call made
   * before that Toaster mounts is dropped silently, which is why the buttons
   * below (not this module) are what fire them.
   */
  const handlePlainToast = () => {
    toast.add({
      title: 'Saved',
      description: 'Your changes have been saved.',
    });
  };

  const handleErrorToast = () => {
    toast.add({
      type: 'error',
      title: 'Failed to save',
      description: 'Check your connection and retry.',
    });
  };

  const handleActionToast = () => {
    toast.add({
      title: 'File deleted',
      actionProps: {
        children: 'Undo',
        onClick: () => toast.add({ title: 'Restored' }),
      },
    });
  };

  return (
    <section id="category-feedback" className={styles.category}>
      <h2 className={styles.categoryTitle}>{t('category.feedback')}</h2>

      <ElementDemo
        id="toast"
        title={t('element.toast.title')}
        description={t('element.toast.description')}
      >
        <div className={styles.row}>
          <Button onClick={handlePlainToast}>Show a toast</Button>
          <Button variant="destructive" onClick={handleErrorToast}>
            Show an error toast
          </Button>
          <Button variant="outline" onClick={handleActionToast}>
            Show a toast with an action
          </Button>
        </div>
      </ElementDemo>

      <ElementDemo
        id="skeleton"
        title={t('element.skeleton.title')}
        description={t('element.skeleton.description')}
      >
        {/*
          Skeleton carries no loading semantics and no dimensions of its own —
          the region announces the state, and the consumer sizes each instance.
        */}
        <Card role="status" aria-busy="true">
          <CardContent>
            <div className={styles.placeholders}>
              <Skeleton className={styles.placeholderTitle} />
              <Skeleton className={styles.placeholderLine} />
              <Skeleton className={styles.placeholderLine} />
            </div>
          </CardContent>
        </Card>
      </ElementDemo>
    </section>
  );
};

FeedbackElements.displayName = 'FeedbackElements';
