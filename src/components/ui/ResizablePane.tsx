import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import type { ReactNode, CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// ResizablePane — thin wrapper over allotment with Pipe dark theme
// ---------------------------------------------------------------------------

interface ResizablePaneProps {
  children: ReactNode;
  vertical?: boolean;
  defaultSizes?: number[];
  minSizes?: number[];
  style?: CSSProperties;
  className?: string;
  onDragEnd?: (sizes: number[]) => void;
}

export function ResizablePane({
  children,
  vertical = false,
  defaultSizes,
  minSizes,
  style,
  className,
  onDragEnd,
}: ResizablePaneProps): JSX.Element {
  return (
    <>
      <style>{`
        .pipe-allotment .sash-container .sash {
          background: rgba(255, 255, 255, 0.06);
          transition: background 150ms ease;
        }
        .pipe-allotment .sash-container .sash:hover,
        .pipe-allotment .sash-container .sash.active {
          background: rgba(255, 255, 255, 0.14);
        }
        .pipe-allotment .sash-container .sash.vertical {
          width: 1px;
        }
        .pipe-allotment .sash-container .sash.horizontal {
          height: 1px;
        }
      `}</style>
      <div className={`pipe-allotment ${className ?? ''}`} style={{ height: '100%', width: '100%', ...style }}>
        <Allotment
          vertical={vertical}
          {...(defaultSizes ? { defaultSizes } : {})}
          {...(onDragEnd ? { onDragEnd } : {})}
        >
          {Array.isArray(minSizes)
            ? (Array.isArray(children) ? children : [children]).map((child, i) => (
                <Allotment.Pane key={i} minSize={minSizes[i] ?? 0}>
                  {child}
                </Allotment.Pane>
              ))
            : children}
        </Allotment>
      </div>
    </>
  );
}

export { Allotment };
export const Pane = Allotment.Pane;
