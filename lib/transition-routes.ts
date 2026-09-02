import type { GraphTransition } from './machine-json';

export type TransitionRoute = {
  id: string;
  source: string;
  target: string;
  transitions: GraphTransition[];
  laneOffset: number;
  reciprocal: boolean;
};

const routeKey = (source: string, target: string) => `${source}\u0000${target}`;

function routeId(source: string, target: string) {
  return `transition-route:${encodeURIComponent(source)}:${encodeURIComponent(target)}`;
}

export function createTransitionRoutes(
  transitions: GraphTransition[],
): TransitionRoute[] {
  const grouped = new Map<string, TransitionRoute>();

  for (const transition of transitions) {
    const key = routeKey(transition.source, transition.target);
    const existing = grouped.get(key);
    if (existing) {
      existing.transitions.push(transition);
      continue;
    }
    grouped.set(key, {
      id: routeId(transition.source, transition.target),
      source: transition.source,
      target: transition.target,
      transitions: [transition],
      laneOffset: 0,
      reciprocal: false,
    });
  }

  const routes = [...grouped.values()];
  const outgoingBySource = new Map<string, TransitionRoute[]>();
  for (const route of routes) {
    const outgoing = outgoingBySource.get(route.source) ?? [];
    outgoing.push(route);
    outgoingBySource.set(route.source, outgoing);
  }

  for (const outgoing of outgoingBySource.values()) {
    const ordered = [...outgoing].sort((a, b) =>
      a.target.localeCompare(b.target),
    );
    ordered.forEach((route, index) => {
      const fanOffset = (index - (ordered.length - 1) / 2) * 16;
      const reverse = grouped.has(routeKey(route.target, route.source));
      route.reciprocal = route.source !== route.target && reverse;
      route.laneOffset = route.reciprocal
        ? (route.source.localeCompare(route.target) < 0 ? -52 : 52) +
          fanOffset * 0.35
        : fanOffset;
    });
  }

  return routes;
}
