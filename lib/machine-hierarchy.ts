import type { GraphMachine, GraphState, GraphTransition } from './machine-json';

/** Returns the direct children of a state (or the machine root when omitted). */
export function getStateChildren(
  graph: GraphMachine,
  parentKey?: string,
): GraphState[] {
  return graph.states.filter((state) => state.parentKey === parentKey);
}

export function getState(
  graph: GraphMachine,
  key: string,
): GraphState | undefined {
  return graph.states.find((state) => state.key === key);
}

/** Returns ancestors from nearest parent to the machine root. */
export function getStateAncestors(
  graph: GraphMachine,
  key: string,
): GraphState[] {
  const ancestors: GraphState[] = [];
  let current = getState(graph, key);
  while (current?.parentKey) {
    const parent = getState(graph, current.parentKey);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/** Enters a state and follows its declared initial child until an atomic state is reached. */
export function getInitialLeafState(graph: GraphMachine, key: string): string {
  let currentKey = key;
  const seen = new Set<string>();
  while (!seen.has(currentKey)) {
    seen.add(currentKey);
    const current = getState(graph, currentKey);
    if (!current?.initialChild) return currentKey;
    currentKey = current.initialChild;
  }
  return currentKey;
}

/** Resolves the transitions visible to an active state using XState's descendant-first fallback. */
export function getEffectiveTransitions(
  graph: GraphMachine,
  key: string,
): GraphTransition[] {
  const declarations = [
    getState(graph, key),
    ...getStateAncestors(graph, key),
  ].filter((state): state is GraphState => Boolean(state));
  const seenEvents = new Set<string>();
  const effective: GraphTransition[] = [];
  for (const declaration of declarations) {
    for (const transition of graph.transitions) {
      if (
        transition.source !== declaration.key ||
        seenEvents.has(transition.event)
      )
        continue;
      seenEvents.add(transition.event);
      effective.push(transition);
    }
  }
  return effective;
}

/** Computes the states reachable from the machine's initial configuration, including parent entry. */
export function getReachableStateKeys(graph: GraphMachine): Set<string> {
  const reachable = new Set<string>();
  if (!graph.initial) return reachable;
  const queue = [getInitialLeafState(graph, graph.initial)];
  while (queue.length) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const ancestor of getStateAncestors(graph, current))
      reachable.add(ancestor.key);
    for (const transition of getEffectiveTransitions(graph, current)) {
      const target = getInitialLeafState(graph, transition.target);
      if (!reachable.has(target)) queue.push(target);
    }
  }
  return reachable;
}

export function isParentState(graph: GraphMachine, key: string): boolean {
  return getStateChildren(graph, key).length > 0;
}

export type StateGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
};

/** Parent-first order and absolute geometry, with frame sizes computed from the inside out. */
export function getHierarchyLayout(
  graph: GraphMachine,
  measured: ReadonlyMap<
    string,
    { width?: number; height?: number }
  > = new Map(),
): Map<string, StateGeometry> {
  const layout = new Map<string, StateGeometry>();
  const visit = (state: GraphState, x: number, y: number, depth: number) => {
    const children = getStateChildren(graph, state.key);
    const size = measured.get(state.key);
    const geometry = {
      x: x + state.position.x,
      y: y + state.position.y,
      width: Math.max(208, size?.width ?? 0),
      height: Math.max(108, size?.height ?? 0),
      depth,
    };
    layout.set(state.key, geometry);
    for (const child of children)
      visit(child, geometry.x, geometry.y, depth + 1);
    if (children.length) {
      geometry.width = Math.max(
        560,
        ...children.map(
          (child) => child.position.x + layout.get(child.key)!.width + 32,
        ),
      );
      geometry.height = Math.max(
        340,
        ...children.map(
          (child) => child.position.y + layout.get(child.key)!.height + 32,
        ),
      );
    }
  };
  for (const state of getStateChildren(graph)) visit(state, 0, 0, 0);
  return layout;
}

/** Keep only selected states with no selected ancestor. Descendants remain attached. */
export function getSelectionRoots(
  graph: GraphMachine,
  keys: readonly string[],
): string[] {
  const selected = new Set(keys);
  return keys.filter(
    (key) =>
      getState(graph, key) &&
      !getStateAncestors(graph, key).some((ancestor) =>
        selected.has(ancestor.key),
      ),
  );
}

export function getGroupingIssue(
  graph: GraphMachine,
  keys: readonly string[],
): string | undefined {
  const states = keys.map((key) => getState(graph, key));
  if (states.length < 2 || states.some((state) => !state))
    return 'Select at least two states.';
  if (states.some((state) => state!.parentKey !== states[0]!.parentKey)) {
    return 'Select states that share the same parent.';
  }
  return undefined;
}

function repairInitialStates(graph: GraphMachine): GraphMachine {
  const states = graph.states.map((state) => {
    const children = getStateChildren(graph, state.key);
    if (!children.length) {
      return state.initialChild === undefined
        ? state
        : { ...state, initialChild: undefined };
    }
    return children.some((child) => child.key === state.initialChild)
      ? state
      : { ...state, initialChild: children[0].key };
  });
  const roots = states.filter((state) => state.parentKey === undefined);
  return {
    ...graph,
    states,
    initial: roots.some((state) => state.key === graph.initial)
      ? graph.initial
      : (roots[0]?.key ?? ''),
  };
}

