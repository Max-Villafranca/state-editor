export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MachineActionJSON = {
  type: string;
  params?: Record<string, JsonValue>;
};

export type MachineTransitionJSON = {
  target: string;
  actions?: MachineActionJSON[];
};

export type MachineStateJSON = {
  type?: 'final';
  description?: string;
  tags?: string[];
  meta?: JsonValue;
  entry?: MachineActionJSON[];
  exit?: MachineActionJSON[];
  on?: Record<string, MachineTransitionJSON>;
};

export type MachineJSON = {
  id?: string;
  initial: string;
  description?: string;
  tags?: string[];
  meta?: JsonValue;
  states: Record<string, MachineStateJSON>;
};

export type GraphState = {
  key: string;
  position: { x: number; y: number };
  final: boolean;
  description: string;
  tags: string[];
  meta?: JsonValue;
  entryActions: GraphAction[];
  exitActions: GraphAction[];
};

export type GraphTransition = {
  id: string;
  source: string;
  target: string;
  event: string;
  actions: GraphAction[];
};

export type GraphAction = {
  id: string;
  type: string;
  params?: Record<string, JsonValue>;
};

export type GraphMachine = {
  id: string;
  hasExplicitId: boolean;
  initial: string;
  description: string;
  tags: string[];
  meta?: JsonValue;
  states: GraphState[];
  transitions: GraphTransition[];
};

export type EditorSelection =
  | { kind: 'state'; id: string }
  | { kind: 'transition'; id: string }
  | { kind: 'machine'; id: 'machine' };

export type EditorViewport = { x: number; y: number; zoom: number };

export type EditorProject = {
  format: 'state-editor-project';
  version: 1;
  xstateTarget: 'v6-machine-json';
  machine: MachineJSON;
  editor: {
    nodes: Record<string, { x: number; y: number }>;
    viewport: EditorViewport;
    selection: EditorSelection | null;
  };
};

export type OpenedEditorFile = {
  kind: 'project' | 'machine-json';
  graph: GraphMachine;
  viewport: EditorViewport;
  selection: EditorSelection | null;
};

const ROOT_KEYS = new Set([
  'id',
  'initial',
  'states',
  'description',
  'tags',
  'meta',
]);
const STATE_KEYS = new Set([
  'type',
  'on',
  'description',
  'tags',
  'meta',
  'entry',
  'exit',
]);
const TRANSITION_KEYS = new Set(['target', 'actions']);
const ACTION_KEYS = new Set(['type', 'params']);

export class MachineValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? 'The machine is invalid.');
    this.name = 'MachineValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  supported: Set<string>,
  path: string,
  issues: string[],
) {
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) {
      issues.push(`${path}.${key} is not supported by this editor.`);
    }
  }
}

function validateTags(
  value: unknown,
  path: string,
  issues: string[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    issues.push(`${path} must be an array of strings.`);
    return [];
  }
  return [...new Set(value.map((tag) => tag.trim()).filter(Boolean))];
}

function validateJsonValue(
  value: unknown,
  path: string,
  issues: string[],
): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      issues.push(`${path} contains a non-finite number.`);
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, issues),
    );
  }
  if (isRecord(value)) {
    if ('@code' in value) {
      issues.push(
        `${path} contains an @code expression, which this editor does not support.`,
      );
      return false;
    }
    return Object.entries(value).every(([key, item]) =>
      validateJsonValue(item, `${path}.${key}`, issues),
    );
  }
  issues.push(`${path} must contain plain JSON values only.`);
  return false;
}

function validateOptionalString(
  value: unknown,
  path: string,
  issues: string[],
): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    issues.push(`${path} must be a string.`);
    return '';
  }
  return value;
}

function autoPosition(index: number) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 100 + column * 285, y: 100 + row * 180 };
}

function transitionId(source: string, event: string, index: number) {
  const safe = `${source}-${event}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `transition-${safe}-${index + 1}`;
}

function actionId(source: string, event: string, index: number) {
  const safe = `${source}-${event}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `action-${safe}-${index + 1}`;
}

