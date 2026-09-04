import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  getOrthogonalRoute,
  getOrthogonalRoutePoints,
  getRectangleBoundaryPoint,
  resolveParentEndpoint,
} from './transition-edge';

describe('parent transition boundary routing', () => {
  const frame = { x: 100, y: 100, width: 200, height: 100 };

  it.each([
    [
      { x: 500, y: 150 },
      { x: 300, y: 150, position: Position.Right },
    ],
    [
      { x: -100, y: 150 },
      { x: 100, y: 150, position: Position.Left },
    ],
    [
      { x: 200, y: 0 },
      { x: 200, y: 100, position: Position.Top },
    ],
    [
      { x: 200, y: 300 },
      { x: 200, y: 200, position: Position.Bottom },
    ],
  ])('uses the nearest frame side toward %o', (toward, expected) => {
    expect(getRectangleBoundaryPoint(frame, toward)).toEqual(expected);
  });

  it('keeps reciprocal transitions separated on the floating parent boundary', () => {
    const toward = { x: 500, y: 150 };
    const output = resolveParentEndpoint({
      rectangle: frame,
      toward,
      reciprocal: true,
      laneOffset: -52,
    });
    const input = resolveParentEndpoint({
      rectangle: frame,
      toward,
      reciprocal: true,
      laneOffset: 52,
    });

    expect(output.position).toBe(Position.Right);
    expect(input.position).toBe(Position.Right);
    expect(output.x).toBe(300);
    expect(input.x).toBe(300);
    expect(Math.abs(output.y - input.y)).toBeGreaterThanOrEqual(24);
  });

  it('routes around endpoints when right-output and left-input handles face away', () => {
    const points = getOrthogonalRoutePoints({
      sourceX: 300,
      sourceY: 150,
      targetX: 250,
      targetY: 150,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      laneOffset: 0,
      selfRoute: false,
      sourceIsParent: true,
      targetIsParent: false,
    });

    expect(points.some((point) => point.y < 150)).toBe(true);
  });

  it('takes the short orthogonal route from a right output to a frame above', () => {
    const points = getOrthogonalRoutePoints({
      sourceX: 789,
      sourceY: 693,
      targetX: 617,
      targetY: 283,
      sourcePosition: Position.Right,
      targetPosition: Position.Bottom,
      laneOffset: 52,
      selfRoute: false,
    });

    const segments = points.slice(1).map((point, index) => ({
      from: points[index],
      to: point,
    }));
    expect(
      segments.every(({ from, to }) => from.x === to.x || from.y === to.y),
    ).toBe(true);
    expect(points[2].x).toBe(points[1].x);
    expect(points[2].y).toBeLessThan(points[1].y);
    expect(
      segments.reduce(
        (length, { from, to }) =>
          length + Math.hypot(to.x - from.x, to.y - from.y),
        0,
      ),
    ).toBeLessThan(650);
  });

  it('projects onto the nearest frame edge instead of aiming from its center', () => {
    expect(
      getRectangleBoundaryPoint(
        { x: 0, y: 0, width: 815, height: 62 },
        { x: 548, y: 432 },
      ),
    ).toEqual({ x: 548, y: 62, position: Position.Bottom });
  });

  it('runs straight into a frame above when the target column stays outside the source', () => {
    const points = getOrthogonalRoutePoints({
      sourceX: 513,
      sourceY: 432,
      targetX: 521,
      targetY: 62,
      sourcePosition: Position.Right,
      targetPosition: Position.Bottom,
      laneOffset: 52,
      selfRoute: false,
    });

    expect(points.slice(1).every((point) => point.x === 521)).toBe(true);
  });

  it('does not add reciprocal spacing when horizontal frame projection already separates handles', () => {
    expect(
      resolveParentEndpoint({
        rectangle: { x: 0, y: 0, width: 815, height: 62 },
        toward: { x: 548, y: 432 },
        reciprocal: true,
        laneOffset: 52,
      }),
    ).toEqual({ x: 548, y: 62, position: Position.Bottom });
  });

  it('keeps vertically separated leaf states in their normal midpoint corridor', () => {
    const points = getOrthogonalRoutePoints({
      sourceX: 297,
      sourceY: 121,
      targetX: 326,
      targetY: 620,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      laneOffset: 52,
      selfRoute: false,
      sourceIsParent: false,
      targetIsParent: false,
    });

    expect(Math.min(...points.map((point) => point.y))).toBeGreaterThanOrEqual(
      121,
    );
  });

  it('preserves legacy label placement for ordinary state routes', () => {
    const [, labelX, labelY] = getOrthogonalRoute({
      sourceX: 0,
      sourceY: 0,
      targetX: 200,
      targetY: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      laneOffset: 16,
      selfRoute: false,
      sourceIsParent: false,
      targetIsParent: false,
    });

    expect({ labelX, labelY }).toEqual({ labelX: 100, labelY: 66 });
  });
});
