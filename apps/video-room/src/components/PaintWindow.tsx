import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Diamond,
  Hand,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface PaintPoint {
  x: number;
  y: number;
}

export interface PaintStroke {
  kind?: 'stroke';
  color: string;
  size: number;
  points: PaintPoint[];
}

export type PaintShapeKind = 'rectangle' | 'diamond' | 'arrow';

export interface PaintShape {
  kind: PaintShapeKind;
  color: string;
  size: number;
  start: PaintPoint;
  end: PaintPoint;
}

export type PaintCanvasItem = PaintStroke | PaintShape;
type PaintTool = 'pen' | PaintShapeKind | 'pan';

interface PaintViewport {
  zoom: number;
  pan: PaintPoint;
}

interface PaintWindowProps {
  strokes: PaintCanvasItem[];
  onChange: (strokes: PaintCanvasItem[]) => void;
  onPreview?: (strokes: PaintCanvasItem[]) => void;
  saveStatus?: string;
}

const COLORS = ['#111111', '#e11d48', '#2563eb', '#16a34a', '#facc15', '#ffffff'];
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;
const GRID_SIZE = 40;
const MIN_POINT_DISTANCE_PX = 2;
const PREVIEW_INTERVAL_MS = 120;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

const TOOL_OPTIONS: Array<{ id: PaintTool; label: string; icon: typeof Pencil }> = [
  { id: 'pen', label: 'Pencil', icon: Pencil },
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight },
  { id: 'pan', label: 'Pan', icon: Hand },
];

