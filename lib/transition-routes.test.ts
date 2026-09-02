import { describe, expect, it } from 'vitest';

import type { GraphTransition } from './machine-json';
import { createTransitionRoutes } from './transition-routes';

function transition(
  id: string,
  source: string,
  target: string,
  event: string,
): GraphTransition {
  return { id, source, target, event, actions: [] };
}

describe('transition routes', () => {
  it('bundles transitions that share one directed route', () => {
    const routes = createTransitionRoutes([
      transition('one', 'waiting', 'connected', 'ANSWERED'),
      transition('two', 'waiting', 'connected', 'VOICEMAIL'),
    ]);

    expect(routes).toHaveLength(1);
    expect(routes[0].transitions.map(({ id }) => id)).toEqual(['one', 'two']);
  });

  it('keeps reciprocal routes separate and assigns opposite lanes', () => {
    const routes = createTransitionRoutes([
      transition('forward', 'a', 'b', 'NEXT'),
      transition('back', 'b', 'a', 'BACK'),
    ]);

    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.reciprocal)).toBe(true);
    expect(Math.sign(routes[0].laneOffset)).toBe(
      -Math.sign(routes[1].laneOffset),
    );
  });

  it('fans different destinations into stable lanes', () => {
    const routes = createTransitionRoutes([
      transition('two', 'source', 'two', 'TWO'),
      transition('one', 'source', 'one', 'ONE'),
      transition('three', 'source', 'three', 'THREE'),
    ]);

    expect(
      [...routes]
        .sort((a, b) => a.target.localeCompare(b.target))
        .map(({ laneOffset }) => laneOffset),
    ).toEqual([-16, 0, 16]);
  });
});
