/**
 * useRoleDiscovery Hook Tests
 *
 * Tests for the role discovery client hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRoleDiscovery } from './useRoleDiscovery';
import type { Baseline } from '../types/discovery';

describe('useRoleDiscovery', () => {
  const mockBaseline: Baseline = {
    title: 'Senior Backend Engineer',
    level: 'senior',
    department: 'Engineering',
    workModel: 'remote',
    teamSize: '5 engineers',
    reportsTo: 'Engineering Manager',
    stack: ['TypeScript', 'Node.js', 'PostgreSQL'],
  };

  it('should initialize with baseline status', () => {
    const { result } = renderHook(() => useRoleDiscovery());

    expect(result.current.roleContext.status).toBe('baseline');
    expect(result.current.roleContext.baseline).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should update status after baseline submission', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    await waitFor(() => {
      expect(result.current.roleContext.status).toBe('exploring');
      expect(result.current.roleContext.baseline).toEqual(mockBaseline);
      expect(result.current.currentSection).not.toBeNull();
    });
  });

  it('should track cost over multiple operations', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    await waitFor(() => {
      expect(result.current.costTracking.sessionCost).toBeGreaterThan(0);
      expect(result.current.costTracking.callCount).toBeGreaterThan(0);
      expect(result.current.costTracking.remainingBudget).toBeLessThan(0.50);
    });
  });

  it('should submit responses and update context', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    const firstSection = result.current.currentSection;
    expect(firstSection).not.toBeNull();

    if (firstSection) {
      await act(async () => {
        await result.current.submitResponses([
          {
            questionId: firstSection.questions[0].id,
            response: 'Ship payment API v2 and reduce latency by 40%',
          },
        ]);
      });

      await waitFor(() => {
        expect(result.current.roleContext.exchanges.length).toBeGreaterThan(0);
      });
    }
  });

  it('should become ready after sufficient exploration', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    // Mock returning ready status
    await act(async () => {
      await result.current.submitResponses([
        {
          questionId: result.current.currentSection?.questions[0]?.id || '',
          response: 'Detailed response',
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
      expect(result.current.roleContext.status).toBe('ready');
    });
  });

  it('should throw error when generating JD before ready', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    await expect(async () => {
      await act(async () => {
        await result.current.generateJobDescription();
      });
    }).rejects.toThrow('Not ready to generate job description');
  });

  it('should reset to initial state', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    const idBeforeReset = result.current.roleContext.id;

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.roleContext.status).toBe('baseline');
    expect(result.current.roleContext.baseline).toBeNull();
    expect(result.current.roleContext.id).not.toBe(idBeforeReset);
    expect(result.current.currentSection).toBeNull();
    expect(result.current.costTracking.sessionCost).toBe(0);
  });

  it('should handle errors gracefully', async () => {
    const { result } = renderHook(() => useRoleDiscovery());

    // Try to submit responses without baseline
    await act(async () => {
      try {
        await result.current.submitResponses([
          { questionId: 'invalid', response: 'test' },
        ]);
      } catch (error) {
        // Expected to fail
      }
    });

    // Hook should still be functional
    expect(result.current.roleContext.status).toBe('baseline');
    expect(result.current.error).toBe(null);
  });
});