function parseActions(
  value: unknown,
  path: string,
  scope: string,
  slot: string,
  issues: string[],
): GraphAction[] {
  const actions: GraphAction[] = [];
  if (value === undefined) return actions;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return actions;
  }

  value.forEach((rawAction, actionIndex) => {
    const actionPath = `${path}[${actionIndex}]`;
    if (!isRecord(rawAction)) {
      issues.push(`${actionPath} must be an action object.`);
      return;
    }
    assertOnlyKeys(rawAction, ACTION_KEYS, actionPath, issues);
    if (typeof rawAction.type !== 'string' || !rawAction.type.trim()) {
      issues.push(`${actionPath}.type must be a non-empty string.`);
      return;
    }
    if (rawAction.params !== undefined && !isRecord(rawAction.params)) {
      issues.push(`${actionPath}.params must be a JSON object.`);
      return;
    }
    if (
      rawAction.params !== undefined &&
      !validateJsonValue(rawAction.params, `${actionPath}.params`, issues)
    ) {
      return;
    }
    actions.push({
      id: actionId(scope, slot, actionIndex),
      type: rawAction.type.trim(),
      ...(rawAction.params !== undefined
        ? { params: rawAction.params as Record<string, JsonValue> }
        : {}),
    });
  });

  return actions;
}

function serializeActions(actions: GraphAction[]): MachineActionJSON[] {
  return actions.map((action) => ({
    type: action.type.trim(),
    ...(action.params !== undefined ? { params: action.params } : {}),
  }));
}

export function validateGraph(graph: GraphMachine): string[] {
  const issues: string[] = [];
  const keys = graph.states.map((state) => state.key);
  const keySet = new Set(keys);

  if (graph.states.length === 0) issues.push('Create at least one state.');
  if (keySet.size !== keys.length) issues.push('State keys must be unique.');
  if (keys.some((key) => key.trim().length === 0))
    issues.push('State keys cannot be empty.');
  if (!graph.initial || !keySet.has(graph.initial)) {
    issues.push('Choose exactly one existing top-level state as initial.');
  }

  const sourceEvents = new Set<string>();
  for (const transition of graph.transitions) {
    if (!keySet.has(transition.source)) {
      issues.push(
        `Transition ${transition.event || '(unnamed)'} has a missing source.`,
      );
    }
    if (!keySet.has(transition.target)) {
      issues.push(
        `Transition ${transition.event || '(unnamed)'} has a missing target.`,
      );
    }
    if (!transition.event.trim())
      issues.push('Every transition needs a non-empty event name.');

    transition.actions.forEach((action, actionIndex) => {
      const path = `transition ${transition.event || '(unnamed)'} action ${actionIndex + 1}`;
      if (!action.type.trim()) issues.push(`${path} needs a non-empty type.`);
      if (action.params !== undefined)
        validateJsonValue(action.params, `${path}.params`, issues);
    });

    const pair = `${transition.source}\u0000${transition.event}`;
    if (sourceEvents.has(pair)) {
      issues.push(
        `State ${transition.source} already has a transition for ${transition.event}.`,
      );
    }
    sourceEvents.add(pair);

    const sourceState = graph.states.find(
      (state) => state.key === transition.source,
    );
    if (sourceState?.final) {
      issues.push(
        `Final state ${sourceState.key} cannot have outgoing transitions.`,
      );
    }
  }

  if (graph.meta !== undefined)
    validateJsonValue(graph.meta, 'machine.meta', issues);
  for (const state of graph.states) {
    if (state.meta !== undefined)
      validateJsonValue(state.meta, `states.${state.key}.meta`, issues);
    for (const [slot, actions] of [
      ['entry', state.entryActions],
      ['exit', state.exitActions],
    ] as const) {
      actions.forEach((action, actionIndex) => {
        const path = `state ${state.key} ${slot} action ${actionIndex + 1}`;
        if (!action.type.trim()) issues.push(`${path} needs a non-empty type.`);
        if (action.params !== undefined)
          validateJsonValue(action.params, `${path}.params`, issues);
      });
    }
    if (state.final && state.exitActions.length > 0) {
      issues.push(`Final state ${state.key} cannot have exit actions.`);
    }
  }

  return [...new Set(issues)];
}

export function graphToMachineJSON(graph: GraphMachine): MachineJSON {
  const issues = validateGraph(graph);
  if (issues.length > 0) throw new MachineValidationError(issues);

  const machine: MachineJSON = {
    initial: graph.initial,
    states: {},
  };

  if (graph.hasExplicitId && graph.id.trim()) machine.id = graph.id.trim();
  if (graph.description.trim()) machine.description = graph.description.trim();
  if (graph.tags.length) machine.tags = [...new Set(graph.tags)];
  if (graph.meta !== undefined) machine.meta = graph.meta;

  for (const state of graph.states) {
    const stateJson: MachineStateJSON = {};
    if (state.final) stateJson.type = 'final';
    if (state.description.trim())
      stateJson.description = state.description.trim();
    if (state.tags.length) stateJson.tags = [...new Set(state.tags)];
    if (state.meta !== undefined) stateJson.meta = state.meta;
    if (state.entryActions.length)
      stateJson.entry = serializeActions(state.entryActions);
    if (state.exitActions.length)
      stateJson.exit = serializeActions(state.exitActions);

    const outgoing = graph.transitions.filter(
      (transition) => transition.source === state.key,
    );
    if (outgoing.length) {
      stateJson.on = Object.fromEntries(
        outgoing.map((transition) => [
          transition.event,
          {
            target: transition.target,
            ...(transition.actions.length
              ? {
                  actions: serializeActions(transition.actions),
                }
              : {}),
          },
        ]),
      );
    }
    machine.states[state.key] = stateJson;
  }

  return machine;
}

