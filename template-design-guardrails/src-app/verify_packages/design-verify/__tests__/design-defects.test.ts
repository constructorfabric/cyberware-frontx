//
// Unit tests for the pure rule logic of the dev-only runtime design-defect
// checker (src/designDefects.ts). The DOM walk, axe run, and
// layout-dependent measurements need a real browser (jsdom has no layout —
// scrollWidth is always 0 and there is no paint for contrast), so what lives
// here is the rule maths those measurements feed: the predicates and the
// heading-sequence rule. The live half is exercised by opening the app in
// dev mode, where the shell installs the checker when this package is present.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROL_HEIGHT_TOLERANCE_PX,
  CONTROL_TEXT_PX,
  FULL_BLEED_TOLERANCE_PX,
  MIN_CARD_PADDING_PX,
  TINY_TEXT_PX,
  collectHeadingSkipFindings,
  findCardEdgeFlush,
  findControlHeightMismatches,
  findHeadingSkips,
  installDesignDefectCheck,
  isClippedText,
  isFullBleedMedia,
  isSmallControlText,
  isTinyText,
  parseCssLengthPx,
  readTextFloors,
  shareVisualRow,
  spacingProbeSpec,
} from '../src/designDefects';

// axe-core's collection is stubbed to reject so the sweep-failure test below
// (K-002) can assert the rejection is caught, not left as an unhandled
// rejection.
vi.mock('axe-core', () => ({
  default: {
    run: () => Promise.reject(new Error('axe-core failed to run')),
  },
}));

describe('text floors from the installed ramp', () => {
  it('resolves px and rem tokens against the root font size, else null', () => {
    expect(parseCssLengthPx('0.6875rem', 16)).toBeCloseTo(11);
    expect(parseCssLengthPx(' 13px ', 16)).toBe(13);
    expect(parseCssLengthPx('', 16)).toBeNull();
    expect(parseCssLengthPx('1.2em', 16)).toBeNull();
    expect(parseCssLengthPx('calc(1rem - 2px)', 16)).toBeNull();
  });

  it('reads the floors from :root tokens and falls back to the shipped values', () => {
    const root = document.documentElement;
    root.style.removeProperty('--text-mono-size');
    root.style.removeProperty('--text-label-size');
    expect(readTextFloors()).toEqual({ tinyTextPx: TINY_TEXT_PX, controlTextPx: CONTROL_TEXT_PX });

    root.style.setProperty('--text-mono-size', '12px');
    root.style.setProperty('--text-label-size', '0.875rem');
    root.style.fontSize = '16px';
    expect(readTextFloors()).toEqual({ tinyTextPx: 12, controlTextPx: 14 });
    root.style.removeProperty('--text-mono-size');
    root.style.removeProperty('--text-label-size');
    root.style.removeProperty('font-size');
  });

  it('isSmallControlText: below the label floor, zero ignored', () => {
    expect(isSmallControlText(CONTROL_TEXT_PX - 1)).toBe(true);
    expect(isSmallControlText(CONTROL_TEXT_PX)).toBe(false);
    expect(isSmallControlText(12, 14)).toBe(true);
    expect(isSmallControlText(0)).toBe(false);
  });
});

describe('isTinyText', () => {
  it('flags visible text below the floor and accepts the floor itself', () => {
    expect(isTinyText(TINY_TEXT_PX - 0.5)).toBe(true);
    expect(isTinyText(TINY_TEXT_PX)).toBe(false);
    expect(isTinyText(16)).toBe(false);
  });

  it('ignores zero — jsdom and detached elements report 0, not tiny text', () => {
    expect(isTinyText(0)).toBe(false);
  });
});

