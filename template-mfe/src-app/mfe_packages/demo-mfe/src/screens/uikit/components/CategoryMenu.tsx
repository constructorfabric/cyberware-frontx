/**
 * CategoryMenu Component
 *
 * Renders a tree of the showcase's categories, each with element sub-items.
 * Clicking a category or element scrolls to it.
 * Active element is highlighted.
 */

import React, { useState } from 'react';
import { CATEGORIES, CATEGORY_ELEMENTS, type Category } from '../categories';
import styles from '../UIKitElements.module.css';

interface CategoryMenuProps {
  /**
   * Translation function from useScreenTranslations
   */
  t: (key: string) => string;
  /**
   * Currently active element ID (for highlighting)
   */
  activeElement?: string;
  /**
   * Container ref to access the shadow root for element queries
   */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * CategoryMenu component for UIKit Elements screen.
 *
 * Displays a hierarchical menu of categories and elements.
 * Clicking an item scrolls to the corresponding section.
 */
export const CategoryMenu: React.FC<CategoryMenuProps> = ({ t, activeElement, containerRef }) => {
  const [expandedCategories, setExpandedCategories] = useState<Set<Category>>(
    new Set(Object.values(CATEGORIES))
  );

  const toggleCategory = (category: Category) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const scrollToElement = (elementId: string) => {
    // Query the element from the root this MFE actually rendered into: its own
    // shadow root when it has one, the document otherwise.
    const root = containerRef.current?.getRootNode();
    const element =
      root instanceof ShadowRoot
        ? root.getElementById(elementId)
        : document.getElementById(elementId);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <nav className={styles.menu}>
      {/*
        Its own key, not the page title's: this heading and the `h1` would
        otherwise read as the same thing twice to a screen reader walking the
        headings.
      */}
      <h2 className={styles.menuTitle}>{t('menu_title')}</h2>
      <ul className={styles.menuList}>
        {Object.values(CATEGORIES).map(category => {
          const isExpanded = expandedCategories.has(category);
          const elements = CATEGORY_ELEMENTS[category];

          return (
            <li key={category}>
              <button
                type="button"
                onClick={() => {
                  toggleCategory(category);
                  scrollToElement(`category-${category}`);
                }}
                className={styles.categoryButton}
              >
                <span>{t(`category.${category}`)}</span>
                <span className={styles.disclosure}>{isExpanded ? '▼' : '▶'}</span>
              </button>
              {isExpanded && (
                <ul className={styles.menuSubList}>
                  {elements.map(element => {
                    const elementId = `element-${element}`;
                    const isActive = activeElement === elementId;

                    return (
                      <li key={element}>
                        <button
                          type="button"
                          onClick={() => scrollToElement(elementId)}
                          className={
                            isActive
                              ? `${styles.elementButton} ${styles.elementButtonActive}`
                              : styles.elementButton
                          }
                        >
                          {t(`element.${element}.title`)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

CategoryMenu.displayName = 'CategoryMenu';
