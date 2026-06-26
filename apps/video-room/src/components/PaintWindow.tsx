import { useCallback, useEffect, useRef, useState } from 'react';

export interface PaintPoint {
  x: number;
  y: number;
}

export interface PaintStroke {
  color: string;
  size: number;
  points: PaintPoint[];
}

interface PaintWindowProps {
  strokes: PaintStroke[];
  onChange: (strokes: PaintStroke[]) => void;
}

const COLORS = ['#111111', '#e11d48', '#2563eb', '#16a34a', '#facc15', '#ffffff'];

function pointerToCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent): PaintPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: PaintStroke): void {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

export function PaintWindow({ strokes, onChange }: PaintWindowProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const activeStrokeRef = useRef<PaintStroke | null>(null);
  const strokeBaseRef = useRef<PaintStroke[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }
  }, [strokes]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToCanvasPoint(canvas, event);
    const stroke = { color, size, points: [point] };
    strokeBaseRef.current = strokes;
    activeStrokeRef.current = stroke;
    onChange([...strokeBaseRef.current, stroke]);
  }, [color, onChange, size, strokes]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const activeStroke = activeStrokeRef.current;
    if (!canvas || !activeStroke || event.buttons !== 1) return;
    const point = pointerToCanvasPoint(canvas, event);
    const updatedStroke = {
      ...activeStroke,
      points: [...activeStroke.points, point],
    };
    activeStrokeRef.current = updatedStroke;
    onChange([...strokeBaseRef.current, updatedStroke]);
  }, [onChange]);

  const endStroke = useCallback((): void => {
    activeStrokeRef.current = null;
  }, []);

  return (
    <div className="win95-paint">
      <div className="win95-paint-toolbar">
        {COLORS.map((swatch) => (
          <button
            key={swatch}
            className={`win95-paint-swatch${color === swatch ? ' is-active' : ''}`}
            style={{ background: swatch }}
            onClick={() => setColor(swatch)}
            aria-label={`Paint ${swatch}`}
            title={swatch === '#ffffff' ? 'Eraser' : swatch}
          />
        ))}
        <label className="win95-paint-size">
          <span>Size</span>
          <input
            type="range"
            min="2"
            max="18"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
        <button
          className="win95-paint-clear"
          onClick={() => onChange([])}
          type="button"
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={960}
        height={600}
        className="win95-paint-canvas"
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
