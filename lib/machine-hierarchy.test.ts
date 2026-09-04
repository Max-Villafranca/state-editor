import { describe, expect, it } from 'vitest';
import { machineJSONToGraph } from './machine-json';
import {
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
      expect.objectContaining({ source: 'contacting', event: 'INTERESTED', target: 'interested' }),
    ]);
  });

  it('marks parent and active descendants reachable', () => {
    expect(getReachableStateKeys(graph)).toEqual(new Set(['calling', 'contacting', 'interested']));
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
      expect.objectContaining({ source: 'paused', target: 'ready', event: 'RESUME' }),
    );
  });
});

