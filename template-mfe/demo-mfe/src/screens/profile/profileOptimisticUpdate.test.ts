import { Language } from '@gears-frontx/react';
import { describe, expect, it, vi } from 'vitest';
import type { GetCurrentUserResponse } from '../../api/types';
import { UserRole } from '../../api/types';
import { applyOptimisticProfileUpdate } from './profileOptimisticUpdate';

describe('applyOptimisticProfileUpdate', () => {
  it('returns undefined when there is no cached profile to update', () => {
    expect(
      applyOptimisticProfileUpdate(undefined, {
        firstName: 'Grace',
        lastName: 'Hopper',
        department: 'Navy',
      })
    ).toBeUndefined();
  });

  it('maps edited profile fields into the cached response', () => {
    const current: GetCurrentUserResponse = {
      user: {
        id: 'user-42',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: UserRole.Admin,
        language: Language.English,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-02-01T00:00:00.000Z',
        extra: {
          department: 'Platform',
          team: 'Core',
        },
      },
    };

    const result = applyOptimisticProfileUpdate(
      current,
      {
        firstName: 'Grace',
        lastName: 'Hopper',
        department: 'Navy',
      },
      '2024-03-01T00:00:00.000Z'
    );

    expect(result).toEqual({
      user: {
        ...current.user,
        firstName: 'Grace',
        lastName: 'Hopper',
        updatedAt: '2024-03-01T00:00:00.000Z',
        extra: {
          department: 'Navy',
          team: 'Core',
        },
      },
    });
    expect(current.user.firstName).toBe('Ada');
    expect(current.user.extra?.department).toBe('Platform');
  });

  it('creates the extra payload when the cached profile has no extra fields', () => {
    const current: GetCurrentUserResponse = {
      user: {
        id: 'user-42',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: UserRole.Admin,
        language: Language.English,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-02-01T00:00:00.000Z',
      },
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:34:56.789Z'));

    try {
      expect(
        applyOptimisticProfileUpdate(current, {
          firstName: 'Grace',
          lastName: 'Hopper',
          department: 'Navy',
        })
      ).toEqual({
        user: {
          ...current.user,
          firstName: 'Grace',
          lastName: 'Hopper',
          updatedAt: '2024-03-15T12:34:56.789Z',
          extra: {
            department: 'Navy',
          },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