describe('isClippedText', () => {
  it('flags hidden/clip overflow wider than the box', () => {
    expect(isClippedText({ scrollWidth: 200, clientWidth: 100, clientHeight: 20, overflowX: 'hidden', textOverflow: 'clip' })).toBe(true);
    expect(isClippedText({ scrollWidth: 200, clientWidth: 100, clientHeight: 20, overflowX: 'clip', textOverflow: 'clip' })).toBe(true);
  });

  it('accepts ellipsis as an intentional truncation treatment', () => {
    expect(isClippedText({ scrollWidth: 200, clientWidth: 100, clientHeight: 20, overflowX: 'hidden', textOverflow: 'ellipsis' })).toBe(false);
  });

  it('accepts scrollable and visible overflow', () => {
    expect(isClippedText({ scrollWidth: 200, clientWidth: 100, clientHeight: 20, overflowX: 'auto', textOverflow: 'clip' })).toBe(false);
    expect(isClippedText({ scrollWidth: 200, clientWidth: 100, clientHeight: 20, overflowX: 'visible', textOverflow: 'clip' })).toBe(false);
  });

  it('exempts the screen-reader-only pattern (content clipped in a ~1px box)', () => {
    expect(isClippedText({ scrollWidth: 51, clientWidth: 1, clientHeight: 1, overflowX: 'hidden', textOverflow: 'clip' })).toBe(false);
  });

  it('tolerates sub-pixel rounding', () => {
    expect(isClippedText({ scrollWidth: 101, clientWidth: 100, clientHeight: 20, overflowX: 'hidden', textOverflow: 'clip' })).toBe(false);
  });
});

describe('shareVisualRow', () => {
  it('bottom-aligned controls of different heights still share the row', () => {
    // items-end row: 40px input and 36px button, flush bottoms.
    expect(shareVisualRow(
      { top: 0, bottom: 40, height: 40 },
      { top: 4, bottom: 40, height: 36 }
    )).toBe(true);
  });

  it('controls stacked in separate rows do not', () => {
    expect(shareVisualRow(
      { top: 0, bottom: 40, height: 40 },
      { top: 56, bottom: 92, height: 36 }
    )).toBe(false);
  });

  it('a zero-height box never shares a row', () => {
    expect(shareVisualRow(
      { top: 0, bottom: 40, height: 40 },
      { top: 10, bottom: 10, height: 0 }
    )).toBe(false);
  });
});

describe('findControlHeightMismatches', () => {
  it('flags a default-size button beside a large input (the 36px-vs-40px case)', () => {
    expect(findControlHeightMismatches([
      { top: 0, bottom: 40, height: 40 },
      { top: 4, bottom: 40, height: 36 },
    ])).toEqual([{ a: 0, b: 1 }]);
  });

  it('accepts matched heights and tolerates border-box rounding', () => {
    expect(findControlHeightMismatches([
      { top: 0, bottom: 40, height: 40 },
      { top: 0, bottom: 40, height: 40 },
    ])).toEqual([]);
    expect(findControlHeightMismatches([
      { top: 0, bottom: 40, height: 40 },
      { top: 1, bottom: 40, height: 40 - CONTROL_HEIGHT_TOLERANCE_PX },
    ])).toEqual([]);
  });

  it('ignores controls the flex container has wrapped onto another line', () => {
    expect(findControlHeightMismatches([
      { top: 0, bottom: 40, height: 40 },
      { top: 48, bottom: 84, height: 36 },
    ])).toEqual([]);
  });
});

describe('findCardEdgeFlush', () => {
  const content = { left: 100, right: 400 };
  const bothSides = { left: true, right: true };

  it('flags ink flush against a drawn edge (the unpadded task-row case)', () => {
    expect(findCardEdgeFlush(content, [{ left: 100, right: 380 }], bothSides)).toEqual([
      { side: 'left', insetPx: 0 },
    ]);
  });

  it('accepts ink at or beyond the minimum padding on every drawn side', () => {
    expect(
      findCardEdgeFlush(content, [{ left: 100 + MIN_CARD_PADDING_PX, right: 400 - MIN_CARD_PADDING_PX }], bothSides)
    ).toEqual([]);
  });

  it('judges only the sides the card actually draws (divided list rows draw none)', () => {
    expect(findCardEdgeFlush(content, [{ left: 100, right: 400 }], { left: false, right: false })).toEqual([]);
    expect(findCardEdgeFlush(content, [{ left: 100, right: 400 }], { left: false, right: true })).toEqual([
      { side: 'right', insetPx: 0 },
    ]);
  });

  it('measures the closest ink per side across all content', () => {
    expect(
      findCardEdgeFlush(
        content,
        [
          { left: 116, right: 200 },
          { left: 101, right: 390 },
        ],
        bothSides
      )
    ).toEqual([{ side: 'left', insetPx: 1 }]);
  });

  it('reports nothing for an empty card', () => {
    expect(findCardEdgeFlush(content, [], bothSides)).toEqual([]);
  });
});

