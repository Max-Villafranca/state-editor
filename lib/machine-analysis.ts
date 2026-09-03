import type { GraphMachine } from './machine-json';
import {
  getEffectiveTransitions,
  getInitialLeafState,
  getStateChildren,
} from './machine-hierarchy';

const MAX_CYCLES = 250;

export type MachineCycle = {
  states: string[];
  cycleLength: number;
  entryDistance: number;
  entryPath: string[];
  exitDistance: number | null;
  exitPath: string[] | null;
  endState: string | null;
};

export type MachinePath = {
  states: string[];
  endsInFinalState: boolean;
};

export type StateConnections = {
  state: string;
  incomingTransitions: number;
  incomingStates: number;
  outgoingTransitions: number;
  outgoingStates: number;
};

export type MachineAnalysis = {
  cycles: MachineCycle[];
  cyclesTruncated: boolean;
  paths: MachinePath[];
  stateConnections: StateConnections[];
};

function adjacencyFor(graph: GraphMachine) {
  const atomicStates = graph.states.filter(
    ({ key }) => getStateChildren(graph, key).length === 0,
  );
  const stateKeys = new Set(atomicStates.map(({ key }) => key));
  const adjacency = new Map(
    atomicStates.map(({ key }) => [key, new Set<string>()]),
  );

  for (const state of atomicStates) {
    for (const transition of getEffectiveTransitions(graph, state.key)) {
      const target = getInitialLeafState(graph, transition.target);
      if (stateKeys.has(target)) {
        adjacency.get(state.key)?.add(target);
      }
    }
  }

  return adjacency;
}

function reachableStates(initial: string, adjacency: Map<string, Set<string>>) {
  const reachable = new Set<string>();
  const pending = adjacency.has(initial) ? [initial] : [];

  while (pending.length) {
    const state = pending.pop()!;
    if (reachable.has(state)) continue;
    reachable.add(state);
    for (const target of adjacency.get(state) ?? []) pending.push(target);
  }

  return reachable;
}

function reconstructPath(
  destination: string,
  previous: Map<string, string | null>,
) {
  const path: string[] = [];
  let current: string | null = destination;
  while (current !== null) {
    path.unshift(current);
    current = previous.get(current) ?? null;
  }
  return path;
}

function shortestPathToAny(
  initial: string,
  destinations: Set<string>,
  adjacency: Map<string, Set<string>>,
) {
  if (!adjacency.has(initial)) return [];
  if (destinations.has(initial)) return [initial];

  const queue = [initial];
  const previous = new Map<string, string | null>([[initial, null]]);

  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index];
    for (const target of adjacency.get(state) ?? []) {
      if (previous.has(target)) continue;
      previous.set(target, state);
      if (destinations.has(target)) return reconstructPath(target, previous);
      queue.push(target);
    }
  }

  return [];
}

function shortestExitPath(
  cycle: string[],
  endStates: Set<string>,
  adjacency: Map<string, Set<string>>,
) {
  const cycleStates = new Set(cycle);
  const queue: string[] = [];
  const previous = new Map<string, string>();

  for (const source of cycle) {
    for (const target of adjacency.get(source) ?? []) {
      if (cycleStates.has(target) || previous.has(target)) continue;
      previous.set(target, source);
      if (endStates.has(target)) {
        return reconstructExitPath(target, previous, cycleStates);
      }
      queue.push(target);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index];
    for (const target of adjacency.get(state) ?? []) {
      if (cycleStates.has(target) || previous.has(target)) continue;
      previous.set(target, state);
      if (endStates.has(target)) {
        return reconstructExitPath(target, previous, cycleStates);
      }
      queue.push(target);
    }
  }

  return null;
}

function reconstructExitPath(
  destination: string,
  previous: Map<string, string>,
  cycleStates: Set<string>,
) {
  const path = [destination];
  while (!cycleStates.has(path[0])) {
    path.unshift(previous.get(path[0])!);
  }
  return path;
}

