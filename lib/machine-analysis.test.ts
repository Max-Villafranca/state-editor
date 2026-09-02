import { describe, expect, it } from 'vitest';

import type { GraphMachine, GraphTransition } from './machine-json';
import { analyzeMachine } from './machine-analysis';

function transition(
  id: string,
  source: string,
  target: string,
): GraphTransition {
  return { id, source, target, event: id, actions: [] };
}

function graph(transitions: GraphTransition[]): GraphMachine {
  return {
    id: 'analysis',
    hasExplicitId: true,
    initial: 'start',
    description: '',
    tags: [],
    states: ['start', 'loopA', 'loopB', 'done', 'unreachable'].map((key) => ({
      key,
      position: { x: 0, y: 0 },
      final: key === 'done',
      description: '',
      tags: [],
      entryActions: [],
      exitActions: [],
    })),
    transitions,
  };
}

describe('machine analysis', () => {
  it('separates reachable cycles from longest-first finite paths', () => {
    const analysis = analyzeMachine(
      graph([
        transition('ENTER_LOOP', 'start', 'loopA'),
        transition('DIRECT', 'start', 'done'),
        transition('NEXT', 'loopA', 'loopB'),
        transition('RETRY', 'loopB', 'loopA'),
        transition('FINISH', 'loopB', 'done'),
        transition('HIDDEN_LOOP', 'unreachable', 'unreachable'),
      ]),
    );

    expect(analysis.cycles).toEqual([
      {
        states: ['loopA', 'loopB'],
        cycleLength: 2,
        entryDistance: 1,
        entryPath: ['start', 'loopA'],
        exitDistance: 1,
        exitPath: ['loopB', 'done'],
        endState: 'done',
      },
    ]);
    expect(analysis.cyclesTruncated).toBe(false);
    expect(analysis.paths).toEqual([
      {
        states: ['start', 'loopA', 'loopB', 'done'],
        endsInFinalState: true,
      },
      { states: ['start', 'done'], endsInFinalState: true },
    ]);
  });

  it('reports individual cycles inside one connected cyclic region', () => {
    const analysis = analyzeMachine(
      graph([
        transition('ENTER', 'start', 'loopA'),
        transition('AB', 'loopA', 'loopB'),
        transition('BA', 'loopB', 'loopA'),
        transition('BC', 'loopB', 'unreachable'),
        transition('CB', 'unreachable', 'loopB'),
        transition('EXIT', 'unreachable', 'done'),
      ]),
    );

    expect(
      analysis.cycles.map(
        ({ states, cycleLength, entryDistance, exitDistance, endState }) => ({
          states,
          cycleLength,
          entryDistance,
          exitDistance,
          endState,
        }),
      ),
    ).toEqual([
      {
        states: ['loopA', 'loopB'],
        cycleLength: 2,
        entryDistance: 1,
        exitDistance: 2,
        endState: 'done',
      },
      {
        states: ['loopB', 'unreachable'],
        cycleLength: 2,
        entryDistance: 2,
        exitDistance: 1,
        endState: 'done',
      },
    ]);
  });

  it('counts transitions separately from neighboring states', () => {
    const analysis = analyzeMachine(
      graph([
        transition('ONE', 'start', 'loopA'),
        transition('TWO', 'start', 'loopA'),
        transition('THREE', 'loopB', 'loopA'),
      ]),
    );

    expect(
      analysis.stateConnections.find(({ state }) => state === 'loopA'),
    ).toMatchObject({
      incomingTransitions: 3,
      incomingStates: 2,
      outgoingTransitions: 0,
      outgoingStates: 0,
    });
  });
});
