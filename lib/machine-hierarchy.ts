import type { GraphMachine, GraphState, GraphTransition } from './machine-json';

/** Returns the direct children of a state (or the machine root when omitted). */
export function getStateChildren(graph: GraphMachine, parentKey?: string): GraphState[] {
  return graph.states.filter((state) => state.parentKey === parentKey);
}

export function getState(graph: GraphMachine, key: string): GraphState | undefined {
  return graph.states.find((state) => state.key === key);
}

/** Returns ancestors from nearest parent to the machine root. */
export function getStateAncestors(graph: GraphMachine, key: string): GraphState[] {
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
export function getEffectiveTransitions(graph: GraphMachine, key: string): GraphTransition[] {
  const declarations = [getState(graph, key), ...getStateAncestors(graph, key)].filter(
    (state): state is GraphState => Boolean(state),
  );
  const seenEvents = new Set<string>();
  const effective: GraphTransition[] = [];
  for (const declaration of declarations) {
    for (const transition of graph.transitions) {
      if (transition.source !== declaration.key || seenEvents.has(transition.event)) continue;
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
    for (const ancestor of getStateAncestors(graph, current)) reachable.add(ancestor.key);
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