export function machineJSONToGraph(
  input: unknown,
  editorNodes: Record<string, { x: number; y: number }> = {},
): GraphMachine {
  const issues: string[] = [];
  if (!isRecord(input)) {
    throw new MachineValidationError(['Machine JSON must be a JSON object.']);
  }

  assertOnlyKeys(input, ROOT_KEYS, 'machine', issues);
  const id =
    validateOptionalString(input.id, 'machine.id', issues) || 'machine';
  const description = validateOptionalString(
    input.description,
    'machine.description',
    issues,
  );
  const tags = validateTags(input.tags, 'machine.tags', issues);
  const meta = input.meta;
  if (meta !== undefined) validateJsonValue(meta, 'machine.meta', issues);

  if (typeof input.initial !== 'string' || input.initial.trim().length === 0) {
    issues.push('machine.initial must name one top-level state.');
  }
  if (!isRecord(input.states) || Object.keys(input.states).length === 0) {
    issues.push('machine.states must contain at least one state.');
  }

  const stateEntries = isRecord(input.states)
    ? Object.entries(input.states)
    : [];
  const stateKeys = new Set(stateEntries.map(([key]) => key));
  if (typeof input.initial === 'string' && !stateKeys.has(input.initial)) {
    issues.push(`machine.initial refers to missing state ${input.initial}.`);
  }

  const states: GraphState[] = [];
  const transitions: GraphTransition[] = [];

  stateEntries.forEach(([key, rawState], stateIndex) => {
    const path = `machine.states.${key}`;
    if (!key.trim()) issues.push('State keys cannot be empty.');
    if (!isRecord(rawState)) {
      issues.push(`${path} must be an object.`);
      return;
    }

    assertOnlyKeys(rawState, STATE_KEYS, path, issues);
    if (rawState.type !== undefined && rawState.type !== 'final') {
      issues.push(`${path}.type only supports "final".`);
    }
    const final = rawState.type === 'final';
    const stateDescription = validateOptionalString(
      rawState.description,
      `${path}.description`,
      issues,
    );
    const stateTags = validateTags(rawState.tags, `${path}.tags`, issues);
    const stateMeta = rawState.meta;
    if (stateMeta !== undefined)
      validateJsonValue(stateMeta, `${path}.meta`, issues);

    const savedPosition = editorNodes[key];
    const entryActions = parseActions(
      rawState.entry,
      `${path}.entry`,
      key,
      'entry',
      issues,
    );
    const exitActions = parseActions(
      rawState.exit,
      `${path}.exit`,
      key,
      'exit',
      issues,
    );
    if (final && exitActions.length > 0) {
      issues.push(`Final state ${key} cannot have exit actions.`);
    }

    states.push({
      key,
      position:
        savedPosition &&
        Number.isFinite(savedPosition.x) &&
        Number.isFinite(savedPosition.y)
          ? { x: savedPosition.x, y: savedPosition.y }
          : autoPosition(stateIndex),
      final,
      description: stateDescription,
      tags: stateTags,
      entryActions,
      exitActions,
      ...(stateMeta !== undefined &&
      validateJsonValue(stateMeta, `${path}.meta`, issues)
        ? { meta: stateMeta }
        : {}),
    });

    if (rawState.on === undefined) return;
    if (!isRecord(rawState.on)) {
      issues.push(`${path}.on must be an object keyed by event name.`);
      return;
    }
    if (final && Object.keys(rawState.on).length > 0) {
      issues.push(`Final state ${key} cannot have outgoing transitions.`);
    }

    Object.entries(rawState.on).forEach(([event, rawTransition]) => {
      const transitionPath = `${path}.on.${event}`;
      if (!event.trim())
        issues.push(`${path}.on contains an empty event name.`);
      if (!isRecord(rawTransition)) {
        issues.push(
          `${transitionPath} must use the object form { "target": "state" }.`,
        );
        return;
      }
      assertOnlyKeys(rawTransition, TRANSITION_KEYS, transitionPath, issues);
      if (
        typeof rawTransition.target !== 'string' ||
        !rawTransition.target.trim()
      ) {
        issues.push(`${transitionPath}.target must name one state.`);
        return;
      }
      if (!stateKeys.has(rawTransition.target)) {
        issues.push(
          `${transitionPath}.target refers to missing state ${rawTransition.target}.`,
        );
      }
      const actions = parseActions(
        rawTransition.actions,
        `${transitionPath}.actions`,
        key,
        event,
        issues,
      );
      transitions.push({
        id: transitionId(key, event, transitions.length),
        source: key,
        target: rawTransition.target,
        event,
        actions,
      });
    });
  });

  if (issues.length > 0) throw new MachineValidationError([...new Set(issues)]);

  return {
    id,
    hasExplicitId: input.id !== undefined,
    initial: input.initial as string,
    description,
    tags,
    ...(meta !== undefined ? { meta: meta as JsonValue } : {}),
    states,
    transitions,
  };
}

