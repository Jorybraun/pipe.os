// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaintWindow } from './PaintWindow';

const canvasContext = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  stroke: vi.fn(),
};

describe('PaintWindow', () => {
  beforeEach(() => {
    canvasContext.beginPath.mockClear();
    canvasContext.clearRect.mockClear();
    canvasContext.fillRect.mockClear();
    canvasContext.lineTo.mockClear();
    canvasContext.moveTo.mockClear();
    canvasContext.stroke.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    );
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 600,
      width: 960,
      height: 600,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits a long stroke once on pointer release instead of persisting every move', () => {
    const onChange = vi.fn();
    render(<PaintWindow strokes={[]} onChange={onChange} />);

    const canvas = screen.getByTestId('room-paint-canvas');
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1, buttons: 1 });

    for (let i = 1; i <= 40; i += 1) {
      fireEvent.pointerMove(canvas, {
        clientX: 10 + i * 6,
        clientY: 10 + i * 4,
        pointerId: 1,
        buttons: 1,
      });
    }

    expect(onChange).toHaveBeenCalledTimes(0);

    fireEvent.pointerUp(canvas, { clientX: 260, clientY: 180, pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextStrokes] = onChange.mock.calls[0] as [Array<{ points: Array<{ x: number; y: number }> }>];
    expect(nextStrokes).toHaveLength(1);
    expect(nextStrokes[0].points.length).toBeGreaterThan(10);
  });
});
