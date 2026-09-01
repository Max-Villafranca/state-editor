import { describe, expect, it, vi } from 'vitest';
import {
  createActor,
  createMachineFromConfig,
  serializeMachine,
  type MachineJSON as XStateMachineJSON,
} from 'xstate';

import {
  MachineValidationError,
  createEditorProject,
  editorFileToGraph,
  graphToMachineJSON,
  machineJSONToGraph,
  type MachineJSON,
} from './machine-json';

const definition: MachineJSON = {
  id: 'leadContact',
  initial: 'neverCalled',
  description: 'Lead outreach flow',
  tags: ['sales'],
  states: {
    neverCalled: {
      description: 'No attempt yet',
      entry: [{ type: 'initializeState' }],
      exit: [{ type: 'cleanupState', params: { preserveDraft: true } }],
      on: {
        CALL_FAILED: {
          target: 'oneCallFailed',
          actions: [
            {
              type: 'scheduleCallback',
              params: { cooldownMinutes: 120, queue: 'sales' },
            },
            { type: 'recordAttempt' },
          ],
        },
        WRONG_NUMBER: { target: 'wrongNumber' },
      },
    },
    oneCallFailed: {
      tags: ['cooldown'],
      meta: { cooldownMinutes: 120 },
    },
    wrongNumber: {
      type: 'final',
    },
  },
};

