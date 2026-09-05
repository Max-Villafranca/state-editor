import type { MachineJSON as XStateMachineJSON } from 'xstate';
import { describe, expect, it } from 'vitest';
import {
  graphToMachineJSON,
  machineJSONToGraph,
  validateGraph,
} from './machine-json';
import {
  getState,
  getHierarchyLayout,
  getGroupingIssue,
  groupStates,
  removeHierarchyStates,
  reparentState,
  findContainingParent,
  getEffectiveTransitions,
  getInitialLeafState,
  getReachableStateKeys,
} from './machine-hierarchy';

describe('machine hierarchy behavior', () => {
  const graph = machineJSONToGraph({
    initial: 'contacting',
    states: {
      contacting: {
        initial: 'calling',
        states: {
          calling: {},
          voicemail: {},
        },
        on: { INTERESTED: { target: '#interested' } },
      },
      interested: { id: 'interested' },
    },
  });

  it('follows a parent initial child when entering the parent', () => {
    expect(getInitialLeafState(graph, 'contacting')).toBe('calling');
  });

  it('inherits parent transitions for the active child', () => {
    expect(getEffectiveTransitions(graph, 'calling')).toEqual([
      expect.objectContaining({
        source: 'contacting',
        event: 'INTERESTED',
        target: 'interested',
      }),
    ]);
  });

  it('marks parent and active descendants reachable', () => {
    expect(getReachableStateKeys(graph)).toEqual(
      new Set(['calling', 'contacting', 'interested']),
    );
  });

  it('allows transitions back to a scoped initial child', () => {
    const graphWithReturn = machineJSONToGraph({
      initial: 'workflow',
      states: {
        workflow: {
          initial: 'ready',
          states: {
            ready: {},
            paused: { on: { RESUME: { target: 'ready' } } },
          },
        },
      },
    });

    expect(graphWithReturn.transitions).toContainEqual(
      expect.objectContaining({
        source: 'paused',
        target: 'ready',
        event: 'RESUME',
      }),
    );
  });
});