function enumerateSimpleCycles(
  reachable: Set<string>,
  adjacency: Map<string, Set<string>>,
  stateOrder: Map<string, number>,
) {
  const cycles: string[][] = [];
  let truncated = false;
  const orderedStates = [...reachable].sort(
    (first, second) => stateOrder.get(first)! - stateOrder.get(second)!,
  );

  for (const start of orderedStates) {
    const minimumOrder = stateOrder.get(start)!;
    const path = [start];
    const visited = new Set([start]);

    const visit = (state: string) => {
      for (const target of adjacency.get(state) ?? []) {
        if (!reachable.has(target)) continue;
        if (target === start) {
          if (cycles.length >= MAX_CYCLES) {
            truncated = true;
            continue;
          }
          cycles.push([...path]);
          continue;
        }
        if (
          truncated ||
          visited.has(target) ||
          stateOrder.get(target)! < minimumOrder
        ) {
          continue;
        }
        visited.add(target);
        path.push(target);
        visit(target);
        path.pop();
        visited.delete(target);
      }
    };

    visit(start);
    if (truncated) break;
  }

  return { cycles, truncated };
}

function analyzeCycles(
  graph: GraphMachine,
  reachable: Set<string>,
  adjacency: Map<string, Set<string>>,
  stateOrder: Map<string, number>,
) {
  const finalStates = new Set(
    graph.states
      .filter(
        ({ key, final }) => final || (adjacency.get(key)?.size ?? 0) === 0,
      )
      .map(({ key }) => key),
  );
  const enumerated = enumerateSimpleCycles(reachable, adjacency, stateOrder);
  const cycles = enumerated.cycles.map((states): MachineCycle => {
    const entryPath = shortestPathToAny(
      getInitialLeafState(graph, graph.initial),
      new Set(states),
      adjacency,
    );
    const exitPath = shortestExitPath(states, finalStates, adjacency);
    return {
      states,
      cycleLength: states.length,
      entryDistance: Math.max(0, entryPath.length - 1),
      entryPath,
      exitDistance: exitPath ? exitPath.length - 1 : null,
      exitPath,
      endState: exitPath?.at(-1) ?? null,
    };
  });

  cycles.sort(
    (first, second) =>
      first.entryDistance - second.entryDistance ||
      second.cycleLength - first.cycleLength ||
      first.states.join('\u0000').localeCompare(second.states.join('\u0000')),
  );
  return { cycles, cyclesTruncated: enumerated.truncated };
}

function findFinitePaths(
  graph: GraphMachine,
  adjacency: Map<string, Set<string>>,
) {
  const initial = getInitialLeafState(graph, graph.initial);
  if (!adjacency.has(initial)) return [];

  const finalStates = new Set(
    graph.states.filter(({ final }) => final).map(({ key }) => key),
  );
  const paths: MachinePath[] = [];

  const visit = (state: string, path: string[], visited: Set<string>) => {
    if (finalStates.has(state)) {
      paths.push({ states: path, endsInFinalState: true });
      return;
    }

    const targets = [...(adjacency.get(state) ?? [])];
    if (targets.length === 0) {
      paths.push({ states: path, endsInFinalState: false });
      return;
    }

    for (const target of targets) {
      if (visited.has(target)) continue;
      const nextVisited = new Set(visited).add(target);
      visit(target, [...path, target], nextVisited);
    }
  };

  visit(initial, [initial], new Set([initial]));
  return paths.sort(
    (first, second) =>
      second.states.length - first.states.length ||
      first.states.join('\u0000').localeCompare(second.states.join('\u0000')),
  );
}

function stateConnectionsFor(graph: GraphMachine) {
  return graph.states.map(({ key }) => {
    const atomic = getStateChildren(graph, key).length === 0;
    const incoming = graph.transitions.filter(
      ({ target }) => getInitialLeafState(graph, target) === key,
    );
    const outgoing = atomic
      ? getEffectiveTransitions(graph, key)
      : graph.transitions.filter(({ source }) => source === key);
    return {
      state: key,
      incomingTransitions: incoming.length,
      incomingStates: new Set(incoming.map(({ source }) => source)).size,
      outgoingTransitions: outgoing.length,
      outgoingStates: new Set(outgoing.map(({ target }) => target)).size,
    };
  });
}

export function analyzeMachine(graph: GraphMachine): MachineAnalysis {
  const adjacency = adjacencyFor(graph);
  const reachable = reachableStates(getInitialLeafState(graph, graph.initial), adjacency);
  const stateOrder = new Map(
    graph.states.map(({ key }, index) => [key, index]),
  );
  const cycleAnalysis = analyzeCycles(graph, reachable, adjacency, stateOrder);

  return {
    ...cycleAnalysis,
    paths: findFinitePaths(graph, adjacency),
    stateConnections: stateConnectionsFor(graph),
  };
}
