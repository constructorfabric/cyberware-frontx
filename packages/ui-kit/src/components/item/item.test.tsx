import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from './item';
import styles from './item.module.css';

afterEach(cleanup);

function renderItem() {
  return render(
    <Item data-testid="item">
      <ItemMedia variant="icon">
        <svg data-testid="icon" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Invoice #1024</ItemTitle>
        <ItemDescription>Paid on Jan 4</ItemDescription>
      </ItemContent>
      <ItemActions>
        <button type="button">Download</button>
      </ItemActions>
    </Item>,
  );
}

describe('Item', () => {
  it('renders a div by default, with the base + default variant + default size classes', () => {
    renderItem();
    const item = screen.getByTestId('item');
    expect(item).toHaveProperty('tagName', 'DIV');
    expect(item.className).toContain(styles.item);
    expect(item.className).toContain(styles.variantDefault);
    expect(item.className).toContain(styles.sizeDefault);
  });

  it('applies the outline/muted variant classes and the sm/xs size classes', () => {
    const { rerender } = render(<Item data-testid="item" variant="outline" size="sm" />);
    let item = screen.getByTestId('item');
    expect(item.className).toContain(styles.variantOutline);
    expect(item.className).toContain(styles.sizeSm);

    rerender(<Item data-testid="item" variant="muted" size="xs" />);
    item = screen.getByTestId('item');
    expect(item.className).toContain(styles.variantMuted);
    expect(item.className).toContain(styles.sizeXs);
  });

  it('renders every part with its kit class', () => {
    renderItem();
    expect(screen.getByText('Invoice #1024').className).toContain(styles.itemTitle);
    expect(screen.getByText('Paid on Jan 4').className).toContain(styles.itemDescription);
    expect(screen.getByRole('button', { name: 'Download' }).parentElement?.className).toContain(
      styles.itemActions,
    );
  });

  it('supports the render prop for polymorphism, e.g. rendering as an anchor', () => {
    render(<Item render={<a href="/invoices/1024" />}>Invoice #1024</Item>);
    const link = screen.getByRole('link', { name: 'Invoice #1024' });
    expect(link.className).toContain(styles.item);
    expect(link).toHaveProperty('href', expect.stringContaining('/invoices/1024'));
  });

  it('does not reflect variant/size as data attributes, per the kit-wide no-data-slot convention', () => {
    render(<Item data-testid="item" variant="outline" size="sm" />);
    const item = screen.getByTestId('item');
    expect(item.hasAttribute('data-variant')).toBe(false);
    expect(item.hasAttribute('data-size')).toBe(false);
    expect(item.hasAttribute('data-slot')).toBe(false);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Item data-testid="item" className="consumer" />);
    const item = screen.getByTestId('item');
    expect(item.className).toContain(styles.item);
    expect(item.className).toContain('consumer');
  });

  it('forwards native props such as onClick', () => {
    const onClick = vi.fn();
    render(<Item onClick={onClick}>content</Item>);
    fireEvent.click(screen.getByText('content'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ItemMedia', () => {
  it('defaults to the default variant and switches to icon/image', () => {
    const { rerender } = render(<ItemMedia data-testid="media" />);
    expect(screen.getByTestId('media').className).toContain(styles.itemMediaVariantDefault);
    rerender(<ItemMedia data-testid="media" variant="icon" />);
    expect(screen.getByTestId('media').className).toContain(styles.itemMediaVariantIcon);
    rerender(<ItemMedia data-testid="media" variant="image" />);
    expect(screen.getByTestId('media').className).toContain(styles.itemMediaVariantImage);
  });
});

describe('ItemGroup', () => {
  it('renders role="list" wrapping its Items', () => {
    render(
      <ItemGroup data-testid="group">
        <Item>One</Item>
        <ItemSeparator />
        <Item>Two</Item>
      </ItemGroup>,
    );
    const group = screen.getByRole('list');
    expect(group).toBe(screen.getByTestId('group'));
    expect(group.className).toContain(styles.itemGroup);
  });
});

describe('ItemHeader / ItemFooter', () => {
  it('render with their own kit classes', () => {
    render(
      <>
        <ItemHeader data-testid="header" />
        <ItemFooter data-testid="footer" />
      </>,
    );
    expect(screen.getByTestId('header').className).toContain(styles.itemHeader);
    expect(screen.getByTestId('footer').className).toContain(styles.itemFooter);
  });
});
