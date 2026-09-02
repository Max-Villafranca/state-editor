import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { memo } from 'react';

export type TransitionBundleEdgeData = Record<string, unknown> & {
  sourceLabel: string;
  targetLabel: string;
  laneOffset: number;
  reciprocal: boolean;
  analysisHighlighted: boolean;
  analysisContextHighlighted: boolean;
  transitions: Array<{ id: string; event: string; selected: boolean }>;
  onSelectTransition: (id: string) => void;
};

export type TransitionBundleEdge = Edge<
  TransitionBundleEdgeData,
  'transitionBundle'
>;

type RoutePoint = { x: number; y: number };

function samePoint(first: RoutePoint, second: RoutePoint) {
  return first.x === second.x && first.y === second.y;
}

function normalizeRoutePoints(points: RoutePoint[]) {
  const normalized: RoutePoint[] = [];

  for (const point of points) {
    const previous = normalized.at(-1);
    if (previous && samePoint(previous, point)) continue;

    const beforePrevious = normalized.at(-2);
    if (
      beforePrevious &&
      previous &&
      ((beforePrevious.x === previous.x && previous.x === point.x) ||
        (beforePrevious.y === previous.y && previous.y === point.y))
    ) {
      normalized[normalized.length - 1] = point;
      continue;
    }

    normalized.push(point);
  }

  return normalized;
}

function roundedOrthogonalPath(points: RoutePoint[], radius = 8) {
  const route = normalizeRoutePoints(points);
  if (route.length < 2) return '';

  const commands = [`M ${route[0].x},${route[0].y}`];
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const corner = route[index];
    const next = route[index + 1];
    const incomingDistance = Math.hypot(
      corner.x - previous.x,
      corner.y - previous.y,
    );
    const outgoingDistance = Math.hypot(next.x - corner.x, next.y - corner.y);
    const bend = Math.min(radius, incomingDistance / 2, outgoingDistance / 2);
    const before = {
      x: corner.x + ((previous.x - corner.x) / incomingDistance) * bend,
      y: corner.y + ((previous.y - corner.y) / incomingDistance) * bend,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoingDistance) * bend,
      y: corner.y + ((next.y - corner.y) / outgoingDistance) * bend,
    };
    commands.push(
      `L ${before.x},${before.y}`,
      `Q ${corner.x},${corner.y} ${after.x},${after.y}`,
    );
  }

  const last = route.at(-1)!;
  commands.push(`L ${last.x},${last.y}`);
  return commands.join(' ');
}

function orthogonalRoute({
  sourceX,
  sourceY,
  targetX,
  targetY,
  laneOffset,
  selfRoute,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  laneOffset: number;
  selfRoute: boolean;
}) {
  const handleClearance = 24;
  const sourceExit = { x: sourceX + handleClearance, y: sourceY };
  const targetEntry = { x: targetX - handleClearance, y: targetY };
  const corridorY = selfRoute
    ? Math.min(sourceY, targetY) - 96
    : (sourceY + targetY) / 2 + laneOffset;
  const path = roundedOrthogonalPath([
    { x: sourceX, y: sourceY },
    sourceExit,
    { x: sourceExit.x, y: corridorY },
    { x: targetEntry.x, y: corridorY },
    targetEntry,
    { x: targetX, y: targetY },
  ]);

  return [path, (sourceExit.x + targetEntry.x) / 2, corridorY] as const;
}

function TransitionEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps<TransitionBundleEdge>) {
  if (!data) return null;

  const selfRoute = data.sourceLabel === data.targetLabel;
  const [path, labelX, labelY] = orthogonalRoute({
    sourceX,
    sourceY,
    targetX,
    targetY,
    laneOffset: data.laneOffset,
    selfRoute,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={selected ? 28 : 22}
      />
      <EdgeLabelRenderer>
        <fieldset
          aria-label={`Transitions from ${data.sourceLabel} to ${data.targetLabel}`}
          data-transition-route={`${data.sourceLabel}->${data.targetLabel}`}
          data-analysis-highlighted={data.analysisHighlighted || undefined}
          data-analysis-context-highlighted={
            data.analysisContextHighlighted || undefined
          }
          className={`nodrag nopan absolute flex max-w-48 flex-col gap-1 rounded-md border-0 bg-[var(--editor-edge-label-bg)] p-1 shadow-sm ${
            data.analysisHighlighted
              ? 'ring-2 ring-rose-500/60 dark:ring-rose-400/70'
              : data.analysisContextHighlighted
                ? 'ring-1 ring-amber-500/50 dark:ring-amber-300/50'
                : ''
          }`}
          style={{
            pointerEvents: 'all',
            zIndex: data.analysisHighlighted
              ? 40
              : data.analysisContextHighlighted
                ? 30
                : 20,
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {data.transitions.map((transition) => (
            <button
              key={transition.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onSelectTransition(transition.id);
              }}
              aria-label={`Select transition ${transition.event}`}
              title={`${data.sourceLabel} → ${data.targetLabel}`}
              className={`truncate rounded-md px-2 py-1 text-left font-mono text-[11px] font-bold transition-colors ${
                transition.selected
                  ? 'bg-[var(--editor-edge-active)] text-white shadow-sm'
                  : 'text-[var(--editor-edge-label)] hover:bg-violet-100 hover:text-violet-800 dark:hover:bg-violet-500/20 dark:hover:text-violet-200'
              }`}
            >
              {transition.event}
            </button>
          ))}
        </fieldset>
      </EdgeLabelRenderer>
    </>
  );
}

export const TransitionEdge = memo(TransitionEdgeView);