export function createEditorProject(
  graph: GraphMachine,
  viewport: EditorViewport,
  selection: EditorSelection | null,
): EditorProject {
  const machine = graphToMachineJSON(graph);
  let persistedSelection = selection;
  if (selection?.kind === 'transition') {
    const selectedTransition = graph.transitions.find(
      (transition) => transition.id === selection.id,
    );
    const reopenedTransition = selectedTransition
      ? machineJSONToGraph(machine).transitions.find(
          (transition) =>
            transition.source === selectedTransition.source &&
            transition.event === selectedTransition.event,
        )
      : undefined;
    persistedSelection = reopenedTransition
      ? { kind: 'transition', id: reopenedTransition.id }
      : null;
  }
  return {
    format: 'state-editor-project',
    version: 1,
    xstateTarget: 'v6-machine-json',
    machine,
    editor: {
      nodes: Object.fromEntries(
        graph.states.map((state) => [state.key, { ...state.position }]),
      ),
      viewport: { ...viewport },
      selection: persistedSelection,
    },
  };
}

export function editorProjectToGraph(input: unknown): {
  graph: GraphMachine;
  viewport: EditorViewport;
  selection: EditorSelection | null;
} {
  if (!isRecord(input)) {
    throw new MachineValidationError([
      'Saved project data is not a JSON object.',
    ]);
  }
  if (
    input.format !== 'state-editor-project' ||
    input.version !== 1 ||
    input.xstateTarget !== 'v6-machine-json' ||
    !isRecord(input.editor)
  ) {
    throw new MachineValidationError([
      'Saved project format is not supported.',
    ]);
  }

  const rawNodes = isRecord(input.editor.nodes) ? input.editor.nodes : {};
  const editorNodes: Record<string, { x: number; y: number }> = {};
  for (const [key, value] of Object.entries(rawNodes)) {
    if (
      isRecord(value) &&
      typeof value.x === 'number' &&
      typeof value.y === 'number'
    ) {
      editorNodes[key] = { x: value.x, y: value.y };
    }
  }

  const rawViewport = input.editor.viewport;
  const viewport: EditorViewport =
    isRecord(rawViewport) &&
    typeof rawViewport.x === 'number' &&
    typeof rawViewport.y === 'number' &&
    typeof rawViewport.zoom === 'number'
      ? { x: rawViewport.x, y: rawViewport.y, zoom: rawViewport.zoom }
      : { x: 0, y: 0, zoom: 1 };

  const graph = machineJSONToGraph(input.machine, editorNodes);
  const rawSelection = input.editor.selection;
  let selection: EditorSelection | null = null;
  if (isRecord(rawSelection) && typeof rawSelection.id === 'string') {
    if (
      rawSelection.kind === 'state' &&
      graph.states.some((state) => state.key === rawSelection.id)
    ) {
      selection = { kind: 'state', id: rawSelection.id };
    } else if (
      rawSelection.kind === 'transition' &&
      graph.transitions.some((transition) => transition.id === rawSelection.id)
    ) {
      selection = { kind: 'transition', id: rawSelection.id };
    } else if (rawSelection.kind === 'machine') {
      selection = { kind: 'machine', id: 'machine' };
    }
  }

  return { graph, viewport, selection };
}

export function editorFileToGraph(input: unknown): OpenedEditorFile {
  if (isRecord(input) && input.format === 'state-editor-project') {
    return { kind: 'project', ...editorProjectToGraph(input) };
  }

  return {
    kind: 'machine-json',
    graph: machineJSONToGraph(input),
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: { kind: 'machine', id: 'machine' },
  };
}