/** Wrap siblings at any depth, preserving descendants, transitions and scoped initial entry. */
export function groupStates(
  graph: GraphMachine,
  keys: readonly string[],
  name: string,
  initialChild: string,
): GraphMachine {
  const issue = getGroupingIssue(graph, keys);
  if (issue) throw new Error(issue);
  if (!name.trim() || getState(graph, name))
    throw new Error('Choose a unique parent state name.');
  if (!keys.includes(initialChild))
    throw new Error('Choose one of the selected states as the initial child.');
  const selected = new Set(keys);
  const states = graph.states.filter((state) => selected.has(state.key));
  const parentKey = states[0].parentKey;
  const minX = Math.min(...states.map((state) => state.position.x));
  const minY = Math.min(...states.map((state) => state.position.y));
  const position = {
    x: parentKey === undefined ? minX - 32 : Math.max(32, minX - 32),
    y: parentKey === undefined ? minY - 64 : Math.max(64, minY - 64),
  };
  const parent: GraphState = {
    key: name,
    parentKey,
    initialChild,
    position,
    final: false,
    description: '',
    tags: [],
    entryActions: [],
    exitActions: [],
  };
  const nextStates = graph.states.map((state) => {
    if (selected.has(state.key))
      return {
        ...state,
        parentKey: name,
        position: {
          x: state.position.x - minX + 32,
          y: state.position.y - minY + 64,
        },
      };
    return state.key === parentKey && selected.has(state.initialChild ?? '')
      ? { ...state, initialChild: name }
      : state;
  });
  nextStates.splice(
    graph.states.findIndex((state) => selected.has(state.key)),
    0,
    parent,
  );
  return {
    ...graph,
    states: nextStates,
    initial:
      parentKey === undefined && selected.has(graph.initial)
        ? name
        : graph.initial,
  };
}

/** Remove selected frames only, promoting their direct children one level without losing transitions. */
export function removeHierarchyStates(
  graph: GraphMachine,
  keys: readonly string[],
): GraphMachine {
  const removed = new Set(getSelectionRoots(graph, keys));
  const states = graph.states
    .filter((state) => !removed.has(state.key))
    .map((state) => {
      const parent = state.parentKey
        ? getState(graph, state.parentKey)
        : undefined;
      const promoted =
        parent && removed.has(parent.key)
          ? {
              ...state,
              parentKey: parent.parentKey,
              position: {
                x: state.position.x + parent.position.x,
                y: state.position.y + parent.position.y,
              },
            }
          : state;
      return promoted.initialChild && removed.has(promoted.initialChild)
        ? {
            ...promoted,
            initialChild: getState(graph, promoted.initialChild)?.initialChild,
          }
        : promoted;
    });
  return repairInitialStates({
    ...graph,
    states,
    initial: removed.has(graph.initial)
      ? (getState(graph, graph.initial)?.initialChild ?? '')
      : graph.initial,
    transitions: graph.transitions.filter(
      (transition) =>
        !removed.has(transition.source) && !removed.has(transition.target),
    ),
  });
}

/** Move a state and its subtree using absolute coordinates; an undefined parent means the machine root. */
export function reparentState(
  graph: GraphMachine,
  key: string,
  parentKey?: string,
): GraphMachine {
  const state = getState(graph, key);
  if (!state || state.parentKey === parentKey) return graph;
  const parent =
    parentKey === undefined ? undefined : getState(graph, parentKey);
  if (parentKey !== undefined && (!parent || parent.final)) return graph;
  if (
    parent &&
    (parent.key === key ||
      getStateAncestors(graph, parent.key).some(
        (ancestor) => ancestor.key === key,
      ))
  ) {
    return graph;
  }
  const absolute = (target: GraphState) =>
    getStateAncestors(graph, target.key).reduce(
      (point, ancestor) => ({
        x: point.x + ancestor.position.x,
        y: point.y + ancestor.position.y,
      }),
      { ...target.position },
    );
  const point = absolute(state);
  const origin = parent ? absolute(parent) : { x: 0, y: 0 };
  const branch = parent
    ? [parent, ...getStateAncestors(graph, parent.key)].find(
        (candidate) => candidate.parentKey === state.parentKey,
      )
    : undefined;
  return repairInitialStates({
    ...graph,
    initial: graph.initial === key ? (branch?.key ?? '') : graph.initial,
    states: graph.states.map((candidate) => {
      if (candidate.key === key)
        return {
          ...candidate,
          parentKey,
          position: {
            x: parent ? Math.max(32, point.x - origin.x) : point.x,
            y: parent ? Math.max(64, point.y - origin.y) : point.y,
          },
        };
      return candidate.key === state.parentKey && candidate.initialChild === key
        ? { ...candidate, initialChild: branch?.key }
        : candidate;
    }),
  });
}

/** Choose the deepest containing frame, never the dragged state or one of its descendants. */
export function findContainingParent(
  graph: GraphMachine,
  layout: ReadonlyMap<string, StateGeometry>,
  bounds: { x: number; y: number; width: number; height: number },
  excludedKey?: string,
): string | undefined {
  let best: string | undefined;
  let bestDepth = -1;
  for (const [key, box] of layout) {
    if (!getStateChildren(graph, key).length || key === excludedKey) continue;
    if (
      excludedKey &&
      getStateAncestors(graph, key).some((state) => state.key === excludedKey)
    )
      continue;
    if (
      box.depth > bestDepth &&
      bounds.x >= box.x &&
      bounds.y >= box.y + 48 &&
      bounds.x + bounds.width <= box.x + box.width &&
      bounds.y + bounds.height <= box.y + box.height
    ) {
      best = key;
      bestDepth = box.depth;
    }
  }
  return best;
}
