import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { memo } from 'react';

export type TransitionBundleEdgeData = Record<string, unknown> & {
  sourceLabel: string;
  targetLabel: string;
  sourceIsParent: boolean;
  targetIsParent: boolean;
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
export type NodeRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function getRectangleBoundaryPoint(
  rectangle: NodeRectangle,
  toward: RoutePoint,
) {
  const left = rectangle.x;
  const right = rectangle.x + rectangle.width;
  const top = rectangle.y;
  const bottom = rectangle.y + rectangle.height;
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.max(minimum, Math.min(maximum, value));
  const candidates: EdgeEndpoint[] = [
    { x: left, y: clamp(toward.y, top, bottom), position: Position.Left },
    { x: right, y: clamp(toward.y, top, bottom), position: Position.Right },
    { x: clamp(toward.x, left, right), y: top, position: Position.Top },
    { x: clamp(toward.x, left, right), y: bottom, position: Position.Bottom },
  ];

  return candidates.reduce((nearest, candidate) => {
    const nearestDistance = Math.hypot(
      nearest.x - toward.x,
      nearest.y - toward.y,
    );
    const candidateDistance = Math.hypot(
      candidate.x - toward.x,
      candidate.y - toward.y,
    );
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
}
type InternalNodeGeometry = {
  internals: { positionAbsolute: RoutePoint };
  measured: { width?: number; height?: number };
  width?: number;
  height?: number;
};

type EdgeEndpoint = RoutePoint & { position: Position };

export function resolveParentEndpoint({
  rectangle,
  toward,
  reciprocal,
  laneOffset,
}: {
  rectangle: NodeRectangle;
  toward: RoutePoint;
  reciprocal: boolean;
  laneOffset: number;
}): EdgeEndpoint {
  const endpoint = getRectangleBoundaryPoint(rectangle, toward);
  const usesVerticalEdge =
    endpoint.position === Position.Left || endpoint.position === Position.Right;
  if (!reciprocal || laneOffset === 0 || !usesVerticalEdge) return endpoint;

  const inset = 12;
  const separation = Math.max(-16, Math.min(16, laneOffset * 0.28));
  return {
    ...endpoint,
    y: Math.max(
      rectangle.y + inset,
      Math.min(rectangle.y + rectangle.height - inset, endpoint.y + separation),
    ),
  };
}

function internalNodeRectangle(node: InternalNodeGeometry): NodeRectangle {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? node.width ?? 0,
    height: node.measured.height ?? node.height ?? 0,
  };
}

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

function positionVector(position: Position) {
  if (position === Position.Top) return { x: 0, y: -1 };
  if (position === Position.Right) return { x: 1, y: 0 };
  if (position === Position.Bottom) return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function routeMidpoint(points: RoutePoint[]) {
  const route = normalizeRoutePoints(points);
  const segments = route.slice(1).map((point, index) => ({
    start: route[index],
    end: point,
    length: Math.hypot(point.x - route[index].x, point.y - route[index].y),
  }));
  const halfway =
    segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  let traveled = 0;
  for (const segment of segments) {
    if (traveled + segment.length >= halfway) {
      const ratio =
        segment.length === 0 ? 0 : (halfway - traveled) / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      };
    }
    traveled += segment.length;
  }
  return route.at(-1) ?? { x: 0, y: 0 };
}

export function getOrthogonalRoutePoints({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  laneOffset,
  selfRoute,
  sourceIsParent = false,
  targetIsParent = false,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  laneOffset: number;
  selfRoute: boolean;
  sourceIsParent?: boolean;
  targetIsParent?: boolean;
}) {
  const handleClearance = 24;
  const sourceDirection = positionVector(sourcePosition);
  const targetDirection = positionVector(targetPosition);
  const sourceExit = {
    x: sourceX + sourceDirection.x * handleClearance,
    y: sourceY + sourceDirection.y * handleClearance,
  };
  const targetEntry = {
    x: targetX + targetDirection.x * handleClearance,
    y: targetY + targetDirection.y * handleClearance,
  };
  let points: RoutePoint[];
  if (selfRoute) {
    const corridorY = Math.min(sourceY, targetY) - 96;
    points = [
      { x: sourceX, y: sourceY },
      sourceExit,
      { x: sourceExit.x, y: corridorY },
      { x: targetEntry.x, y: corridorY },
      targetEntry,
      { x: targetX, y: targetY },
    ];
  } else {
    const sourceHorizontal =
      sourcePosition === Position.Left || sourcePosition === Position.Right;
    const targetHorizontal =
      targetPosition === Position.Left || targetPosition === Position.Right;
    if (sourceHorizontal && targetHorizontal) {
      const exitsFaceAway =
        (sourceIsParent || targetIsParent) &&
        ((sourcePosition === Position.Right &&
          targetPosition === Position.Left &&
          sourceExit.x >= targetEntry.x) ||
          (sourcePosition === Position.Left &&
            targetPosition === Position.Right &&
            sourceExit.x <= targetEntry.x));
      const corridorY = exitsFaceAway
        ? Math.min(sourceExit.y, targetEntry.y) - 48 - Math.abs(laneOffset)
        : (sourceExit.y + targetEntry.y) / 2 + laneOffset;
      points = [
        { x: sourceX, y: sourceY },
        sourceExit,
        { x: sourceExit.x, y: corridorY },
        { x: targetEntry.x, y: corridorY },
        targetEntry,
        { x: targetX, y: targetY },
      ];
    } else if (!sourceHorizontal && !targetHorizontal) {
      const corridorX = (sourceExit.x + targetEntry.x) / 2 + laneOffset;
      points = [
        { x: sourceX, y: sourceY },
        sourceExit,
        { x: corridorX, y: sourceExit.y },
        { x: corridorX, y: targetEntry.y },
        targetEntry,
        { x: targetX, y: targetY },
      ];
    } else if (sourceHorizontal) {
      const targetColumnStaysOutsideSource =
        (sourcePosition === Position.Right && targetEntry.x >= sourceX) ||
        (sourcePosition === Position.Left && targetEntry.x <= sourceX);
      if (targetColumnStaysOutsideSource) {
        points = [
          { x: sourceX, y: sourceY },
          sourceExit,
          { x: targetEntry.x, y: sourceExit.y },
          targetEntry,
          { x: targetX, y: targetY },
        ];
      } else {
        const corridorY = targetEntry.y + laneOffset;
        points = [
          { x: sourceX, y: sourceY },
          sourceExit,
          { x: sourceExit.x, y: corridorY },
          { x: targetEntry.x, y: corridorY },
          targetEntry,
          { x: targetX, y: targetY },
        ];
      }
    } else {
      const targetRowStaysOutsideSource =
        (sourcePosition === Position.Bottom && targetEntry.y >= sourceY) ||
        (sourcePosition === Position.Top && targetEntry.y <= sourceY);
      if (targetRowStaysOutsideSource) {
        points = [
          { x: sourceX, y: sourceY },
          sourceExit,
          { x: sourceExit.x, y: targetEntry.y },
          targetEntry,
          { x: targetX, y: targetY },
        ];
      } else {
        const corridorX = targetEntry.x + laneOffset;
        points = [
          { x: sourceX, y: sourceY },
          sourceExit,
          { x: corridorX, y: sourceExit.y },
          { x: corridorX, y: targetEntry.y },
          targetEntry,
          { x: targetX, y: targetY },
        ];
      }
    }
  }
  return normalizeRoutePoints(points);
}

export function getOrthogonalRoute(
  options: Parameters<typeof getOrthogonalRoutePoints>[0],
) {
  const points = getOrthogonalRoutePoints(options);
  const path = roundedOrthogonalPath(points);
  const sourceHorizontal =
    options.sourcePosition === Position.Left ||
    options.sourcePosition === Position.Right;
  const targetHorizontal =
    options.targetPosition === Position.Left ||
    options.targetPosition === Position.Right;
  if (
    !options.sourceIsParent &&
    !options.targetIsParent &&
    sourceHorizontal &&
    targetHorizontal
  ) {
    const handleClearance = 24;
    const sourceExitX =
      options.sourceX +
      positionVector(options.sourcePosition).x * handleClearance;
    const targetEntryX =
      options.targetX +
      positionVector(options.targetPosition).x * handleClearance;
    const corridorY = options.selfRoute
      ? Math.min(options.sourceY, options.targetY) - 96
      : (options.sourceY + options.targetY) / 2 + options.laneOffset;
    return [path, (sourceExitX + targetEntryX) / 2, corridorY] as const;
  }

  const label = routeMidpoint(points);
  return [path, label.x, label.y] as const;
}

function TransitionEdgeView({
  id,
  source,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps<TransitionBundleEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!data) return null;

  const sourceRectangle = sourceNode ? internalNodeRectangle(sourceNode) : null;
  const targetRectangle = targetNode ? internalNodeRectangle(targetNode) : null;
  const hasEndpointGeometry = Boolean(sourceRectangle && targetRectangle);
  const floatingSource =
    data.sourceIsParent && hasEndpointGeometry && sourceRectangle
      ? resolveParentEndpoint({
          rectangle: sourceRectangle,
          toward: { x: targetX, y: targetY },
          reciprocal: data.reciprocal,
          laneOffset: data.laneOffset,
        })
      : null;
  const floatingTarget =
    data.targetIsParent && hasEndpointGeometry && targetRectangle
      ? resolveParentEndpoint({
          rectangle: targetRectangle,
          toward: { x: sourceX, y: sourceY },
          reciprocal: data.reciprocal,
          laneOffset: data.laneOffset,
        })
      : null;
  const resolvedSourceX = floatingSource?.x ?? sourceX;
  const resolvedSourceY = floatingSource?.y ?? sourceY;
  const resolvedTargetX = floatingTarget?.x ?? targetX;
  const resolvedTargetY = floatingTarget?.y ?? targetY;
  const resolvedSourcePosition = floatingSource?.position ?? sourcePosition;
  const resolvedTargetPosition = floatingTarget?.position ?? targetPosition;

  const selfRoute = data.sourceLabel === data.targetLabel;
  const [path, labelX, labelY] = getOrthogonalRoute({
    sourceX: resolvedSourceX,
    sourceY: resolvedSourceY,
    targetX: resolvedTargetX,
    targetY: resolvedTargetY,
    sourcePosition: resolvedSourcePosition,
    targetPosition: resolvedTargetPosition,
    laneOffset: data.laneOffset,
    selfRoute,
    sourceIsParent: data.sourceIsParent,
    targetIsParent: data.targetIsParent,
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
