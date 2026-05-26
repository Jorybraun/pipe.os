/**
 * ContributionCalendar — renders a GitHub-style contribution grid as an SVG.
 *
 * 52 weeks × 7 days = 364 rects.
 * Color scale: 0 = transparent, 1–3 = light green, 4–6 = medium, 7–9 = bright, 10+ = intense.
 */

import type { ContributionCalendar as ContributionCalendarType } from '../../lib/api/types';

interface ContributionCalendarProps {
  calendar: ContributionCalendarType;
}

const CELL_SIZE = 10;
const CELL_GAP = 2;
const WEEK_WIDTH = CELL_SIZE + CELL_GAP;
const DAY_HEIGHT = CELL_SIZE + CELL_GAP;

function getColor(count: number): string {
  if (count === 0) return 'transparent';
  if (count <= 3) return 'rgba(16,185,129,0.25)';
  if (count <= 6) return 'rgba(16,185,129,0.5)';
  if (count <= 9) return 'rgba(16,185,129,0.75)';
  return '#10b981';
}

export function ContributionCalendar({ calendar }: ContributionCalendarProps): JSX.Element {
  const weeks = calendar.weeks;
  const width = weeks.length * WEEK_WIDTH;
  const height = 7 * DAY_HEIGHT;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        {weeks.map((week, weekIndex) =>
          week.contributionDays.map((day, dayIndex) => {
            const x = weekIndex * WEEK_WIDTH;
            const y = dayIndex * DAY_HEIGHT;
            const color = getColor(day.count);
            if (color === 'transparent') {
              return (
                <rect
                  key={`${weekIndex}-${dayIndex}`}
                  x={x}
                  y={y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  fill="rgba(255,255,255,0.03)"
                />
              );
            }
            return (
              <rect
                key={`${weekIndex}-${dayIndex}`}
                x={x}
                y={y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                fill={color}
              >
                <title>{`${day.date}: ${day.count} contribution${day.count === 1 ? '' : 's'}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
    </div>
  );
}