describe('MachineJSON conversion', () => {
  it('round-trips the supported machine semantics', () => {
    const graph = machineJSONToGraph(definition);
    expect(graphToMachineJSON(graph)).toEqual(definition);
  });

  it('preserves the absence of an optional machine id', () => {
    const machineWithoutId: MachineJSON = {
      initial: 'idle',
      states: { idle: {} },
    };

    expect(graphToMachineJSON(machineJSONToGraph(machineWithoutId))).toEqual(
      machineWithoutId,
    );
  });

  it('keeps editor layout outside the exported machine', () => {
    const graph = machineJSONToGraph(definition);
    graph.states[0].position = { x: 987, y: 654 };

    const project = createEditorProject(
      graph,
      { x: 30, y: -20, zoom: 1.4 },
      { kind: 'state', id: 'neverCalled' },
    );
    const exportedMachine = graphToMachineJSON(graph);

    expect(project.editor.nodes.neverCalled).toEqual({ x: 987, y: 654 });
    expect(project.machine).toEqual(exportedMachine);
    expect(project).toHaveProperty('format', 'state-editor-project');
    expect(exportedMachine).toEqual(definition);
    expect(exportedMachine).not.toHaveProperty('editor');
    expect(exportedMachine).not.toHaveProperty('format');
    expect(JSON.stringify(exportedMachine)).not.toContain('position');
    expect(JSON.stringify(exportedMachine)).not.toContain('xstateTarget');
  });

  it('opens a project file with its editor layout intact', () => {
    const graph = machineJSONToGraph(definition);
    graph.states[0].position = { x: 321, y: 654 };
    const project = createEditorProject(
      graph,
      { x: 45, y: -30, zoom: 1.25 },
      { kind: 'state', id: 'neverCalled' },
    );

    const opened = editorFileToGraph(project);

    expect(opened.kind).toBe('project');
    expect(opened.graph.states[0].position).toEqual({ x: 321, y: 654 });
    expect(opened.viewport).toEqual({ x: 45, y: -30, zoom: 1.25 });
    expect(opened.selection).toEqual({
      kind: 'state',
      id: 'neverCalled',
    });
  });

  it('restores the selected transition from an interactively created project', () => {
    const graph = machineJSONToGraph(definition);
    graph.transitions[0].id = 'transition-created-in-the-editor';
    const project = createEditorProject(
      graph,
      { x: 0, y: 0, zoom: 1 },
      { kind: 'transition', id: 'transition-created-in-the-editor' },
    );

    const opened = editorFileToGraph(project);

    expect(opened.selection?.kind).toBe('transition');
    expect(
      opened.graph.transitions.find(
        (transition) => transition.id === opened.selection?.id,
      ),
    ).toMatchObject({
      source: 'neverCalled',
      target: 'oneCallFailed',
      event: 'CALL_FAILED',
    });
  });

  it('opens a MachineJSON file as a fresh editor project', () => {
    const opened = editorFileToGraph(definition);

    expect(opened.kind).toBe('machine-json');
    expect(graphToMachineJSON(opened.graph)).toEqual(definition);
    expect(opened.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(opened.selection).toEqual({ kind: 'machine', id: 'machine' });
  });

  it('rejects unsupported shorthand and unsupported properties', () => {
    expect(() =>
      machineJSONToGraph({
        initial: 'idle',
        states: { idle: { on: { GO: 'done' } }, done: {} },
      }),
    ).toThrow(MachineValidationError);

    expect(() =>
      machineJSONToGraph({
        version: '6',
        initial: 'idle',
        states: { idle: {} },
      }),
    ).toThrow(/version is not supported/);
  });

  it.each([
    {
      case: 'a transition targeting a missing state',
      input: {
        initial: 'idle',
        states: {
          idle: { on: { GO: { target: 'missing' } } },
        },
      },
      message: /target refers to missing state missing/,
    },
    {
      case: 'an outgoing transition on a final state',
      input: {
        initial: 'done',
        states: {
          done: { type: 'final', on: { RETRY: { target: 'done' } } },
        },
      },
      message: /Final state done cannot have outgoing transitions/,
    },
    {
      case: 'executable metadata',
      input: {
        initial: 'idle',
        meta: { '@code': 'runSomething()' },
        states: { idle: {} },
      },
      message: /contains an @code expression/,
    },
    {
      case: 'an action with non-object parameters',
      input: {
        initial: 'idle',
        states: {
          idle: {
            on: {
              GO: {
                target: 'done',
                actions: [{ type: 'notify', params: 'not-an-object' }],
              },
            },
          },
          done: {},
        },
      },
      message: /params must be a JSON object/,
    },
    {
      case: 'an exit action on a final state',
      input: {
        initial: 'done',
        states: {
          done: {
            type: 'final',
            exit: [{ type: 'cleanupState' }],
          },
        },
      },
      message: /Final state done cannot have exit actions/,
    },
    {
      case: 'an unsupported State Editor project version',
      input: {
        format: 'state-editor-project',
        version: 2,
        xstateTarget: 'v6-machine-json',
        machine: { initial: 'idle', states: { idle: {} } },
        editor: {},
      },
      message: /Saved project format is not supported/,
    },
  ])('rejects $case', ({ input, message }) => {
    expect(() => editorFileToGraph(input)).toThrow(message);
  });
});

describe('XState v6 compatibility', () => {
  it('revives and serializes the complete supported export without loss', () => {
    const exported = graphToMachineJSON(machineJSONToGraph(definition));
    const revived = createMachineFromConfig(
      JSON.parse(JSON.stringify(exported)) as XStateMachineJSON,
      {
        actions: {
          initializeState: () => undefined,
          cleanupState: () => undefined,
          scheduleCallback: () => undefined,
          recordAttempt: () => undefined,
        },
      },
    );

    expect(serializeMachine(revived)).toEqual(definition);
  });

  it('executes exported transitions and resolves named action sources', () => {
    const initializeState = vi.fn();
    const cleanupState = vi.fn();
    const scheduleCallback = vi.fn();
    const recordAttempt = vi.fn();
    const machine = createMachineFromConfig(
      graphToMachineJSON(machineJSONToGraph(definition)) as XStateMachineJSON,
      {
        actions: {
          initializeState,
          cleanupState,
          scheduleCallback,
          recordAttempt,
        },
      },
    );
    const actor = createActor(machine);

    actor.start();
    expect(actor.getSnapshot().value).toBe('neverCalled');
    expect(initializeState).toHaveBeenCalledOnce();

    actor.send({ type: 'CALL_FAILED' });
    expect(actor.getSnapshot().value).toBe('oneCallFailed');
    expect(cleanupState).toHaveBeenCalledOnce();
    expect(scheduleCallback).toHaveBeenCalledOnce();
    expect(recordAttempt).toHaveBeenCalledOnce();
    actor.stop();
  });

  it('supports multiple alternative final states with one initial state', () => {
    const alternativeOutcomes: MachineJSON = {
      initial: 'working',
      states: {
        working: {
          on: {
            SUCCEED: { target: 'completed' },
            FAIL: { target: 'failed' },
          },
        },
        completed: { type: 'final' },
        failed: { type: 'final' },
      },
    };

    const exported = graphToMachineJSON(
      machineJSONToGraph(alternativeOutcomes),
    );
    expect(
      Object.values(exported.states).filter((state) => state.type === 'final'),
    ).toHaveLength(2);
    expect(() =>
      createMachineFromConfig(exported as XStateMachineJSON),
    ).not.toThrow();
  });
});
