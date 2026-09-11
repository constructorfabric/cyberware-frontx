import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Input } from '../input/input';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from './field';
import styles from './field.module.css';

afterEach(cleanup);

describe('Field', () => {
  it('defaults to the vertical orientation', () => {
    render(<Field data-testid="field">content</Field>);
    const field = screen.getByTestId('field');
    expect(field).toHaveProperty('tagName', 'DIV');
    expect(field.getAttribute('role')).toBe('group');
    expect(field.getAttribute('data-orientation')).toBe('vertical');
    expect(field.className).toContain(styles.orientationVertical);
  });

  it.each([
    ['horizontal', styles.orientationHorizontal],
    ['responsive', styles.orientationResponsive],
  ] as const)('applies the %s orientation class', (orientation, orientationClass) => {
    render(
      <Field data-testid="field" orientation={orientation}>
        content
      </Field>,
    );
    const field = screen.getByTestId('field');
    expect(field.getAttribute('data-orientation')).toBe(orientation);
    expect(field.className).toContain(orientationClass);
  });

  it('has no automatic id/htmlFor/aria-describedby wiring — the consumer wires it by hand', () => {
    render(
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" aria-describedby="email-desc" />
        <FieldDescription id="email-desc">We only use it for the invoice.</FieldDescription>
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveProperty('tagName', 'INPUT');
    const description = screen.getByText('We only use it for the invoice.');
    expect(input.getAttribute('aria-describedby')).toBe(description.id);
  });

  it('sets data-invalid/data-disabled as plain, consumer-provided attributes', () => {
    render(
      <Field data-testid="field" data-invalid data-disabled>
        content
      </Field>,
    );
    const field = screen.getByTestId('field');
    expect(field.getAttribute('data-invalid')).toBe('true');
    expect(field.getAttribute('data-disabled')).toBe('true');
  });
});

describe('FieldSet / FieldLegend', () => {
  it('renders a native fieldset with a legend, defaulting to the legend variant', () => {
    render(
      <FieldSet>
        <FieldLegend>Preferences</FieldLegend>
      </FieldSet>,
    );
    const legend = screen.getByText('Preferences');
    expect(legend).toHaveProperty('tagName', 'LEGEND');
    expect(legend.className).toContain(styles.variantLegend);
    expect(legend.closest('fieldset')).not.toBeNull();
  });

  it('applies the label variant', () => {
    render(<FieldLegend variant="label">Subscription plan</FieldLegend>);
    expect(screen.getByText('Subscription plan').className).toContain(styles.variantLabel);
  });
});

describe('FieldGroup / FieldContent / FieldTitle', () => {
  it('renders the container-query group and a content/title pair', () => {
    render(
      <FieldGroup data-testid="group">
        <FieldContent data-testid="content">
          <FieldTitle>Enable notifications</FieldTitle>
        </FieldContent>
      </FieldGroup>,
    );
    expect(screen.getByTestId('group').className).toContain(styles.fieldGroup);
    expect(screen.getByTestId('content').className).toContain(styles.fieldContent);
    expect(screen.getByText('Enable notifications').className).toContain(styles.fieldTitle);
  });
});

describe('FieldSeparator', () => {
  it('renders a divider with no content span when children are omitted', () => {
    render(<FieldSeparator data-testid="separator" />);
    const separator = screen.getByTestId('separator');
    expect(separator.querySelector(`.${styles.fieldSeparatorContent}`)).toBeNull();
    expect(separator.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('renders centered content when children are passed', () => {
    render(<FieldSeparator>Or continue with</FieldSeparator>);
    expect(screen.getByText('Or continue with').className).toContain(styles.fieldSeparatorContent);
  });
});

describe('FieldError', () => {
  it('renders nothing with neither children nor errors', () => {
    const { container } = render(<FieldError />);
    expect(container.firstChild).toBeNull();
  });

  it('renders explicit children over errors', () => {
    render(<FieldError errors={[{ message: 'ignored' }]}>Server rejected this value.</FieldError>);
    expect(screen.getByRole('alert').textContent).toBe('Server rejected this value.');
  });

  it('renders a single error message as plain text', () => {
    render(<FieldError errors={[{ message: 'Required.' }]} />);
    expect(screen.getByRole('alert').textContent).toBe('Required.');
  });

  it('dedups by message and renders multiple distinct errors as a list', () => {
    render(
      <FieldError
        errors={[{ message: 'Too short.' }, { message: 'Too short.' }, { message: 'Must include a number.' }]}
      />,
    );
    const alert = screen.getByRole('alert');
    const items = alert.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(alert.textContent).toContain('Too short.');
    expect(alert.textContent).toContain('Must include a number.');
  });
});
