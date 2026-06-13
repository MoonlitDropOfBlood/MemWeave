import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrengthBar } from '../src/components/common/StrengthBar';

describe('<StrengthBar>', () => {
  it('renders 0.0 with 0% width and danger color', () => {
    const { container } = render(<StrengthBar value={0} />);
    const fill = container.querySelector('[style*="width: 0%"]') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.background).toBe('var(--danger)');
  });

  it('renders 1.0 with 100% width and accent color', () => {
    const { container } = render(<StrengthBar value={1} />);
    const fill = container.querySelector('[style*="width: 100%"]') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.background).toBe('var(--accent)');
  });

  it('renders the numeric value to 2 decimal places when label is enabled', () => {
    const { container } = render(<StrengthBar value={0.756} />);
    expect(container.textContent).toContain('0.76');
  });
});
