import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@gears-frontx/mfe-test-support/renderWithProviders';
import { TextLoader } from './TextLoader';

const mockUseTranslation = vi.fn();

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useTranslation: () => mockUseTranslation(),
}));

vi.mock('@/app/components/ui/skeleton', () => ({
  Skeleton: ({
    className,
    inheritColor,
  }: {
    className?: string;
    inheritColor?: boolean;
  }) => (
    <div
      data-testid="text-loader-skeleton"
      data-class-name={className}
      data-inherit-color={inheritColor ? 'true' : 'false'}
    />
  ),
}));

describe('TextLoader', () => {
  afterEach(() => {
    mockUseTranslation.mockReset();
  });

  it('renders the provided fallback while translations are loading', () => {
    mockUseTranslation.mockReturnValue({ language: undefined });

    renderWithProviders(
      <TextLoader fallback={<span>Loading title...</span>}>
        <span>Ready</span>
      </TextLoader>,
    );

    expect(screen.queryByText('Loading title...')).not.toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('renders a skeleton when translations are loading without a fallback', () => {
    mockUseTranslation.mockReturnValue({ language: undefined });

    renderWithProviders(
      <TextLoader skeletonClassName="h-6 w-32" inheritColor>
        <span>Ready</span>
      </TextLoader>,
    );

    const skeleton = screen.getByTestId('text-loader-skeleton');
    expect(skeleton.dataset.className).toBe('h-6 w-32');
    expect(skeleton.dataset.inheritColor).toBe('true');
  });

  it('renders nothing when translations are loading and no fallback is configured', () => {
    mockUseTranslation.mockReturnValue({ language: undefined });

    const { container } = renderWithProviders(
      <TextLoader>
        <span>Ready</span>
      </TextLoader>,
    );

    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
  });

  it('wraps the content when translations are ready and className is provided', () => {
    mockUseTranslation.mockReturnValue({ language: 'en' });

    const { container } = renderWithProviders(
      <TextLoader className="wrapper">
        <span>Ready</span>
      </TextLoader>,
    );

    const wrapper = container.querySelector('.wrapper');
    expect(wrapper?.textContent).toBe('Ready');
  });
});
