// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaintWindow, type PaintCanvasItem } from './PaintWindow';

const canvasContext = {
  arc: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  rect: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
};

describe('PaintWindow', () => {
  beforeEach(() => {
    canvasContext.arc.mockClear();
    canvasContext.beginPath.mockClear();
    canvasContext.clearRect.mockClear();
    canvasContext.closePath.mockClear();
    canvasContext.fill.mockClear();
    canvasContext.fillRect.mockClear();
    canvasContext.lineTo.mockClear();
    canvasContext.moveTo.mockClear();
    canvasContext.rect.mockClear();
    canvasContext.restore.mockClear();
    canvasContext.save.mockClear();
    canvasContext.setTransform.mockClear();
    canvasContext.stroke.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    );
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
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

  it('commits rectangle, diamond, and arrow shapes as canvas items', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PaintWindow strokes={[]} onChange={onChange} />);

    const canvas = screen.getByTestId('room-paint-canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 30, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 220, clientY: 130, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 220, clientY: 130, pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [rectangleItems] = onChange.mock.calls[0] as [PaintCanvasItem[]];
    expect(rectangleItems[0]).toMatchObject({ kind: 'rectangle' });

    rerender(<PaintWindow strokes={rectangleItems} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
    fireEvent.pointerDown(canvas, { clientX: 240, clientY: 150, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 360, clientY: 260, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 360, clientY: 260, pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(2);
    const [diamondItems] = onChange.mock.calls[1] as [PaintCanvasItem[]];
    expect(diamondItems).toHaveLength(2);
    expect(diamondItems[1]).toMatchObject({ kind: 'diamond' });

    rerender(<PaintWindow strokes={diamondItems} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Arrow' }));
    fireEvent.pointerDown(canvas, { clientX: 380, clientY: 280, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 520, clientY: 340, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 520, clientY: 340, pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(3);
    const [arrowItems] = onChange.mock.calls[2] as [PaintCanvasItem[]];
    expect(arrowItems).toHaveLength(3);
    expect(arrowItems[2]).toMatchObject({ kind: 'arrow' });
  });

  it('pans and zooms the viewport without committing drawing data', () => {
    const onChange = vi.fn();
    render(<PaintWindow strokes={[]} onChange={onChange} />);

    expect(screen.getByTestId('room-paint-zoom').textContent).toContain('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByTestId('room-paint-zoom').textContent).toContain('125%');

    const canvas = screen.getByTestId('room-paint-canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }));
    fireEvent.pointerDown(canvas, { clientX: 120, clientY: 120, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 160, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 160, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
    expect(canvasContext.setTransform).toHaveBeenCalledWith(1.25, 0, 0, 1.25, expect.any(Number), expect.any(Number));
  });
});
