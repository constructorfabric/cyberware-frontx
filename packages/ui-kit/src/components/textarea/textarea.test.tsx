import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Field, FieldDescription, FieldLabel } from '../field/field';
import { Textarea } from './textarea';
import styles from './textarea.module.css';

afterEach(cleanup);

describe('Textarea', () => {
  it('renders a native textarea with the base class', () => {
    render(<Textarea placeholder="Notes" />);
    const textarea = screen.getByPlaceholderText('Notes');
    expect(textarea).toHaveProperty('tagName', 'TEXTAREA');
    expect(textarea.className).toContain(styles.textarea);
  });

  it('forwards value changes', () => {
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'line one' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'line one');
  });

  it('merges a consumer className and forwards native props', () => {
    render(<Textarea className="consumer" rows={6} disabled />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain(styles.textarea);
    expect(textarea.className).toContain('consumer');
    expect(textarea).toHaveProperty('rows', 6);
    expect(textarea).toHaveProperty('disabled', true);
  });

  // `field-sizing: content` (textarea.module.css) ignores the native
  // `rows`/`cols` attribute outright per spec - passing `rows` alone has
  // zero effect on rendered geometry in a browser that supports it. jsdom
  // does not implement `field-sizing`, so this only pins the mechanism
  // Textarea uses to recover a `rows`-driven floor: the `--rows` custom
  // property, set on the element only when a caller passes `rows`.
  it('sets --rows on style only when rows is passed, for the CSS floor to key off', () => {
    const { rerender } = render(<Textarea />);
    expect(screen.getByRole('textbox').style.getPropertyValue('--rows')).toBe('');

    rerender(<Textarea rows={8} />);
    expect(screen.getByRole('textbox').style.getPropertyValue('--rows')).toBe('8');
  });

  it('keeps a consumer style object alongside --rows', () => {
    render(<Textarea rows={8} style={{ color: 'red' }} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.style.color).toBe('red');
    expect(textarea.style.getPropertyValue('--rows')).toBe('8');
  });

  it('forwards the invalid state', () => {
    render(<Textarea aria-invalid={true} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('composes inside a Field via manual id/htmlFor/aria-describedby wiring', () => {
    // Unlike Input (still a Base UI primitive), Textarea has no primitive
    // to lean on, and the canonical Field wires nothing automatically —
    // every id below is set by hand, same as field.md's own examples.
    render(
      <Field>
        <FieldLabel htmlFor="notes">Notes</FieldLabel>
        <Textarea id="notes" disabled aria-describedby="notes-desc" />
        <FieldDescription id="notes-desc">Optional context.</FieldDescription>
      </Field>,
    );
    const textarea = screen.getByLabelText('Notes');
    expect(textarea).toHaveProperty('tagName', 'TEXTAREA');
    expect(textarea).toHaveProperty('disabled', true);
    const description = screen.getByText('Optional context.');
    expect(textarea.getAttribute('aria-describedby')).toBe(description.id);
  });
});