describe('isFullBleedMedia', () => {
  it('exempts media filling the card, within tolerance', () => {
    expect(isFullBleedMedia(300, 300)).toBe(true);
    expect(isFullBleedMedia(300, 300 - FULL_BLEED_TOLERANCE_PX)).toBe(true);
    expect(isFullBleedMedia(300, 280)).toBe(false);
    expect(isFullBleedMedia(0, 0)).toBe(false);
  });
});

describe('spacingProbeSpec', () => {
  it('maps padding and margin utilities to the sides they must move', () => {
    expect(spacingProbeSpec('p-8')).toEqual({ kind: 'self', properties: ['padding-top'] });
    expect(spacingProbeSpec('px-4')).toEqual({
      kind: 'self',
      properties: ['padding-left', 'padding-right'],
    });
    expect(spacingProbeSpec('ps-2')).toEqual({ kind: 'self', properties: ['padding-inline-start'] });
    expect(spacingProbeSpec('mt-1.5')).toEqual({ kind: 'self', properties: ['margin-top'] });
    expect(spacingProbeSpec('-m-4')).toEqual({ kind: 'self', properties: ['margin-top'] });
    expect(spacingProbeSpec('p-px')).toEqual({ kind: 'self', properties: ['padding-top'] });
  });

  it('maps gap and space-between utilities, space landing on a sibling', () => {
    expect(spacingProbeSpec('gap-4')).toEqual({ kind: 'self', properties: ['row-gap'] });
    expect(spacingProbeSpec('gap-x-2')).toEqual({ kind: 'self', properties: ['column-gap'] });
    expect(spacingProbeSpec('space-y-3')).toEqual({
      kind: 'sibling',
      properties: ['margin-top', 'margin-bottom'],
    });
  });

  it('ignores zero suffixes, variants, arbitrary values, and non-spacing classes', () => {
    expect(spacingProbeSpec('p-0')).toBeNull();
    expect(spacingProbeSpec('gap-0')).toBeNull();
    expect(spacingProbeSpec('md:p-8')).toBeNull();
    expect(spacingProbeSpec('p-[13px]')).toBeNull();
    expect(spacingProbeSpec('font-bold')).toBeNull();
    expect(spacingProbeSpec('padding')).toBeNull();
  });
});

describe('findHeadingSkips', () => {
  it('flags a level jump and names both sides', () => {
    expect(findHeadingSkips([1, 3])).toEqual([{ from: 1, to: 3 }]);
    expect(findHeadingSkips([2, 2, 4, 5])).toEqual([{ from: 2, to: 4 }]);
  });

  it('accepts descending and stepwise sequences', () => {
    expect(findHeadingSkips([1, 2, 3, 2, 3])).toEqual([]);
    expect(findHeadingSkips([3, 1, 2])).toEqual([]);
  });

  it('lets the first heading start at any level — screens inside a host begin below h1', () => {
    expect(findHeadingSkips([3])).toEqual([]);
    expect(findHeadingSkips([])).toEqual([]);
  });
});

describe('collectHeadingSkipFindings', () => {
  it('pairs each skip with the heading that caused it, not the first heading of that level', () => {
    // Levels [1, 3, 1, 3]: two independent skips (h1->h3 at index 1, h1->h3
    // at index 3), each must target its own h3 element, not both resolving
    // to the first one.
    const h3a = document.createElement('h3');
    h3a.id = 'first-h3';
    const h3b = document.createElement('h3');
    h3b.id = 'second-h3';
    const headingEls = [document.createElement('h1'), h3a, document.createElement('h1'), h3b];
    const headingLevels = [1, 3, 1, 3];

    const findings = collectHeadingSkipFindings(headingLevels, headingEls);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ id: 'skipped-heading', detail: 'heading level jumps h1 → h3', target: 'h3#first-h3' });
    expect(findings[1]).toMatchObject({ id: 'skipped-heading', detail: 'heading level jumps h1 → h3', target: 'h3#second-h3' });
    expect(findings[0].target).not.toBe(findings[1].target);
  });
});

describe('installDesignDefectCheck sweep failure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__frontxDesignDefects;
  });

  it('catches a rejected sweep instead of leaving an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    installDesignDefectCheck(0);
    // Real timers: let the scheduled sweep (and the mocked axe-core
    // rejection it awaits) settle.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errorSpy).toHaveBeenCalledWith('[design-defects] sweep failed:', expect.any(Error));
  });
});
