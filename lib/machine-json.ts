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
  id?: string;
  initial?: string;
  states?: Record<string, MachineStateJSON>;
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
  stateId?: string;
  parentKey?: string;
  initialChild?: string;
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
  'id',
  'initial',
  'states',
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
  const stateByKey = new Map(graph.states.map((state) => [state.key, state]));
  const stateIds = new Set<string>();
  const childrenByParent = new Map<string | undefined, GraphState[]>();
  for (const state of graph.states) {
    if (state.stateId !== undefined) {
      if (!state.stateId.trim()) issues.push(`State ${state.key} id cannot be empty.`);
      if (stateIds.has(state.stateId)) issues.push(`State id ${state.stateId} must be unique.`);
      stateIds.add(state.stateId);
    }
    const children = childrenByParent.get(state.parentKey) ?? [];
    children.push(state);
    childrenByParent.set(state.parentKey, children);
  }

  if (
    !graph.initial ||
    !keySet.has(graph.initial) ||
    stateByKey.get(graph.initial)?.parentKey !== undefined
  ) {
    issues.push('Choose exactly one existing top-level state as initial.');
  }

  for (const state of graph.states) {
    if (state.parentKey !== undefined) {
      const parent = stateByKey.get(state.parentKey);
      if (!parent) {
        issues.push(
          `State ${state.key} refers to missing parent ${state.parentKey}.`,
        );
      } else if (parent.final) {
        issues.push(`Final state ${parent.key} cannot contain child states.`);
      }

      const seenParents = new Set<string>([state.key]);
      let currentParent: string | undefined = state.parentKey;
      while (currentParent !== undefined) {
        if (seenParents.has(currentParent)) {
          issues.push(`State ${state.key} cannot be its own ancestor.`);
          break;
        }
        seenParents.add(currentParent);
        currentParent = stateByKey.get(currentParent)?.parentKey;
      }
    }

    const children = childrenByParent.get(state.key) ?? [];
    if (children.length > 0) {
      if (state.final) {
        issues.push(`Final state ${state.key} cannot contain child states.`);
      }
      if (!state.initialChild) {
        issues.push(`Parent state ${state.key} needs an initial child.`);
      } else if (!children.some((child) => child.key === state.initialChild)) {
        issues.push(
          `Parent state ${state.key} initial child ${state.initialChild} does not exist.`,
        );
      }
    } else if (state.initialChild !== undefined) {
      issues.push(`State ${state.key} cannot declare an initial child.`);
    }
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

  const hasHierarchy = graph.states.some(
    (state) => state.parentKey !== undefined || state.initialChild !== undefined,
  );
  const stateByKey = new Map(graph.states.map((state) => [state.key, state]));
  const childrenByParent = new Map<string | undefined, GraphState[]>();
  for (const state of graph.states) {
    const children = childrenByParent.get(state.parentKey) ?? [];
    children.push(state);
    childrenByParent.set(state.parentKey, children);
  }

  const serializeState = (state: GraphState): MachineStateJSON => {
    const stateJson: MachineStateJSON = {};
    if (state.stateId) stateJson.id = state.stateId;
    else if (hasHierarchy) stateJson.id = state.key;
    if (state.final) stateJson.type = 'final';
    if (state.description.trim()) stateJson.description = state.description.trim();
    if (state.tags.length) stateJson.tags = [...new Set(state.tags)];
    if (state.meta !== undefined) stateJson.meta = state.meta;
    if (state.entryActions.length) stateJson.entry = serializeActions(state.entryActions);
    if (state.exitActions.length) stateJson.exit = serializeActions(state.exitActions);

    const children = childrenByParent.get(state.key) ?? [];
    if (children.length) {
      stateJson.initial = state.initialChild as string;
      stateJson.states = Object.fromEntries(
        children.map((child) => [child.key, serializeState(child)]),
      );
    }

    const outgoing = graph.transitions.filter((transition) => transition.source === state.key);
    if (outgoing.length) {
      stateJson.on = Object.fromEntries(
        outgoing.map((transition) => {
          const targetState = stateByKey.get(transition.target);
          const sameParent =
            targetState?.parentKey === state.parentKey &&
            (childrenByParent.get(state.key) ?? []).length === 0;
          const targetIsChild = targetState?.parentKey === state.key;
          const target =
            hasHierarchy && targetIsChild
              ? `.${targetState?.key ?? transition.target}`
              : hasHierarchy && !sameParent
              ? `#${targetState?.stateId ?? transition.target}`
              : transition.target;
          return [
            transition.event,
            {
              target,
              ...(transition.actions.length ? { actions: serializeActions(transition.actions) } : {}),
            },
          ];
        }),
      );
    }
    return stateJson;
  };

  for (const state of childrenByParent.get(undefined) ?? []) {
    machine.states[state.key] = serializeState(state);
  }
  if (hasHierarchy) machine.initial = graph.initial;

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

  type RawState = { key: string; parentKey?: string; raw: Record<string, unknown>; path: string; index: number; localIndex: number };
  const rawStates: RawState[] = [];
  const stateIds = new Map<string, string>();
  const collectStates = (entries: [string, unknown][], parentKey?: string) => {
    entries.forEach(([key, rawState], localIndex) => {
      const path = parentKey ? `machine.states.${parentKey}.states.${key}` : `machine.states.${key}`;
      if (!key.trim()) issues.push('State keys cannot be empty.');
      if (!isRecord(rawState)) {
        issues.push(`${path} must be an object.`);
        return;
      }
      if (rawStates.some((state) => state.key === key)) {
        issues.push(`State keys must be unique. Duplicate key ${key}.`);
      }
      const index = rawStates.length;
      rawStates.push({ key, parentKey, raw: rawState, path, index, localIndex });
      if (rawState.id !== undefined) {
        if (typeof rawState.id !== 'string' || !rawState.id.trim()) {
          issues.push(`${path}.id must be a non-empty string.`);
        } else if (stateIds.has(rawState.id)) {
          issues.push(`State id ${rawState.id} must be unique.`);
        } else {
          stateIds.set(rawState.id, key);
        }
      }
      if (rawState.states !== undefined) {
        if (!isRecord(rawState.states) || Object.keys(rawState.states).length === 0) {
          issues.push(`${path}.states must contain at least one state.`);
        } else {
          collectStates(Object.entries(rawState.states), key);
        }
      }
    });
  };
  const stateEntries = isRecord(input.states) ? Object.entries(input.states) : [];
  collectStates(stateEntries);
  const stateKeys = new Set(rawStates.map((state) => state.key));
  if (typeof input.initial === 'string' && !rawStates.some((state) => state.key === input.initial && state.parentKey === undefined)) {
    issues.push(`machine.initial refers to missing top-level state ${input.initial}.`);
  }

  const states: GraphState[] = [];
  const transitions: GraphTransition[] = [];
  const resolveTarget = (source: RawState, target: string) => {
    const normalized = target.trim();
    if (normalized.startsWith('#')) {
      const id = normalized.slice(1);
      return stateIds.get(id) ?? id;
    }
    if (normalized.startsWith('.')) return normalized.slice(1);
    if (stateKeys.has(normalized)) return normalized;
    const parent = source.parentKey;
    if (parent) {
      const sibling = rawStates.find((state) => state.parentKey === parent && state.key === normalized);
      if (sibling) return sibling.key;
    }
    return normalized;
  };

  rawStates.forEach((entry) => {
    const { key, raw: rawState, path, parentKey, index, localIndex } = entry;
    assertOnlyKeys(rawState, STATE_KEYS, path, issues);
    if (rawState.type !== undefined && rawState.type !== 'final') issues.push(`${path}.type only supports "final".`);
    const final = rawState.type === 'final';
    const stateDescription = validateOptionalString(rawState.description, `${path}.description`, issues);
    const stateTags = validateTags(rawState.tags, `${path}.tags`, issues);
    const stateMeta = rawState.meta;
    if (stateMeta !== undefined) validateJsonValue(stateMeta, `${path}.meta`, issues);
    const childEntries = isRecord(rawState.states) ? Object.entries(rawState.states) : [];
    const initialChild = rawState.initial;
    if (childEntries.length > 0) {
      if (typeof initialChild !== 'string' || !initialChild.trim()) issues.push(`${path}.initial must name one child state.`);
      else if (!childEntries.some(([childKey]) => childKey === initialChild)) issues.push(`${path}.initial refers to missing child ${initialChild}.`);
    } else if (initialChild !== undefined) {
      issues.push(`${path}.initial is only valid for a parent state with child states.`);
    }
    const savedPosition = editorNodes[key];
    const entryActions = parseActions(rawState.entry, `${path}.entry`, key, 'entry', issues);
    const exitActions = parseActions(rawState.exit, `${path}.exit`, key, 'exit', issues);
    if (final && exitActions.length > 0) issues.push(`Final state ${key} cannot have exit actions.`);
    states.push({
      key,
      ...(typeof rawState.id === 'string' && rawState.id.trim()
        ? { stateId: rawState.id.trim() }
        : {}),
      ...(parentKey !== undefined ? { parentKey } : {}),
      ...(childEntries.length && typeof initialChild === 'string' ? { initialChild } : {}),
      position: savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y) ? { x: savedPosition.x, y: savedPosition.y } : autoPosition(parentKey ? localIndex : index),
      final,
      description: stateDescription,
      tags: stateTags,
      entryActions,
      exitActions,
      ...(stateMeta !== undefined && validateJsonValue(stateMeta, `${path}.meta`, issues) ? { meta: stateMeta as JsonValue } : {}),
    });
  });

  rawStates.forEach((entry) => {
    const rawOn = entry.raw.on;
    if (rawOn === undefined) return;
    if (!isRecord(rawOn)) {
      issues.push(`${entry.path}.on must be an object keyed by event name.`);
      return;
    }
    if (entry.raw.type === 'final' && Object.keys(rawOn).length > 0) issues.push(`Final state ${entry.key} cannot have outgoing transitions.`);
    Object.entries(rawOn).forEach(([event, rawTransition]) => {
      const transitionPath = `${entry.path}.on.${event}`;
      if (!event.trim()) issues.push(`${entry.path}.on contains an empty event name.`);
      if (!isRecord(rawTransition)) {
        issues.push(`${transitionPath} must use the object form { "target": "state" }.`);
        return;
      }
      assertOnlyKeys(rawTransition, TRANSITION_KEYS, transitionPath, issues);
      if (typeof rawTransition.target !== 'string' || !rawTransition.target.trim()) {
        issues.push(`${transitionPath}.target must name one state.`);
        return;
      }
      const target = resolveTarget(entry, rawTransition.target);
      if (!stateKeys.has(target)) issues.push(`${transitionPath}.target refers to missing state ${rawTransition.target}.`);
      const actions = parseActions(rawTransition.actions, `${transitionPath}.actions`, entry.key, event, issues);
      transitions.push({ id: transitionId(entry.key, event, transitions.length), source: entry.key, target, event, actions });
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
