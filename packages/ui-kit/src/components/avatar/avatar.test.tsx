import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from './avatar';
import styles from './avatar.module.css';

afterEach(cleanup);

/*
 * Base UI's Avatar tracks load status through a DETACHED `new
 * window.Image()` instance (see useImageLoadingStatus.js), not the
 * rendered <img> DOM node — jsdom performs no real network fetch, so the
 * real `window.Image` never fires `onload`/`onerror` on its own and every
 * AvatarImage would sit at 'loading' forever. This fake resolves
 * synchronously as soon as `src` is set, matching a cached-image load in a
 * real browser, so tests can assert both the 'loaded' and 'error' paths.
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = '';
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    if (value.includes('broken')) {
      this.onerror?.();
    } else {
      this.onload?.();
    }
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
});

describe('Avatar', () => {
  it('renders the fallback immediately when no image is provided', () => {
    render(
      <Avatar data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    const avatar = screen.getByTestId('avatar');
    expect(avatar.className).toContain(styles.avatar);
    expect(avatar.className).toContain(styles.sizeDefault);
    expect(screen.getByText('AB').className).toContain(styles.fallback);
  });

  it('hides the fallback and renders the image once it loads', async () => {
    render(
      <Avatar data-testid="avatar">
        <AvatarImage src="https://example.com/photo.png" alt="Jane Doe" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    const image = await waitFor(() => screen.getByAltText('Jane Doe'));
    expect(image.className).toContain(styles.image);
    await waitFor(() => expect(screen.queryByText('JD')).toBeNull());
  });

  it('falls back when the image fails to load', async () => {
    render(
      <Avatar data-testid="avatar">
        <AvatarImage src="https://example.com/broken.png" alt="Jane Doe" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    await waitFor(() => expect(screen.getByText('JD')).toBeTruthy());
    expect(screen.queryByAltText('Jane Doe')).toBeNull();
  });

  it('switches size classes via the size prop, defaulting to "default"', () => {
    const { rerender } = render(
      <Avatar size="sm" data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId('avatar').className).toContain(styles.sizeSm);
    rerender(
      <Avatar size="lg" data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId('avatar').className).toContain(styles.sizeLg);
  });

  /*
   * The fill matrix is CSS-only, so jsdom can see the class pairing but not
   * the resulting colors — the token values themselves are measured in the
   * browser. What matters here is the API contract: the untouched default
   * still resolves to the neutral/soft cell that `.fallback` painted before
   * the axes existed, so no existing call site shifted appearance.
   */
  it('defaults the fallback fill to neutral/soft and switches on tone and variant', () => {
    const { rerender } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    const fallback = screen.getByText('AB');
    expect(fallback.className).toContain(styles.toneNeutral);
    expect(fallback.className).toContain(styles.variantSoft);

    rerender(
      <Avatar>
        <AvatarFallback tone="danger" variant="solid">
          AB
        </AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('AB').className).toContain(styles.toneDanger);
    expect(screen.getByText('AB').className).toContain(styles.variantSolid);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(
      <Avatar className="consumer" data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    const avatar = screen.getByTestId('avatar');
    expect(avatar.className).toContain(styles.avatar);
    expect(avatar.className).toContain('consumer');
  });

  it('renders a status badge positioned against the root', () => {
    render(
      <Avatar data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
        <AvatarBadge data-testid="badge" />
      </Avatar>,
    );
    expect(screen.getByTestId('badge').className).toContain(styles.badge);
  });
});

describe('AvatarGroup', () => {
  it('renders overlapping avatars and an overflow count with the kit classes', () => {
    render(
      <AvatarGroup data-testid="group">
        <Avatar>
          <AvatarFallback>AB</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>CD</AvatarFallback>
        </Avatar>
        <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    const group = screen.getByTestId('group');
    expect(group.className).toContain(styles.group);
    expect(screen.getByTestId('count').className).toContain(styles.groupCount);
    expect(screen.getByText('+3')).toBeTruthy();
  });

  /*
   * The overflow chip shares AvatarFallback's fill cells rather than owning
   * a copy, so this asserts the sharing actually reaches it: same class
   * names on a different part. Whether those cells then paint the right
   * colors is AvatarFallback's test above plus the browser measurement —
   * not worth a third assertion of the same CSS.
   */
  it('gives the overflow count the same fill axes as the fallback, defaulting to neutral/soft', () => {
    const { rerender } = render(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback tone="accent" variant="solid">
            AB
          </AvatarFallback>
        </Avatar>
        <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    expect(screen.getByText('AB').className).toContain(styles.toneAccent);
    expect(screen.getByTestId('count').className).toContain(styles.toneNeutral);
    expect(screen.getByTestId('count').className).toContain(styles.variantSoft);

    rerender(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback tone="accent" variant="solid">
            AB
          </AvatarFallback>
        </Avatar>
        <AvatarGroupCount data-testid="count" tone="info" variant="solid">
          +3
        </AvatarGroupCount>
      </AvatarGroup>,
    );
    const count = screen.getByTestId('count');
    expect(count.className).toContain(styles.toneInfo);
    expect(count.className).toContain(styles.variantSolid);
    expect(count.className).toContain(styles.groupCount);
  });
});
