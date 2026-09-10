import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Slider } from './slider';
import styles from './slider.module.css';

afterEach(cleanup);

/*
 * `thumbAlignment="edge"` (this component's deliberate choice, matching
 * upstream — see slider.tsx) keeps a thumb fully inside the track instead
 * of overhanging its ends, but Base UI derives that inset from real
 * `getBoundingClientRect()` measurements of the control/thumb (see
 * SliderThumb.js's `getInsetPosition`). jsdom has no layout engine — every
 * rect comes back zero-sized, so the resulting percentage is `NaN` and the
 * thumb stays `visibility: hidden` (invisible to role queries) forever.
 * Stubbing non-zero rects (thumb narrower than control, so the inset math
 * resolves to a finite value) is the standard workaround for measurement-
 * driven components under jsdom; `findByRole`/`findAllByRole` then wait out
 * the microtask Base UI uses to flip visibility once the mocked rects
 * produce a real number.
 */
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const size = this.hasAttribute('data-index') ? 16 : 200;
    return {
      width: size,
      height: size,
      top: 0,
      left: 0,
      right: size,
      bottom: size,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    };
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

/*
 * Base UI puts the accessible name on the Thumb's nested <input> (see
 * SliderThumb.js's `aria-label`/`getAriaLabel`), not on Root — passing
 * `aria-label` to this convenience wrapper (as these tests do) lands on
 * Root's `role="group"` wrapper instead, same as upstream's own
 * translation. These tests query by role only (no `{ name }` filter) for
 * that reason, and cover the group-level label separately.
 */
describe('Slider', () => {
  it('renders a single thumb for a scalar value', async () => {
    render(<Slider defaultValue={50} aria-label="Volume" />);
    const thumbs = await screen.findAllByRole('slider');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveProperty('value', '50');
  });

  it('renders one thumb per entry for a range value', async () => {
    render(<Slider defaultValue={[20, 80]} aria-label="Price" />);
    const thumbs = await screen.findAllByRole('slider');
    expect(thumbs).toHaveLength(2);
    expect(thumbs.map((thumb) => thumb.getAttribute('value'))).toEqual(['20', '80']);
  });

  // Base UI initializes an unspecified slider to the scalar `min`, so the
  // thumb count has to follow that, not the [min, max] pair a "range by
  // default" reading would suggest.
  it('renders a single thumb when neither value nor defaultValue is given', async () => {
    render(<Slider aria-label="Volume" />);
    const thumbs = await screen.findAllByRole('slider');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveProperty('value', '0');
  });

  it('reports value changes and commits via keyboard input', async () => {
    const onValueChange = vi.fn();
    const onValueCommitted = vi.fn();
    render(
      <Slider
        defaultValue={50}
        aria-label="Volume"
        onValueChange={onValueChange}
        onValueCommitted={onValueCommitted}
      />,
    );
    const thumb = await screen.findByRole('slider');
    thumb.focus();
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith(51, expect.anything());
    expect(onValueCommitted).toHaveBeenCalledWith(51, expect.anything());
  });

  it('applies the base class, merges a consumer className, and forwards the group label', () => {
    render(<Slider defaultValue={10} aria-label="Level" className="consumer" />);
    const group = screen.getByRole('group', { name: 'Level' });
    expect(group.className).toContain(styles.root);
    expect(group.className).toContain('consumer');
  });

  it('marks the thumb input disabled, the actual interaction gate', () => {
    // A real browser refuses focus (and therefore keyboard input) on a
    // disabled form control; jsdom's looser `.focus()`/`dispatchEvent`
    // behavior lets a synthetic keydown reach a disabled input's listeners
    // regardless, which would make a "fire keydown, expect no change" test
    // here pass or fail on a jsdom quirk rather than on this component's
    // actual contract. `disabled` reaching the input is that contract —
    // assert it directly instead.
    render(<Slider defaultValue={10} disabled onValueChange={vi.fn()} />);
    const thumb = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(thumb).not.toBeNull();
    expect(thumb.disabled).toBe(true);
  });
});