describe('recursive hierarchy editing', () => {
  const fixture = () => {
    const graph = machineJSONToGraph({
      id: 'hierarchy',
      initial: 'outer',
      states: {
        outer: {
          initial: 'b',
          states: {
            a: { on: { NEXT: { target: 'b' } }, entry: [{ type: 'prepare' }] },
            b: { on: { BACK: { target: 'a' } } },
            spare: {},
          },
          on: { FINISH: { target: '#done' } },
        },
        done: { id: 'done', type: 'final' },
      },
    });
    const positions: Record<string, { x: number; y: number }> = {
      outer: { x: 100, y: 100 },
      a: { x: 64, y: 160 },
      b: { x: 330, y: 160 },
      spare: { x: 680, y: 160 },
      done: { x: 1200, y: 100 },
    };
    return {
      ...graph,
      states: graph.states.map((state) => ({
        ...state,
        position: positions[state.key],
      })),
    };
  };
  const nested = () => groupStates(fixture(), ['a', 'b'], 'inner', 'b');

  it('groups siblings inside a parent without changing entry, data, transitions or absolute positions', () => {
    const original = fixture();
    const before = getHierarchyLayout(original);
    const graph = groupStates(original, ['a', 'b'], 'inner', 'b');
    const after = getHierarchyLayout(graph);
    expect(validateGraph(graph)).toEqual([]);
    expect(graph.initial).toBe('outer');
    expect(getState(graph, 'outer')!.initialChild).toBe('inner');
    expect(getInitialLeafState(graph, graph.initial)).toBe('b');
    expect(graph.transitions).toEqual(original.transitions);
    expect(getState(graph, 'a')!.entryActions).toEqual(
      getState(original, 'a')!.entryActions,
    );
    for (const key of ['a', 'b']) {
      expect(after.get(key)).toMatchObject({
        x: before.get(key)!.x,
        y: before.get(key)!.y,
      });
    }
  });

  it('can wrap existing parents repeatedly and fits every frame around the full subtree', () => {
    let graph = groupStates(nested(), ['inner', 'spare'], 'middle', 'inner');
    for (let depth = 0; depth < 4; depth += 1) {
      const leaf = {
        ...getState(graph, 'spare')!,
        key: 'extra' + depth,
        parentKey: 'outer',
        position: { x: 1100, y: 100 },
      };
      graph = { ...graph, states: [...graph.states, leaf] };
      const current = getState(graph, 'outer')!.initialChild!;
      graph = groupStates(graph, [current, leaf.key], 'level' + depth, current);
    }
    expect(validateGraph(graph)).toEqual([]);
    expect(getInitialLeafState(graph, graph.initial)).toBe('b');
    const layout = getHierarchyLayout({
      ...graph,
      states: [...graph.states].reverse(),
    });
    expect(layout.get('b')!.depth).toBe(7);
    const ordered = [...layout.keys()];
    for (const state of graph.states.filter(
      (candidate) => candidate.parentKey,
    )) {
      const box = layout.get(state.key)!;
      const parent = layout.get(state.parentKey!)!;
      expect(ordered.indexOf(state.parentKey!)).toBeLessThan(
        ordered.indexOf(state.key),
      );
      expect(box.x).toBeGreaterThanOrEqual(parent.x);
      expect(box.y).toBeGreaterThanOrEqual(parent.y);
      expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(box.y + box.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it('rejects mixed scopes and ancestor/descendant grouping', () => {
    const graph = nested();
    expect(getGroupingIssue(graph, ['a', 'spare'])).toBe(
      'Select states that share the same parent.',
    );
    expect(() => groupStates(graph, ['inner', 'a'], 'invalid', 'a')).toThrow();
  });

  it('deletes a nested frame in one operation and promotes its children to its own parent', () => {
    const graph = nested();
    const before = getHierarchyLayout(graph);
    const result = removeHierarchyStates(graph, ['inner', 'a', 'b']);
    expect(validateGraph(result)).toEqual([]);
    expect(getState(result, 'inner')).toBeUndefined();
    expect(getState(result, 'a')!.parentKey).toBe('outer');
    expect(getState(result, 'outer')!.initialChild).toBe('b');
    expect(result.transitions).toEqual(graph.transitions);
    const after = getHierarchyLayout(result);
    expect(after.get('a')).toMatchObject({
      x: before.get('a')!.x,
      y: before.get('a')!.y,
    });
    expect(after.get('b')).toMatchObject({
      x: before.get('b')!.x,
      y: before.get('b')!.y,
    });
  });

  it('deletes an outer frame while keeping nested descendants and their initial configuration', () => {
    const graph = nested();
    const result = removeHierarchyStates(graph, ['outer']);
    expect(validateGraph(result)).toEqual([]);
    expect(result.initial).toBe('inner');
    expect(getState(result, 'inner')!.parentKey).toBeUndefined();
    expect(getState(result, 'a')!.parentKey).toBe('inner');
    expect(getInitialLeafState(result, result.initial)).toBe('b');
    expect(result.transitions).toEqual(
      graph.transitions.filter((transition) => transition.source !== 'outer'),
    );
  });

  it('reparents and lifts subtrees using absolute positions and repairs each affected initial', () => {
    const graph = nested();
    const moved = reparentState(graph, 'spare', 'inner');
    expect(validateGraph(moved)).toEqual([]);
    expect(getState(moved, 'spare')!.parentKey).toBe('inner');
    const lifted = reparentState(moved, 'b', 'outer');
    expect(validateGraph(lifted)).toEqual([]);
    expect(getState(lifted, 'inner')!.initialChild).toBe('a');
    expect(getHierarchyLayout(lifted).get('b')).toMatchObject({
      x: getHierarchyLayout(graph).get('b')!.x,
      y: getHierarchyLayout(graph).get('b')!.y,
    });
    expect(reparentState(graph, 'outer', 'inner')).toBe(graph);
    expect(reparentState(graph, 'inner', 'a')).toBe(graph);
    const remaining = removeHierarchyStates(lifted, ['a', 'spare']);
    expect(getState(remaining, 'inner')!.initialChild).toBeUndefined();
    expect(validateGraph(remaining)).toEqual([]);
  });

  it('preserves machine initial when a root state enters a parent', () => {
    const base = fixture();
    const graph = {
      ...base,
      initial: 'done',
      states: base.states.map((state) =>
        state.key === 'done' ? { ...state, final: false } : state,
      ),
    };
    const result = reparentState(graph, 'done', 'outer');
    expect(validateGraph(result)).toEqual([]);
    expect(result.initial).toBe('outer');
  });

  it('chooses the deepest containing parent and excludes the dragged subtree', () => {
    const graph = nested();
    const layout = getHierarchyLayout(graph);
    const inner = layout.get('inner')!;
    const bounds = { x: inner.x + 40, y: inner.y + 80, width: 100, height: 40 };
    expect(findContainingParent(graph, layout, bounds, 'spare')).toBe('inner');
    expect(
      findContainingParent(graph, layout, bounds, 'outer'),
    ).toBeUndefined();
  });

  it('round-trips deep hierarchy and preserves inherited transitions in XState v6', async () => {
    const { createActor, createMachineFromConfig } = await import('xstate');
    const graph = groupStates(nested(), ['inner', 'spare'], 'middle', 'inner');
    const exported = graphToMachineJSON(graph);
    const imported = machineJSONToGraph(JSON.parse(JSON.stringify(exported)));
    expect(validateGraph(imported)).toEqual([]);
    expect(getInitialLeafState(imported, imported.initial)).toBe('b');
    const actor = createActor(
      createMachineFromConfig(exported as XStateMachineJSON, {
        actions: { prepare: () => undefined },
      }),
    );
    actor.start();
    expect(actor.getSnapshot().value).toEqual({
      outer: { middle: { inner: 'b' } },
    });
    actor.send({ type: 'BACK' });
    expect(actor.getSnapshot().value).toEqual({
      outer: { middle: { inner: 'a' } },
    });
    actor.send({ type: 'FINISH' });
    expect(actor.getSnapshot().value).toBe('done');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });
});
