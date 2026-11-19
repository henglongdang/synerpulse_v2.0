import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Meter, MoneyInput, StatusBadge } from '../src/components/ui';
import { ProgressRing, SegmentedBar } from '../src/components/charts';
import { ApiError } from '../src/lib/api';
import { dayLabel, initials, moneyShort } from '../src/lib/format';

function MoneyHarness({ onCents }: { onCents: (c: number | null) => void }) {
  const [v, setV] = useState<number | null>(null);
  return (
    <Field label="Amount">
      <MoneyInput
        value={v}
        onChange={(c) => {
          setV(c);
          onCents(c);
        }}
      />
    </Field>
  );
}

describe('MoneyInput', () => {
  it('emits exact integer cents and rejects invalid input', async () => {
    const spy = vi.fn();
    render(<MoneyHarness onCents={spy} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '1,234.56');
    expect(spy).toHaveBeenLastCalledWith(123456);
    await userEvent.clear(input);
    await userEvent.type(input, '0.1');
    expect(spy).toHaveBeenLastCalledWith(10);
    await userEvent.type(input, '23'); // "0.123" — three decimals is invalid
    expect(spy).toHaveBeenLastCalledWith(null);
  });
  it('blocks negatives unless allowed', async () => {
    const spy = vi.fn();
    render(<MoneyHarness onCents={spy} />);
    await userEvent.type(screen.getByLabelText('Amount'), '-5');
    expect(spy).toHaveBeenLastCalledWith(null);
  });
});

describe('Field', () => {
  it('wires label, error and aria-invalid for screen readers', () => {
    render(
      <Field label="Email" error="Enter a valid email address">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });
});

describe('status & meters', () => {
  it('never relies on colour alone', () => {
    render(<StatusBadge status="over" />);
    expect(screen.getByText('Over')).toBeInTheDocument();
  });
  it('exposes meter values to assistive tech', () => {
    render(<Meter valueBp={8550} label="Groceries budget used" />);
    expect(screen.getByRole('meter', { name: 'Groceries budget used' })).toHaveAttribute('aria-valuenow', '86');
  });
  it('labels goal rings and segmented bars with their values', () => {
    render(<ProgressRing bp={9300} label="Education fund" />);
    expect(screen.getByRole('img', { name: 'Education fund: 93% saved' })).toBeInTheDocument();
    render(
      <SegmentedBar
        currency="USD"
        ariaLabel="Spending by group"
        parts={[
          { key: 'a', label: 'Living', value: 7500, color: '#000' },
          { key: 'b', label: 'Entertainment', value: 2500, color: '#111' },
        ]}
      />,
    );
    expect(screen.getByLabelText('Living: $75.00 (75%)')).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('ApiError exposes field messages', () => {
    const e = new ApiError(400, 'bad_request', 'Invalid', { amountCents: ['Too large'] });
    expect(e.field('amountCents')).toBe('Too large');
    expect(new ApiError(0, 'network', 'offline').isNetwork).toBe(true);
  });
  it('formats days and initials', () => {
    expect(dayLabel('2026-11-19', '2026-11-19')).toBe('Today');
    expect(dayLabel('2026-11-18', '2026-11-19')).toBe('Yesterday');
    expect(initials('Mary Okafor')).toBe('MO');
    expect(moneyShort(1_250_000)).toBe('$12.5K');
    expect(moneyShort(99_900)).toBe('$999');
  });
});