function isPaintShapeTool(tool: PaintTool): tool is PaintShapeKind {
  return tool === 'rectangle' || tool === 'diamond' || tool === 'arrow';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointerToViewportPoint(canvas: HTMLCanvasElement, event: React.PointerEvent): PaintPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function pointerToWorldPoint(
  canvas: HTMLCanvasElement,
  event: React.PointerEvent,
  viewport: PaintViewport,
): PaintPoint {
  const point = pointerToViewportPoint(canvas, event);
  return {
    x: (point.x - viewport.pan.x) / viewport.zoom,
    y: (point.y - viewport.pan.y) / viewport.zoom,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return color;
  const r = Number.parseInt(match[1]!, 16);
  const g = Number.parseInt(match[2]!, 16);
  const b = Number.parseInt(match[3]!, 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: PaintStroke): void {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (stroke.points.length === 1) {
    ctx.arc(stroke.points[0]!.x, stroke.points[0]!.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function shapeBounds(shape: PaintShape): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(shape.start.x, shape.end.x),
    y: Math.min(shape.start.y, shape.end.y),
    width: Math.abs(shape.end.x - shape.start.x),
    height: Math.abs(shape.end.y - shape.start.y),
  };
}

function drawShape(ctx: CanvasRenderingContext2D, shape: PaintShape): void {
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = colorWithAlpha(shape.color, shape.color === '#ffffff' ? 0.55 : 0.09);
  ctx.lineWidth = shape.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (shape.kind === 'arrow') {
    const dx = shape.end.x - shape.start.x;
    const dy = shape.end.y - shape.start.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const angle = Math.atan2(dy, dx);
    const headLength = Math.max(16, shape.size * 4);
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shape.end.x, shape.end.y);
    ctx.lineTo(
      shape.end.x - headLength * Math.cos(angle - Math.PI / 6),
      shape.end.y - headLength * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(shape.end.x, shape.end.y);
    ctx.lineTo(
      shape.end.x - headLength * Math.cos(angle + Math.PI / 6),
      shape.end.y - headLength * Math.sin(angle + Math.PI / 6),
    );
    ctx.stroke();
    return;
  }

  const bounds = shapeBounds(shape);
  if (bounds.width < 1 || bounds.height < 1) return;

  ctx.beginPath();
  if (shape.kind === 'rectangle') {
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else {
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    ctx.moveTo(midX, bounds.y);
    ctx.lineTo(bounds.x + bounds.width, midY);
    ctx.lineTo(midX, bounds.y + bounds.height);
    ctx.lineTo(bounds.x, midY);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, viewport: PaintViewport): void {
  const left = -viewport.pan.x / viewport.zoom;
  const top = -viewport.pan.y / viewport.zoom;
  const right = (canvas.width - viewport.pan.x) / viewport.zoom;
  const bottom = (canvas.height - viewport.pan.y) / viewport.zoom;
  const firstX = Math.floor(left / GRID_SIZE) * GRID_SIZE;
  const firstY = Math.floor(top / GRID_SIZE) * GRID_SIZE;

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1 / viewport.zoom;
  ctx.beginPath();
  for (let x = firstX; x <= right; x += GRID_SIZE) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = firstY; y <= bottom; y += GRID_SIZE) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
}

function drawCanvasItem(ctx: CanvasRenderingContext2D, item: PaintCanvasItem): void {
  if ('points' in item) {
    drawStroke(ctx, item);
    return;
  }
  drawShape(ctx, item);
}

function pointDistanceSquared(a: PaintPoint, b: PaintPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function appendPoint(stroke: PaintStroke, point: PaintPoint, force = false): PaintStroke {
  const lastPoint = stroke.points[stroke.points.length - 1];
  if (
    lastPoint
    && !force
    && pointDistanceSquared(lastPoint, point) < MIN_POINT_DISTANCE_PX * MIN_POINT_DISTANCE_PX
  ) {
    return stroke;
  }
  if (lastPoint && force && lastPoint.x === point.x && lastPoint.y === point.y) {
    return stroke;
  }
  return {
    ...stroke,
    points: [...stroke.points, point],
  };
}

function redrawCanvas(canvas: HTMLCanvasElement, items: PaintCanvasItem[], viewport: PaintViewport): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.pan.x, viewport.pan.y);
  drawGrid(ctx, canvas, viewport);
  for (const item of items) {
    drawCanvasItem(ctx, item);
  }
  ctx.restore();
}

export function PaintWindow({ strokes, onChange, onPreview, saveStatus }: PaintWindowProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<PaintTool>('pen');
  const [viewport, setViewport] = useState<PaintViewport>({ zoom: 1, pan: { x: 0, y: 0 } });
  const activeItemRef = useRef<PaintCanvasItem | null>(null);
  const activePanRef = useRef<{ start: PaintPoint; pan: PaintPoint } | null>(null);
  const itemBaseRef = useRef<PaintCanvasItem[]>([]);
  const lastPreviewAtRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    redrawCanvas(canvas, strokes, viewport);
  }, [strokes, viewport]);

  const previewItems = useCallback((nextItem: PaintCanvasItem, force = false): void => {
    const now = Date.now();
    if (!force && now - lastPreviewAtRef.current < PREVIEW_INTERVAL_MS) return;
    lastPreviewAtRef.current = now;
    onPreview?.([...itemBaseRef.current, nextItem]);
  }, [onPreview]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'pan') {
      activePanRef.current = {
        start: pointerToViewportPoint(canvas, event),
        pan: viewport.pan,
      };
      return;
    }

    const point = pointerToWorldPoint(canvas, event, viewport);
    const item: PaintCanvasItem = isPaintShapeTool(tool)
      ? { kind: tool, color, size, start: point, end: point }
      : { kind: 'stroke', color, size, points: [point] };
    itemBaseRef.current = strokes;
    activeItemRef.current = item;
    redrawCanvas(canvas, [...itemBaseRef.current, item], viewport);
    previewItems(item, true);
  }, [color, previewItems, size, strokes, tool, viewport]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas || event.buttons !== 1) return;

    const activePan = activePanRef.current;
    if (activePan) {
      const point = pointerToViewportPoint(canvas, event);
      setViewport((current) => ({
        ...current,
        pan: {
          x: activePan.pan.x + point.x - activePan.start.x,
          y: activePan.pan.y + point.y - activePan.start.y,
        },
      }));
      return;
    }

    const activeItem = activeItemRef.current;
    if (!activeItem) return;
    const point = pointerToWorldPoint(canvas, event, viewport);
    const updatedItem = 'points' in activeItem
      ? appendPoint(activeItem, point)
      : { ...activeItem, end: point };
    if (updatedItem === activeItem) return;
    activeItemRef.current = updatedItem;
    redrawCanvas(canvas, [...itemBaseRef.current, updatedItem], viewport);
    previewItems(updatedItem);
  }, [previewItems, viewport]);

  const endStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (activePanRef.current) {
      activePanRef.current = null;
      return;
    }

    let activeItem = activeItemRef.current;
    if (!activeItem) return;
    if (canvas) {
      const point = pointerToWorldPoint(canvas, event, viewport);
      activeItem = 'points' in activeItem
        ? appendPoint(activeItem, point, true)
        : { ...activeItem, end: point };
      redrawCanvas(canvas, [...itemBaseRef.current, activeItem], viewport);
    }
    const nextItems = [...itemBaseRef.current, activeItem];
    previewItems(activeItem, true);
    onChange(nextItems);
    activeItemRef.current = null;
  }, [onChange, previewItems, viewport]);

  const clearCanvas = useCallback((): void => {
    activeItemRef.current = null;
    activePanRef.current = null;
    itemBaseRef.current = [];
    onPreview?.([]);
    onChange([]);
  }, [onChange, onPreview]);

  const zoomBy = useCallback((delta: number): void => {
    setViewport((current) => ({
      ...current,
      zoom: clamp(Number((current.zoom + delta).toFixed(2)), MIN_ZOOM, MAX_ZOOM),
    }));
  }, []);

  const resetView = useCallback((): void => {
    setViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  }, []);

  return (
    <div className="win95-paint">
      <div className="win95-paint-toolbar">
        <div className="win95-paint-tool-group" aria-label="Paint tools">
          {TOOL_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                className={`win95-paint-tool${tool === option.id ? ' is-active' : ''}`}
                onClick={() => setTool(option.id)}
                aria-label={option.label}
                aria-pressed={tool === option.id}
                title={option.label}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
        <div className="win95-paint-palette" aria-label="Paint colors">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`win95-paint-swatch${color === swatch ? ' is-active' : ''}`}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
              aria-label={`Paint ${swatch}`}
              title={swatch === '#ffffff' ? 'White' : swatch}
            />
          ))}
        </div>
        <label className="win95-paint-size">
          <span>Size</span>
          <input
            type="range"
            min="2"
            max="18"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            aria-label="Stroke size"
          />
        </label>
        <div className="win95-paint-zoom" aria-label="Canvas zoom">
          <button
            className="win95-paint-tool"
            onClick={() => zoomBy(-ZOOM_STEP)}
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={viewport.zoom <= MIN_ZOOM}
          >
            <ZoomOut size={15} />
          </button>
          <span className="win95-paint-zoom-readout" data-testid="room-paint-zoom" aria-label="Zoom level">
            {Math.round(viewport.zoom * 100)}
            %
          </span>
          <button
            className="win95-paint-tool"
            onClick={() => zoomBy(ZOOM_STEP)}
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={viewport.zoom >= MAX_ZOOM}
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="win95-paint-tool"
            onClick={resetView}
            type="button"
            aria-label="Reset view"
            title="Reset view"
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <button
          className="win95-paint-tool"
          onClick={clearCanvas}
          type="button"
          aria-label="Clear canvas"
          title="Clear canvas"
        >
          <Trash2 size={15} />
        </button>
        {saveStatus && <span className="win95-paint-save-status">{saveStatus}</span>}
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={`win95-paint-canvas is-tool-${tool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        data-testid="room-paint-canvas"
        aria-label="Paint canvas"
      />
    </div>
  );
}
