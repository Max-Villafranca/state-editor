import {
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowRight,
  Check,
  CircleStop,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Moon,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Redo2,
  Save,
  Square,
  Sun,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { Button } from '@/components/ui/button';
import { ActionListEditor } from '@/components/action-list-editor';
import {
  MachineAnalysisPanel,
  type AnalysisView,
  type StateDirection,
} from '@/components/machine-analysis-panel';
import {
  TransitionEdge,
  type TransitionBundleEdge,
} from '@/components/transition-edge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  readMinimapVisibility,
  writeMinimapVisibility,
} from '@/lib/editor-preferences';
import {
  forgetProjectFileHandle,
  recallProjectFileHandle,
  rememberProjectFileHandle,
} from '@/lib/project-file-handle';
import {
  MachineValidationError,
  createEditorProject,
  editorFileToGraph,
  editorProjectToGraph,
  graphToMachineJSON,
  validateGraph,
  type EditorSelection,
  type EditorViewport,
  type GraphAction,
  type GraphMachine,
  type GraphState,
  type GraphTransition,
  type JsonValue,
} from '@/lib/machine-json';
import { analyzeMachine } from '@/lib/machine-analysis';
import {
  getEffectiveTransitions,
  getInitialLeafState,
  getReachableStateKeys as getHierarchyReachableStateKeys,
  getStateChildren,
  getState,
  getHierarchyLayout,
  getSelectionRoots,
  getGroupingIssue,
  groupStates,
  removeHierarchyStates,
  reparentState,
  findContainingParent,
} from '@/lib/machine-hierarchy';
import { useUndoableState } from '@/lib/undo-history';
import { createTransitionRoutes } from '@/lib/transition-routes';

const STORAGE_KEY = 'state-editor.project.v1';
const RECOVERY_FILE_NAME_KEY = 'state-editor.project-file-name.v1';
const THEME_KEY = 'state-editor.theme';
const edgeTypes = { transitionBundle: TransitionEdge };

function createEmptyGraph(): GraphMachine {
  return {
    id: '',
    hasExplicitId: false,
    initial: '',
    description: '',
    tags: [],
    states: [],
    transitions: [],
  };
}

type LoadedEditorProject = ReturnType<typeof editorProjectToGraph>;

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
};

type PermissionAwareFileHandle = FileSystemFileHandle & {
  queryPermission?: (options: {
    mode: 'readwrite';
  }) => Promise<PermissionState>;
  requestPermission?: (options: {
    mode: 'readwrite';
  }) => Promise<PermissionState>;
};

async function hasWritePermission(
  handle: FileSystemFileHandle,
  requestIfNeeded: boolean,
) {
  const permissionHandle = handle as PermissionAwareFileHandle;
  if (!permissionHandle.queryPermission) return true;
  if (
    (await permissionHandle.queryPermission({ mode: 'readwrite' })) ===
    'granted'
  ) {
    return true;
  }
  return Boolean(
    requestIfNeeded &&
    permissionHandle.requestPermission &&
    (await permissionHandle.requestPermission({ mode: 'readwrite' })) ===
      'granted',
  );
}

const PROJECT_FILE_TYPES = [
  {
    description: 'State Editor project',
    accept: { 'application/json': ['.se.json'] },
  },
];

const MACHINE_JSON_FILE_TYPES = [
  {
    description: 'XState MachineJSON',
    accept: { 'application/json': ['.json'] },
  },
];

const EDITOR_FILE_TYPES = [
  {
    description: 'State Editor project or XState MachineJSON',
    accept: { 'application/json': ['.se.json', '.json'] },
  },
];

type StateNodeData = Record<string, unknown> & {
  label: string;
  initial: boolean;
  initialWithinParent: boolean;
  final: boolean;
  unreachable: boolean;
  current: boolean;
  editing: boolean;
  simulating: boolean;
  analysisHighlighted: boolean;
  analysisContextHighlighted: boolean;
  isParent: boolean;
  childCount: number;
  dropTarget: boolean;
  onBeginRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
};

type StateFlowNode = Node<StateNodeData, 'state'>;
type StateFlowNodeRuntime = Pick<
  StateFlowNode,
  'measured' | 'width' | 'height' | 'dragging' | 'resizing'
>;

function StateRenameInput({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => onCommit(draft);
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className="nodrag nowheel min-w-0 flex-1 border-b border-violet-400 bg-transparent font-mono text-[13px] font-semibold text-slate-800 outline-none dark:text-slate-100"
      aria-label="State key"
    />
  );
}

function InitialStateMark({ label = 'Initial state' }: { label?: string }) {
  return (
    <span
      className="flex items-center text-violet-700 dark:text-violet-300"
      aria-label={label}
      title={label}
    >
      <span className="size-2.5 rounded-full bg-current" />
      <span className="h-px w-2 bg-current" />
      <span className="-ml-1 size-1.5 rotate-45 border-r border-t border-current" />
    </span>
  );
}

function FinalStateMark() {
  return (
    <span
      className="flex size-4 items-center justify-center rounded-full border-2 border-emerald-700 dark:border-emerald-400"
      aria-label="Final state"
      title="Final state"
    >
      <span className="size-2 rounded-full bg-emerald-700 dark:bg-emerald-400" />
    </span>
  );
}

function StateNode({ data, selected }: NodeProps<StateFlowNode>) {
  const isParent = data.isParent;
  return (
    <div
      data-state-frame={isParent ? data.label : undefined}
      data-analysis-highlighted={data.analysisHighlighted || undefined}
      data-analysis-context-highlighted={
        data.analysisContextHighlighted || undefined
      }
      className={`${isParent ? 'h-full w-full rounded-xl border-2 border-dashed px-4 py-3' : 'min-w-48 rounded-2xl border px-4 py-3'} bg-[var(--editor-panel)] shadow-[var(--editor-node-shadow)] transition-all ${
        data.current
          ? 'border-amber-400 ring-4 ring-amber-300/30 shadow-[0_10px_36px_rgb(245_158_11/18%)] dark:ring-amber-400/20'
          : data.dropTarget
            ? 'border-violet-500 ring-4 ring-violet-400/35 shadow-[0_10px_36px_rgb(124_58_237/22%)] dark:border-violet-300 dark:ring-violet-300/30'
            : data.analysisHighlighted
              ? 'border-[var(--editor-analysis)] ring-4 ring-rose-500/15 shadow-[0_10px_32px_rgb(225_29_72/16%)] dark:ring-rose-400/20'
              : data.analysisContextHighlighted
                ? 'border-[var(--editor-analysis-context)] ring-2 ring-amber-400/10 dark:ring-amber-300/15'
                : selected
                  ? 'border-violet-500 ring-4 ring-violet-500/10 dark:border-violet-400 dark:ring-violet-400/20'
                  : data.unreachable
                    ? 'border-orange-300 dark:border-orange-500'
                    : data.final
                      ? 'border-emerald-300 dark:border-emerald-500'
                      : 'border-[var(--editor-border)]'
      }`}
    >
      {!data.simulating && (
        <Handle
          id={isParent ? 'parent-target' : undefined}
          type="target"
          position={Position.Left}
          isConnectableStart={false}
          style={isParent ? { top: '50%' } : undefined}
          className={
            isParent
              ? '!size-4 !border-2 !border-slate-500 !bg-[var(--editor-panel)] opacity-70 transition-opacity hover:opacity-100 dark:!border-slate-400'
              : '!size-2.5 !border-2 !border-[var(--editor-panel)] !bg-slate-500 dark:!bg-slate-400'
          }
        />
      )}
      <div className="flex items-center gap-2">
        {(data.initial || data.initialWithinParent) && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/15">
            <InitialStateMark
              label={
                data.initialWithinParent
                  ? 'Initial child state'
                  : 'Initial state'
              }
            />
          </span>
        )}
        {data.final && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
            <FinalStateMark />
          </span>
        )}
        {data.editing ? (
          <StateRenameInput
            value={data.label}
            onCommit={data.onCommitRename}
            onCancel={data.onCancelRename}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={(event) => {
              event.stopPropagation();
              data.onBeginRename();
            }}
            className="nodrag truncate font-mono text-[13px] font-semibold text-slate-800 dark:text-slate-100"
            title="Double-click to rename"
          >
            {data.label}
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        <span>
          {data.current
            ? 'Current'
            : data.unreachable
              ? 'Unreachable'
              : data.final
                ? 'Final state'
                : isParent
                  ? `${data.initial ? 'Initial parent state' : 'Parent state'} · ${data.childCount} ${data.childCount === 1 ? 'child' : 'children'}`
                  : data.initialWithinParent
                    ? 'Initial child state'
                    : data.initial
                      ? 'Initial state'
                      : 'State'}
        </span>
        {data.unreachable ? (
          <TriangleAlert className="size-3.5 text-orange-500 dark:text-orange-400" />
        ) : data.final ? (
          <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
        ) : null}
      </div>
      {!data.simulating && !data.final && (
        <Handle
          id={isParent ? 'parent-source' : undefined}
          type="source"
          position={Position.Right}
          isConnectableEnd={false}
          style={isParent ? { top: '50%' } : undefined}
          className={
            isParent
              ? '!size-4 !border-2 !border-[var(--editor-panel)] !bg-violet-500 opacity-80 transition-opacity hover:opacity-100 dark:!bg-violet-400'
              : '!size-2.5 !border-2 !border-[var(--editor-panel)] !bg-violet-500 dark:!bg-violet-400'
          }
        />
      )}
    </div>
  );
}

const nodeTypes = { state: StateNode };

function makeTransitionId() {
  return `transition-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeDuplicatedActionId() {
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseTags(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function errorMessages(error: unknown) {
  if (error instanceof MachineValidationError) return error.issues;
  if (error instanceof Error) return [error.message];
  return ['Something went wrong.'];
}

function machineContentHash(graph: GraphMachine) {
  return JSON.stringify({
    id: graph.id.trim(),
    initial: graph.initial,
    description: graph.description.trim(),
    tags: [...new Set(graph.tags)],
    meta: graph.meta,
    states: graph.states.map((state) => ({
      key: state.key,
      stateId: state.stateId,
      parentKey: state.parentKey,
      initialChild: state.initialChild,
      final: state.final,
      description: state.description.trim(),
      tags: [...new Set(state.tags)],
      meta: state.meta,
      entryActions: state.entryActions.map((action) => ({
        type: action.type.trim(),
        params: action.params,
      })),
      exitActions: state.exitActions.map((action) => ({
        type: action.type.trim(),
        params: action.params,
      })),
    })),
    transitions: graph.transitions.map((transition) => ({
      source: transition.source,
      target: transition.target,
      event: transition.event,
      actions: transition.actions.map((action) => ({
        type: action.type.trim(),
        params: action.params,
      })),
    })),
  });
}

function projectContentHash(
  graph: GraphMachine,
  viewport: EditorViewport,
  selection: EditorSelection | null,
) {
  return JSON.stringify({
    machine: machineContentHash(graph),
    nodes: graph.states.map((state) => ({
      key: state.key,
      position: state.position,
    })),
    viewport,
    selection,
  });
}

function serializeJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function downloadJsonFile(value: unknown, fileName: string) {
  const blob = new Blob([serializeJson(value)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function writeJsonFile(handle: FileSystemFileHandle, value: unknown) {
  const writable = await handle.createWritable();
  await writable.write(serializeJson(value));
  await writable.close();
}

function isPickerCancel(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function machineFileName(machineId: string, suffix: string) {
  const safeId = (machineId || 'machine').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${safeId}${suffix}`;
}

function CommitInput({
  value,
  onCommit,
  className = '',
  ariaLabel,
  disabled = false,
  suggestions = [],
}: {
  value: string;
  onCommit: (value: string) => string | void;
  className?: string;
  ariaLabel: string;
  disabled?: boolean;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState(value);
  const cancelCommit = useRef(false);
  const generatedId = useId();
  const listId = suggestions.length ? `suggestions-${generatedId}` : undefined;

  const commit = () => {
    if (cancelCommit.current) {
      cancelCommit.current = false;
      return;
    }
    const committedValue = onCommit(draft);
    if (typeof committedValue === 'string') setDraft(committedValue);
  };

  return (
    <>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelCommit.current = true;
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        list={listId}
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion}>
              {suggestion}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}

function CommitTextarea({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const cancelCommit = useRef(false);

  return (
    <Textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelCommit.current) {
          cancelCommit.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          cancelCommit.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}

function JsonEditor({
  value,
  onCommit,
  onError,
}: {
  value: JsonValue | undefined;
  onCommit: (value: JsonValue | undefined) => void;
  onError: (message: string) => void;
}) {
  const formatted = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(formatted);

  const commit = () => {
    if (!draft.trim()) {
      onCommit(undefined);
      return;
    }
    try {
      onCommit(JSON.parse(draft) as JsonValue);
    } catch {
      onError('Meta must be valid JSON.');
    }
  };

  return (
    <Textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      spellCheck={false}
      placeholder={'{\n  "key": "value"\n}'}
      className="min-h-20 resize-y font-mono text-[11px] leading-5"
      aria-label="Meta JSON"
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
      {children}
    </span>
  );
}

function EditorSurface() {
  const flow = useReactFlow<StateFlowNode, TransitionBundleEdge>();
  const fileInput = useRef<HTMLInputElement>(null);
  const projectFileHandle = useRef<FileSystemFileHandle | null>(null);
  const transitionInput = useRef<HTMLInputElement>(null);
  const recoveryReady = useRef(false);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const {
    value: graph,
    change: setGraph,
    changeTransient: setGraphTransient,
    beginTransaction: beginGraphTransaction,
    commitTransaction: commitGraphTransaction,
    reset: resetGraph,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoableState<GraphMachine>(createEmptyGraph);
  const [selection, setSelection] = useState<EditorSelection | null>({
    kind: 'machine',
    id: 'machine',
  });
  const [selectedStateKeys, setSelectedStateKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedTransitionIds, setSelectedTransitionIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedActionIds, setExpandedActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [rightPanelMode, setRightPanelMode] = useState<
    'properties' | 'analysis'
  >('properties');
  const [analysisView, setAnalysisView] = useState<AnalysisView>('paths');
  const [stateDirection, setStateDirection] =
    useState<StateDirection>('incoming');
  const [analysisHighlight, setAnalysisHighlight] = useState<{
    kind: 'path' | 'node' | 'cycle';
    key: string;
    states: string[];
    routes: string[];
    contextStates?: string[];
    contextRoutes?: string[];
  } | null>(null);
  const [nodeRuntimeById, setNodeRuntimeById] = useState<
    Map<string, StateFlowNodeRuntime>
  >(() => new Map());
  const pendingNodeDeletionEdgeIds = useRef<Set<string>>(new Set());
  const [renamingState, setRenamingState] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(
    null,
  );
  const [transitionEvent, setTransitionEvent] = useState('');
  const [minimapVisible, setMinimapVisible] = useState(() => {
    try {
      return readMinimapVisibility(localStorage);
    } catch {
      return false;
    }
  });
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState('Ready');
  const [simulationState, setSimulationState] = useState<string | null>(null);
  const [viewport, setViewportState] = useState<EditorViewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [lastProjectFileHash, setLastProjectFileHash] = useState<string | null>(
    null,
  );
  const [activeProjectFileName, setActiveProjectFileName] = useState<
    string | null
  >(null);
  const [projectFileConnected, setProjectFileConnected] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newMachineName, setNewMachineName] = useState('');
  const [newInitialStateName, setNewInitialStateName] = useState('idle');
  const [createDialogError, setCreateDialogError] = useState<string | null>(
    null,
  );
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupInitialChild, setGroupInitialChild] = useState('');
  const [groupDialogError, setGroupDialogError] = useState<string | null>(null);
  const [dropTargetParentKey, setDropTargetParentKey] = useState<string | null>(
    null,
  );
  const simulating = simulationState !== null;
  const machineCreated = graph.id.trim().length > 0;
  const machineReady = machineCreated && graph.states.length > 0;
  const reachableStateKeys = useMemo(
    () => getHierarchyReachableStateKeys(graph),
    [graph],
  );
  const actionNameSuggestions = useMemo(
    () =>
      [
        ...graph.states.flatMap((state) => [
          ...state.entryActions.map((action) => action.type.trim()),
          ...state.exitActions.map((action) => action.type.trim()),
        ]),
        ...graph.transitions.flatMap((transition) =>
          transition.actions.map((action) => action.type.trim()),
        ),
      ]
        .filter(Boolean)
        .filter((name, index, names) => names.indexOf(name) === index)
        .sort((a, b) => a.localeCompare(b)),
    [graph.states, graph.transitions],
  );
  const actionParameterSuggestions = useMemo(
    () =>
      [
        ...graph.states.flatMap((state) => [
          ...state.entryActions,
          ...state.exitActions,
        ]),
        ...graph.transitions.flatMap((transition) => transition.actions),
      ]
        .flatMap((action) => Object.keys(action.params ?? {}))
        .filter((name, index, names) => names.indexOf(name) === index)
        .sort((a, b) => a.localeCompare(b)),
    [graph.states, graph.transitions],
  );
  const eventNameSuggestions = useMemo(
    () =>
      graph.transitions
        .map((transition) => transition.event.trim())
        .filter(Boolean)
        .filter((name, index, names) => names.indexOf(name) === index)
        .sort((a, b) => a.localeCompare(b)),
    [graph.transitions],
  );
  const currentProjectHash = useMemo(
    () => projectContentHash(graph, viewport, selection),
    [graph, selection, viewport],
  );

  const selectEditorItem = useCallback((next: EditorSelection | null) => {
    setSelection(next);
    setSelectedStateKeys(
      next?.kind === 'state' ? new Set([next.id]) : new Set(),
    );
    setSelectedTransitionIds(
      next?.kind === 'transition' ? new Set([next.id]) : new Set(),
    );
  }, []);

  const setActionExpanded = useCallback((id: string, expanded: boolean) => {
    setExpandedActionIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo =
        (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
      if (wantsUndo && canUndo && !simulating) {
        event.preventDefault();
        undo();
      } else if (wantsRedo && canRedo && !simulating) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [canRedo, canUndo, redo, simulating, undo]);

  useEffect(() => {
    if (pendingConnection) transitionInput.current?.focus();
  }, [pendingConnection]);

  const showIssues = useCallback((messages: string[]) => {
    setIssues([...new Set(messages)]);
    setNotice('Needs attention');
  }, []);

  const clearFeedback = useCallback((message = 'Ready') => {
    setIssues([]);
    setNotice(message);
  }, []);

  const renameMachine = (requestedId: string) => {
    const id = requestedId.trim();
    if (!id) {
      showIssues(['Machine name cannot be empty.']);
      return graph.id;
    }
    if (id === graph.id) return id;

    setGraph((current) => ({ ...current, id, hasExplicitId: true }));
    clearFeedback('Machine renamed');
    return id;
  };

  useEffect(() => {
    if (notice === 'Ready' || issues.length > 0) return;

    const timeout = window.setTimeout(() => setNotice('Ready'), 4000);
    return () => window.clearTimeout(timeout);
  }, [issues.length, notice]);

  useEffect(() => {
    if (recoveryReady.current) return;

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const recovered = editorProjectToGraph(JSON.parse(saved));
        const frame = requestAnimationFrame(() => {
          resetGraph(recovered.graph);
          selectEditorItem(recovered.selection);
          setViewportState(recovered.viewport);
          void flow.setViewport(recovered.viewport, { duration: 0 });
          setActiveProjectFileName(
            localStorage.getItem(RECOVERY_FILE_NAME_KEY),
          );
          recoveryReady.current = true;
          setRecoveryComplete(true);
          void recallProjectFileHandle()
            .then(async (handle) => {
              if (!handle) return;
              projectFileHandle.current = handle;
              setActiveProjectFileName(handle.name);
              setProjectFileConnected(await hasWritePermission(handle, false));
            })
            .catch(() => undefined);
        });
        return () => cancelAnimationFrame(frame);
      } catch {
        // A corrupt recovery copy should never block creating or opening a file.
      }
    }
    const frame = requestAnimationFrame(() => {
      recoveryReady.current = true;
      setRecoveryComplete(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, resetGraph, selectEditorItem]);

  const persistRecovery = useCallback(() => {
    if (!recoveryReady.current || !machineReady) return;
    try {
      const recovery = createEditorProject(graph, viewport, selection);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recovery));
      if (activeProjectFileName) {
        localStorage.setItem(RECOVERY_FILE_NAME_KEY, activeProjectFileName);
      } else {
        localStorage.removeItem(RECOVERY_FILE_NAME_KEY);
      }
    } catch {
      // Recovery is intentionally silent and never replaces an explicit file save.
    }
  }, [activeProjectFileName, graph, machineReady, selection, viewport]);

  useEffect(() => {
    if (!recoveryReady.current) return;

    if (!machineReady) {
      if (machineCreated) localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const timeout = window.setTimeout(persistRecovery, 300);

    return () => window.clearTimeout(timeout);
  }, [machineCreated, machineReady, persistRecovery]);

  useEffect(() => {
    const flushWhenLeaving = () => persistRecovery();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistRecovery();
    };
    window.addEventListener('pagehide', flushWhenLeaving);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushWhenLeaving);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [persistRecovery]);

  const renameState = useCallback(
    (oldKey: string, requestedKey: string) => {
      const nextKey = requestedKey.trim();
      if (!nextKey) {
        showIssues(['State keys cannot be empty.']);
        return;
      }
      if (
        nextKey !== oldKey &&
        graph.states.some((state) => state.key === nextKey)
      ) {
        showIssues([`A state named ${nextKey} already exists.`]);
        return;
      }
      if (nextKey === oldKey) {
        setRenamingState(null);
        return;
      }
      setGraph((current) => ({
        ...current,
        initial: current.initial === oldKey ? nextKey : current.initial,
        states: current.states.map((state) =>
          state.key === oldKey
            ? { ...state, key: nextKey }
            : {
                ...state,
                parentKey:
                  state.parentKey === oldKey ? nextKey : state.parentKey,
                initialChild:
                  state.initialChild === oldKey ? nextKey : state.initialChild,
              },
        ),
        transitions: current.transitions.map((transition) => ({
          ...transition,
          source: transition.source === oldKey ? nextKey : transition.source,
          target: transition.target === oldKey ? nextKey : transition.target,
        })),
      }));
      selectEditorItem({ kind: 'state', id: nextKey });
      setRenamingState(null);
      clearFeedback('State renamed');
    },
    [clearFeedback, graph, selectEditorItem, setGraph, showIssues],
  );

  const analysisHighlightedStateKeys = useMemo(
    () => new Set(analysisHighlight?.states ?? []),
    [analysisHighlight],
  );
  const analysisHighlightedRouteKeys = useMemo(
    () => new Set(analysisHighlight?.routes ?? []),
    [analysisHighlight],
  );
  const analysisContextStateKeys = useMemo(
    () => new Set(analysisHighlight?.contextStates ?? []),
    [analysisHighlight],
  );
  const analysisContextRouteKeys = useMemo(
    () => new Set(analysisHighlight?.contextRoutes ?? []),
    [analysisHighlight],
  );

  const hierarchyLayout = useMemo(
    () =>
      getHierarchyLayout(
        graph,
        new Map(
          [...nodeRuntimeById].map(([key, runtime]) => [
            key,
            runtime.measured ?? {},
          ]),
        ),
      ),
    [graph, nodeRuntimeById],
  );
  const frameDepth = Math.max(
    0,
    ...graph.states
      .filter((state) => getStateChildren(graph, state.key).length > 0)
      .map((state) => hierarchyLayout.get(state.key)?.depth ?? 0),
  );

  const nodes = useMemo<StateFlowNode[]>(
    () =>
      [...hierarchyLayout.keys()].map((key) => {
        const state = getState(graph, key)!;
        const geometry = hierarchyLayout.get(key)!;
        const runtime = nodeRuntimeById.get(state.key);
        const children = getStateChildren(graph, state.key);
        const isParent = children.length > 0;
        const frameWidth = isParent ? geometry.width : undefined;
        const frameHeight = isParent ? geometry.height : undefined;
        return {
          ...runtime,
          id: state.key,
          type: 'state',
          position: state.position,
          ...(state.parentKey
            ? { parentId: state.parentKey, extent: 'parent' as const }
            : {}),
          ...(isParent
            ? { style: { width: frameWidth, height: frameHeight } }
            : {}),
          zIndex: isParent ? geometry.depth : frameDepth + 10,
          selected: selectedStateKeys.has(state.key),
          draggable: !simulating,
          deletable: !simulating,
          data: {
            label: state.key,
            initial: graph.initial === state.key,
            initialWithinParent: Boolean(
              state.parentKey &&
              graph.states.find(
                (candidate) => candidate.key === state.parentKey,
              )?.initialChild === state.key,
            ),
            final: state.final,
            unreachable: !reachableStateKeys.has(state.key),
            current: simulationState === state.key,
            editing: renamingState === state.key,
            simulating,
            analysisHighlighted: analysisHighlightedStateKeys.has(state.key),
            analysisContextHighlighted: analysisContextStateKeys.has(state.key),
            isParent,
            childCount: children.length,
            dropTarget: dropTargetParentKey === state.key,
            onBeginRename: () => !simulating && setRenamingState(state.key),
            onCommitRename: (value: string) => renameState(state.key, value),
            onCancelRename: () => setRenamingState(null),
          },
        };
      }),
    [
      graph,
      analysisHighlightedStateKeys,
      analysisContextStateKeys,
      nodeRuntimeById,
      hierarchyLayout,
      frameDepth,
      renameState,
      renamingState,
      reachableStateKeys,
      selectedStateKeys,
      simulating,
      simulationState,
      dropTargetParentKey,
    ],
  );

  const transitionRoutes = useMemo(
    () => createTransitionRoutes(graph.transitions),
    [graph.transitions],
  );
  const machineAnalysis = useMemo(() => analyzeMachine(graph), [graph]);

  const edges = useMemo<TransitionBundleEdge[]>(() => {
    if (simulating) return [];
    return transitionRoutes.map((route) => {
      const selected = route.transitions.some((transition) =>
        selectedTransitionIds.has(transition.id),
      );
      const analysisHighlighted = analysisHighlightedRouteKeys.has(
        `${route.source}\u0000${route.target}`,
      );
      const analysisContextHighlighted = analysisContextRouteKeys.has(
        `${route.source}\u0000${route.target}`,
      );
      const emphasized =
        selected || analysisHighlighted || analysisContextHighlighted;
      const emphasisColor = analysisHighlighted
        ? 'var(--editor-analysis)'
        : analysisContextHighlighted
          ? 'var(--editor-analysis-context)'
          : 'var(--editor-edge-active)';
      return {
        id: route.id,
        source: route.source,
        target: route.target,
        type: 'transitionBundle',
        selected,
        animated: false,
        deletable: true,
        selectable: true,
        zIndex:
          frameDepth +
          (analysisHighlighted
            ? 7
            : analysisContextHighlighted
              ? 6
              : selected
                ? 5
                : 4),
        data: {
          sourceLabel: route.source,
          targetLabel: route.target,
          sourceIsParent: getStateChildren(graph, route.source).length > 0,
          targetIsParent: getStateChildren(graph, route.target).length > 0,
          laneOffset: route.laneOffset,
          reciprocal: route.reciprocal,
          analysisHighlighted,
          analysisContextHighlighted,
          transitions: route.transitions.map((transition) => ({
            id: transition.id,
            event: transition.event,
            selected: selectedTransitionIds.has(transition.id),
          })),
          onSelectTransition: (transitionId) =>
            selectEditorItem({ kind: 'transition', id: transitionId }),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: emphasized ? emphasisColor : 'var(--editor-edge)',
          width: emphasized ? 24 : 20,
          height: emphasized ? 24 : 20,
        },
        style: {
          strokeWidth: selected
            ? 3.2
            : analysisHighlighted
              ? 2.8
              : analysisContextHighlighted
                ? 2.2
                : 1.7,
          stroke: emphasized ? emphasisColor : 'var(--editor-edge)',
          filter: analysisHighlighted
            ? 'var(--editor-analysis-glow)'
            : analysisContextHighlighted
              ? 'var(--editor-analysis-context-glow)'
              : selected
                ? 'var(--editor-edge-glow)'
                : undefined,
        },
      };
    });
  }, [
    analysisHighlightedRouteKeys,
    analysisContextRouteKeys,
    selectEditorItem,
    selectedTransitionIds,
    simulating,
    transitionRoutes,
    graph,
    frameDepth,
  ]);

  const removeStates = useCallback(
    (keys: string[]) => {
      if (simulating || keys.length === 0) return;
      const includesParent = getSelectionRoots(graph, keys).some(
        (key) => getStateChildren(graph, key).length > 0,
      );
      setGraph((current) => removeHierarchyStates(current, keys));
      selectEditorItem({ kind: 'machine', id: 'machine' });
      clearFeedback(
        includesParent
          ? 'Parent state removed; children kept'
          : keys.length === 1
            ? 'State deleted'
            : 'States deleted',
      );
    },
    [clearFeedback, graph, selectEditorItem, setGraph, simulating],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<StateFlowNode>[]) => {
      if (simulating) return;
      const nextNodes = applyNodeChanges(changes, nodes);
      setNodeRuntimeById(
        new Map(
          nextNodes.map((node) => [
            node.id,
            {
              measured: node.measured,
              width: node.width,
              height: node.height,
              dragging: node.dragging,
              resizing: node.resizing,
            },
          ]),
        ),
      );
      const removed: string[] = [];
      const positions = new Map<string, { x: number; y: number }>();
      for (const change of changes) {
        if (change.type === 'remove') removed.push(change.id);
        if (change.type === 'position' && change.position) {
          positions.set(change.id, change.position);
        }
      }
      const selectionChanged = changes.some(
        (change) => change.type === 'select',
      );
      if (selectionChanged) {
        const nextSelectedStateKeys = new Set(
          // A selected frame represents its subtree, not a mixed-scope selection.
          getSelectionRoots(
            graph,
            nextNodes.filter((node) => node.selected).map((node) => node.id),
          ),
        );
        const mostRecentlySelected = changes.findLast(
          (change) => change.type === 'select' && change.selected,
        );
        setSelectedStateKeys(nextSelectedStateKeys);
        setSelection((current) => {
          if (
            mostRecentlySelected?.type === 'select' &&
            nextSelectedStateKeys.has(mostRecentlySelected.id)
          ) {
            return { kind: 'state', id: mostRecentlySelected.id };
          }
          if (
            current?.kind !== 'state' ||
            !nextSelectedStateKeys.has(current.id)
          ) {
            const fallback = [...nextSelectedStateKeys].at(-1);
            return fallback
              ? { kind: 'state', id: fallback }
              : { kind: 'machine', id: 'machine' };
          }
          return current;
        });
      }
      if (removed.length) removeStates(removed);
      if (positions.size) {
        setGraphTransient((current) => ({
          ...current,
          states: current.states.map((state) =>
            positions.has(state.key)
              ? { ...state, position: { ...positions.get(state.key)! } }
              : state,
          ),
        }));
      }
    },
    [graph, nodes, removeStates, setGraphTransient, simulating],
  );

  const removeTransitions = useCallback(
    (ids: string[]) => {
      if (simulating || ids.length === 0) return;
      const idSet = new Set(ids);
      setGraph((current) => ({
        ...current,
        transitions: current.transitions.filter(
          (transition) => !idSet.has(transition.id),
        ),
      }));
      selectEditorItem({ kind: 'machine', id: 'machine' });
      clearFeedback(
        ids.length === 1 ? 'Transition deleted' : 'Transitions deleted',
      );
    },
    [clearFeedback, selectEditorItem, setGraph, simulating],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<TransitionBundleEdge>[]) => {
      if (simulating) return;
      const removed: string[] = [];
      for (const change of changes) {
        if (change.type !== 'remove') continue;
        if (pendingNodeDeletionEdgeIds.current.has(change.id)) {
          pendingNodeDeletionEdgeIds.current.delete(change.id);
          continue;
        }
        const route = edges.find((edge) => edge.id === change.id);
        const routeTransitions = route?.data?.transitions ?? [];
        const selectedId =
          selection?.kind === 'transition' &&
          routeTransitions.some(({ id }) => id === selection.id)
            ? selection.id
            : routeTransitions.length === 1
              ? routeTransitions[0].id
              : null;
        if (selectedId) removed.push(selectedId);
        else if (routeTransitions.length > 1) {
          showIssues(['Choose an event label before deleting this route.']);
        }
      }
      if (removed.length) removeTransitions(removed);
    },
    [edges, removeTransitions, selection, showIssues, simulating],
  );

  const addStateAt = useCallback(
    (position: { x: number; y: number }, parentKey?: string) => {
      if (simulating) return;
      let index = graph.states.length + 1;
      let key = `state${index}`;
      while (graph.states.some((state) => state.key === key)) {
        index += 1;
        key = `state${index}`;
      }
      const state: GraphState = {
        key,
        position,
        final: false,
        description: '',
        tags: [],
        entryActions: [],
        exitActions: [],
      };
      setGraph((current) => {
        const next = {
          ...current,
          initial: current.states.length === 0 ? key : current.initial,
          states: [...current.states, state],
        };
        return parentKey ? reparentState(next, key, parentKey) : next;
      });
      selectEditorItem({ kind: 'state', id: key });
      setRenamingState(key);
      clearFeedback('State created');
    },
    [clearFeedback, graph.states, selectEditorItem, setGraph, simulating],
  );

  const addStateNearCenter = () => {
    const point = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    addStateAt(point);
  };

  const commitConnection = () => {
    if (!pendingConnection?.source || !pendingConnection.target) return;
    const name = transitionEvent.trim();
    if (!name) {
      showIssues(['Give the transition an event name.']);
      return;
    }
    if (
      graph.transitions.some(
        (transition) =>
          transition.source === pendingConnection.source &&
          transition.event === name,
      )
    ) {
      showIssues([
        `State ${pendingConnection.source} already has a transition for ${name}.`,
      ]);
      return;
    }
    const id = makeTransitionId();
    const transition: GraphTransition = {
      id,
      source: pendingConnection.source,
      target: pendingConnection.target,
      event: name,
      actions: [],
    };
    setGraph((current) => ({
      ...current,
      transitions: [...current.transitions, transition],
    }));
    selectEditorItem({ kind: 'transition', id });
    setPendingConnection(null);
    setTransitionEvent('');
    clearFeedback('Transition created');
  };

  const setInitial = (key: string) => {
    const state = graph.states.find((candidate) => candidate.key === key);
    if (!state) return;
    setGraph((current) => {
      const selected = current.states.find(
        (candidate) => candidate.key === key,
      );
      if (!selected) return current;
      if (selected.parentKey === undefined) {
        return current.initial === key ? current : { ...current, initial: key };
      }
      const parent = current.states.find(
        (candidate) => candidate.key === selected.parentKey,
      );
      if (!parent || parent.initialChild === key) return current;
      return {
        ...current,
        states: current.states.map((candidate) =>
          candidate.key === parent.key
            ? { ...candidate, initialChild: key }
            : candidate,
        ),
      };
    });
    clearFeedback(
      state.parentKey === undefined
        ? `${key} is now the machine's initial state`
        : `${key} is now the initial child of ${state.parentKey}`,
    );
  };

  const toggleFinal = (key: string) => {
    const state = graph.states.find((candidate) => candidate.key === key);
    if (!state) return;
    if (!state.final && getStateChildren(graph, key).length > 0) {
      showIssues([
        'Parent states cannot be final. Mark a child state final instead.',
      ]);
      return;
    }
    if (
      !state.final &&
      graph.transitions.some((transition) => transition.source === key)
    ) {
      showIssues([
        'Delete this state’s outgoing transitions before marking it final.',
      ]);
      return;
    }
    if (!state.final && state.exitActions.length > 0) {
      showIssues(['Remove this state’s exit actions before marking it final.']);
      return;
    }
    setGraph((current) => ({
      ...current,
      states: current.states.map((candidate) =>
        candidate.key === key
          ? { ...candidate, final: !candidate.final }
          : candidate,
      ),
    }));
    clearFeedback(state.final ? 'Final marker removed' : 'State marked final');
  };

  const updateState = (key: string, patch: Partial<GraphState>) => {
    setGraph((current) => ({
      ...current,
      states: current.states.map((state) =>
        state.key === key ? { ...state, ...patch } : state,
      ),
    }));
  };

  const removeFromParent = useCallback(
    (key: string) => {
      const child = getState(graph, key);
      if (!child?.parentKey || simulating) return;
      const parent = getState(graph, child.parentKey);
      if (!parent) return;
      setGraph((current) => reparentState(current, key, parent.parentKey));
      clearFeedback(`${key} removed from ${parent.key}`);
    },
    [clearFeedback, graph, setGraph, simulating],
  );

  const duplicateState = (key: string) => {
    const source = graph.states.find((state) => state.key === key);
    if (!source || simulating) return;
    if (getStateChildren(graph, key).length > 0) {
      showIssues([
        'Duplicate the child states individually before creating another parent.',
      ]);
      return;
    }

    const baseKey = `${source.key}Copy`;
    let nextKey = baseKey;
    let suffix = 2;
    while (graph.states.some((state) => state.key === nextKey)) {
      nextKey = `${baseKey}${suffix}`;
      suffix += 1;
    }

    const duplicateAction = (action: GraphAction): GraphAction => ({
      ...structuredClone(action),
      id: makeDuplicatedActionId(),
    });
    const duplicate: GraphState = {
      ...structuredClone(source),
      key: nextKey,
      ...(source.stateId ? { stateId: nextKey } : {}),
      position: {
        x: source.position.x + 48,
        y: source.position.y + 48,
      },
      entryActions: source.entryActions.map(duplicateAction),
      exitActions: source.exitActions.map(duplicateAction),
    };

    setGraph((current) => ({
      ...current,
      states: [...current.states, duplicate],
    }));
    selectEditorItem({ kind: 'state', id: nextKey });
    clearFeedback(`Duplicated ${source.key}`);
  };

  const updateTransitionEvent = (id: string, nextEvent: string) => {
    const eventName = nextEvent.trim();
    const transition = graph.transitions.find(
      (candidate) => candidate.id === id,
    );
    if (!transition || eventName === transition.event) return;
    if (!eventName) {
      showIssues(['Event names cannot be empty.']);
      return;
    }
    if (
      graph.transitions.some(
        (candidate) =>
          candidate.id !== id &&
          candidate.source === transition.source &&
          candidate.event === eventName,
      )
    ) {
      showIssues([
        `State ${transition.source} already has a transition for ${eventName}.`,
      ]);
      return;
    }
    setGraph((current) => ({
      ...current,
      transitions: current.transitions.map((candidate) =>
        candidate.id === id ? { ...candidate, event: eventName } : candidate,
      ),
    }));
    clearFeedback('Transition updated');
  };

  const updateTransitionActions = (id: string, actions: GraphAction[]) => {
    setGraph((current) => ({
      ...current,
      transitions: current.transitions.map((transition) =>
        transition.id === id ? { ...transition, actions } : transition,
      ),
    }));
  };

  const applyLoadedProject = useCallback(
    (project: LoadedEditorProject, message: string) => {
      const nextSelection = project.selection ?? {
        kind: 'machine' as const,
        id: 'machine' as const,
      };
      resetGraph(project.graph);
      selectEditorItem(nextSelection);
      setViewportState(project.viewport);
      setLastProjectFileHash(
        projectContentHash(project.graph, project.viewport, nextSelection),
      );
      setSimulationState(null);
      setRenamingState(null);
      requestAnimationFrame(() =>
        flow.setViewport(project.viewport, { duration: 250 }),
      );
      clearFeedback(message);
    },
    [clearFeedback, flow, resetGraph, selectEditorItem],
  );

  const openCreateDialog = useCallback(() => {
    setNewMachineName('');
    setNewInitialStateName('idle');
    setCreateDialogError(null);
    setCreateDialogOpen(true);
  }, []);

  const openGroupDialog = useCallback(() => {
    const candidates = graph.states.filter((state) =>
      selectedStateKeys.has(state.key),
    );
    const parentKey = candidates[0]?.parentKey;
    const initial =
      parentKey === undefined
        ? graph.initial
        : getState(graph, parentKey)?.initialChild;
    setGroupName('');
    setGroupInitialChild(
      candidates.find((state) => state.key === initial)?.key ??
        candidates[0]?.key ??
        '',
    );
    setGroupDialogError(null);
    setGroupDialogOpen(true);
  }, [graph, selectedStateKeys]);

  const groupSelectedStates = (
    event: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const name = groupName.trim();
    try {
      const next = groupStates(
        graph,
        [...selectedStateKeys],
        name,
        groupInitialChild,
      );
      setGraph(next);
      setGroupDialogOpen(false);
      selectEditorItem({ kind: 'state', id: name });
      clearFeedback(`Grouped ${selectedStateKeys.size} states under ${name}`);
    } catch (error) {
      setGroupDialogError(
        error instanceof Error ? error.message : 'Could not create the parent.',
      );
    }
  };

  const requestNewMachine = () => {
    const hasUnsavedWork =
      (machineCreated || graph.states.length > 0) &&
      lastProjectFileHash !== currentProjectHash;
    if (
      hasUnsavedWork &&
      !window.confirm(
        'Create a new machine? Save the current project first if you want to keep it.',
      )
    ) {
      return;
    }
    openCreateDialog();
  };

  const createMachineFromDialog = (
    event: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const machineName = newMachineName.trim();
    const initialStateName = newInitialStateName.trim();
    if (!machineName) {
      setCreateDialogError('Give the machine a name.');
      return;
    }
    if (!initialStateName) {
      setCreateDialogError('Give the initial state a name.');
      return;
    }

    const blankViewport = { x: 0, y: 0, zoom: 1 };
    const initialState: GraphState = {
      key: initialStateName,
      description: '',
      tags: [],
      final: false,
      entryActions: [],
      exitActions: [],
      position: flow.screenToFlowPosition({
        x: Math.max(180, (window.innerWidth - 320) / 2),
        y: window.innerHeight / 2,
      }),
    };
    resetGraph({
      ...createEmptyGraph(),
      id: machineName,
      hasExplicitId: true,
      initial: initialStateName,
      states: [initialState],
    });
    selectEditorItem({ kind: 'state', id: initialStateName });
    setViewportState(blankViewport);
    setLastProjectFileHash(null);
    projectFileHandle.current = null;
    setActiveProjectFileName(null);
    setProjectFileConnected(false);
    localStorage.removeItem(RECOVERY_FILE_NAME_KEY);
    void forgetProjectFileHandle().catch(() => undefined);
    setSimulationState(null);
    setRenamingState(null);
    setCreateDialogOpen(false);
    requestAnimationFrame(() => flow.fitView({ padding: 0.35, duration: 250 }));
    clearFeedback(
      `Machine ${machineName} created with initial state ${initialStateName}`,
    );
  };

  const saveProjectFile = async (saveAs: boolean) => {
    if (!machineCreated) {
      openCreateDialog();
      return;
    }
    try {
      const project = createEditorProject(graph, viewport, selection);
      const suggestedName = machineFileName(graph.id, '.se.json');
      const pickerWindow = window as FilePickerWindow;
      let handle = saveAs ? null : projectFileHandle.current;

      if (handle && !(await hasWritePermission(handle, true))) {
        handle = null;
        projectFileHandle.current = null;
        setProjectFileConnected(false);
      }

      if (!handle && pickerWindow.showSaveFilePicker) {
        handle = await pickerWindow.showSaveFilePicker({
          suggestedName,
          types: PROJECT_FILE_TYPES,
        });
      }

      if (handle) {
        await writeJsonFile(handle, project);
        projectFileHandle.current = handle;
        setActiveProjectFileName(handle.name);
        setProjectFileConnected(true);
        void rememberProjectFileHandle(handle).catch(() => undefined);
        clearFeedback(
          saveAs ? `Saved as ${handle.name}` : `Saved ${handle.name}`,
        );
      } else {
        downloadJsonFile(project, suggestedName);
        clearFeedback(`Downloaded ${suggestedName}`);
      }
      setLastProjectFileHash(currentProjectHash);
    } catch (error) {
      if (isPickerCancel(error)) return;
      showIssues(errorMessages(error));
    }
  };

  const exportMachineJson = async () => {
    if (!machineCreated) {
      openCreateDialog();
      return;
    }
    try {
      const machine = graphToMachineJSON(graph);
      const suggestedName = machineFileName(machine.id ?? '', '.json');
      const pickerWindow = window as FilePickerWindow;
      let handle: FileSystemFileHandle | null = null;

      if (pickerWindow.showSaveFilePicker) {
        handle = await pickerWindow.showSaveFilePicker({
          suggestedName,
          types: MACHINE_JSON_FILE_TYPES,
        });
      }

      if (handle) {
        await writeJsonFile(handle, machine);
        clearFeedback(`Exported ${handle.name}`);
      } else {
        downloadJsonFile(machine, suggestedName);
        clearFeedback(`Exported ${suggestedName}`);
      }
    } catch (error) {
      if (isPickerCancel(error)) return;
      showIssues(errorMessages(error));
    }
  };

  const createInitialState = () => {
    if (!machineCreated) {
      openCreateDialog();
      return;
    }
    addStateNearCenter();
  };

  const openEditorFile = async (
    file: File,
    fileHandle: FileSystemFileHandle | null = null,
  ) => {
    try {
      const opened = editorFileToGraph(JSON.parse(await file.text()));
      const hasUnsavedWork =
        (machineCreated || graph.states.length > 0) &&
        lastProjectFileHash !== currentProjectHash;
      if (
        hasUnsavedWork &&
        !window.confirm(
          'Open this file? Save the current project first if you want to keep it.',
        )
      ) {
        return;
      }

      if (opened.kind === 'project') {
        projectFileHandle.current = fileHandle;
        setActiveProjectFileName(file.name);
        setProjectFileConnected(Boolean(fileHandle));
        if (fileHandle) {
          void rememberProjectFileHandle(fileHandle).catch(() => undefined);
        } else {
          void forgetProjectFileHandle().catch(() => undefined);
        }
        applyLoadedProject(opened, `Opened ${file.name}`);
      } else {
        projectFileHandle.current = null;
        setActiveProjectFileName(null);
        setProjectFileConnected(false);
        localStorage.removeItem(RECOVERY_FILE_NAME_KEY);
        void forgetProjectFileHandle().catch(() => undefined);
        resetGraph(opened.graph);
        selectEditorItem(opened.selection);
        setViewportState(opened.viewport);
        setLastProjectFileHash(null);
        setSimulationState(null);
        setRenamingState(null);
        requestAnimationFrame(() =>
          flow.fitView({ padding: 0.25, duration: 300 }),
        );
        clearFeedback(`Imported ${file.name}`);
      }
    } catch (error) {
      showIssues(errorMessages(error));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openFilePicker = async () => {
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showOpenFilePicker) {
      fileInput.current?.click();
      return;
    }

    try {
      const [handle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: EDITOR_FILE_TYPES,
      });
      if (handle) await openEditorFile(await handle.getFile(), handle);
    } catch (error) {
      if (isPickerCancel(error)) return;
      showIssues(errorMessages(error));
    }
  };

  const startSimulation = () => {
    const validationIssues = validateGraph(graph);
    if (validationIssues.length) {
      showIssues(validationIssues);
      return;
    }
    const initialLeaf = getInitialLeafState(graph, graph.initial);
    setSimulationState(initialLeaf);
    selectEditorItem({ kind: 'state', id: initialLeaf });
    clearFeedback('Simulation running');
  };

  const stopSimulation = () => {
    setSimulationState(null);
    clearFeedback('Simulation stopped');
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = !root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  };

  const toggleMinimap = () => {
    setMinimapVisible((visible) => {
      const nextVisible = !visible;
      try {
        writeMinimapVisibility(localStorage, nextVisible);
      } catch {
        // The control should still work when browser storage is unavailable.
      }
      return nextVisible;
    });
  };

  const groupingUnavailableReason = getGroupingIssue(graph, [
    ...selectedStateKeys,
  ]);
  const groupScopeKey = graph.states.find((state) =>
    selectedStateKeys.has(state.key),
  )?.parentKey;
  const groupScopeInitial =
    groupScopeKey === undefined
      ? graph.initial
      : getState(graph, groupScopeKey)?.initialChild;

  const dropParentFor = (node: StateFlowNode) => {
    if (simulating || selectedStateKeys.size > 1) return undefined;
    const origin = node.parentId
      ? hierarchyLayout.get(node.parentId)
      : undefined;
    const bounds = {
      x: node.position.x + (origin?.x ?? 0),
      y: node.position.y + (origin?.y ?? 0),
      width: node.measured?.width ?? hierarchyLayout.get(node.id)?.width ?? 208,
      height:
        node.measured?.height ?? hierarchyLayout.get(node.id)?.height ?? 108,
    };
    return findContainingParent(graph, hierarchyLayout, bounds, node.id);
  };

  const selectedState =
    selection?.kind === 'state'
      ? graph.states.find((state) => state.key === selection.id)
      : undefined;
  const selectedTransition =
    selection?.kind === 'transition'
      ? graph.transitions.find((transition) => transition.id === selection.id)
      : undefined;
  const currentState = graph.states.find(
    (state) => state.key === simulationState,
  );
  const availableTransitions = simulationState
    ? getEffectiveTransitions(graph, simulationState)
    : [];
  const routeKeyFor = useCallback(
    (source: string, target: string) => {
      const direct = graph.transitions.find(
        (transition) =>
          transition.source === source && transition.target === target,
      );
      const inherited = getEffectiveTransitions(graph, source).find(
        (transition) =>
          getInitialLeafState(graph, transition.target) === target,
      );
      const transition = direct ?? inherited;
      return transition
        ? `${transition.source}\u0000${transition.target}`
        : `${source}\u0000${target}`;
    },
    [graph],
  );

  return (
    <main className="state-editor-root flex h-dvh min-h-[620px] flex-col overflow-hidden bg-[var(--editor-app)] text-slate-950 dark:text-slate-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--editor-border)] bg-[var(--editor-chrome)] px-4 shadow-sm sm:px-5">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-sm font-bold text-white shadow-md shadow-violet-600/20"
            onClick={() => selectEditorItem({ kind: 'machine', id: 'machine' })}
            title="Edit machine details"
            aria-label="Edit machine details"
            disabled={!recoveryComplete}
          >
            S
          </button>
          <div className="min-w-0">
            {!recoveryComplete ? (
              <h1 className="truncate text-sm font-semibold tracking-tight">
                State Editor
              </h1>
            ) : machineCreated ? (
              <div className="group flex items-center gap-1.5">
                <CommitInput
                  key={`header-machine-id:${graph.id}`}
                  value={graph.id}
                  onCommit={renameMachine}
                  className="h-7 w-32 border-transparent bg-transparent px-1 text-sm font-semibold tracking-tight shadow-none hover:border-slate-200 focus-visible:bg-white dark:hover:border-slate-700 dark:focus-visible:bg-slate-900 sm:w-52"
                  ariaLabel="Machine name"
                  disabled={simulating}
                />
                {!simulating && (
                  <Pencil className="size-3 shrink-0 text-slate-400 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 dark:text-slate-500" />
                )}
              </div>
            ) : (
              <h1 className="truncate text-sm font-semibold tracking-tight">
                No machine yet
              </h1>
            )}
            <p
              className="truncate text-[11px] text-slate-500 dark:text-slate-400"
              title={activeProjectFileName ?? undefined}
            >
              {!recoveryComplete
                ? 'Opening workspace…'
                : activeProjectFileName
                  ? `State Editor · ${activeProjectFileName}`
                  : 'State Editor'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5">
          {!simulating ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={requestNewMachine}
                title={
                  machineCreated ? 'Create a new machine' : 'Create machine'
                }
                disabled={!recoveryComplete}
              >
                <FilePlus2 />
                <span className="hidden xl:inline">
                  {machineCreated ? 'New' : 'Create'}
                </span>
              </Button>

              <div className="flex items-center rounded-lg border border-[var(--editor-border)] bg-[var(--editor-panel-subtle)] p-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                >
                  <Undo2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo (Ctrl+Shift+Z)"
                  aria-label="Redo"
                >
                  <Redo2 />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void saveProjectFile(false)}
                title={
                  activeProjectFileName && projectFileConnected
                    ? `Save project to ${activeProjectFileName}`
                    : activeProjectFileName
                      ? `Reconnect ${activeProjectFileName} when saving`
                      : 'Choose where to save the State Editor project'
                }
                disabled={!machineReady}
              >
                <Save />
                <span className="hidden xl:inline">Save</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void saveProjectFile(true)}
                title="Save the State Editor project as a new .se.json file"
                disabled={!machineReady}
              >
                <Save />
                <span className="hidden xl:inline">Save As</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void exportMachineJson()}
                title="Export clean XState MachineJSON for use in code"
                disabled={!machineReady}
              >
                <Download />
                <span className="hidden xl:inline">Export JSON</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void openFilePicker()}
                title="Open a State Editor project or import XState MachineJSON"
                disabled={!recoveryComplete}
              >
                <FolderOpen />
                <span className="hidden xl:inline">Open</span>
              </Button>
              <Button
                size="sm"
                onClick={startSimulation}
                className="bg-violet-600 hover:bg-violet-700"
                disabled={!machineReady}
              >
                <Play />
                <span className="hidden sm:inline">Simulate</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSimulationState(getInitialLeafState(graph, graph.initial))
                }
              >
                <RotateCcw />
                Reset
              </Button>
              <Button
                size="sm"
                onClick={stopSimulation}
                className="bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <Square />
                Stop
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            title="Toggle light and dark mode"
            aria-label="Toggle light and dark mode"
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json,.se.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openEditorFile(file);
            }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 bg-[var(--editor-canvas)]">
          {(!recoveryComplete || simulating) && (
            <div className="pointer-events-none absolute left-4 top-4 z-10 hidden rounded-xl border border-[var(--editor-border)] bg-[var(--editor-panel)]/90 px-3 py-2 text-xs text-slate-500 shadow-sm backdrop-blur dark:text-slate-400 sm:block">
              {!recoveryComplete
                ? 'Opening workspace…'
                : 'Transitions are hidden while you choose events from the simulation panel'}
            </div>
          )}

          {recoveryComplete && !machineCreated && !simulating && (
            <div className="absolute inset-0 z-20 bg-slate-100/70 backdrop-blur-[1px] dark:bg-slate-950/70" />
          )}

          {recoveryComplete && graph.states.length === 0 && !simulating && (
            <div
              data-empty-state
              className="absolute left-1/2 top-1/2 z-30 w-[min(420px,calc(100%-40px))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-[var(--editor-border)] bg-[var(--editor-panel)]/95 p-7 text-center shadow-2xl shadow-slate-900/10 backdrop-blur dark:shadow-black/30"
            >
              <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                <FilePlus2 className="size-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {machineCreated
                  ? 'Add the initial state'
                  : 'Create or open a machine'}
              </h2>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
                {machineCreated
                  ? 'Use the button below or double-click empty canvas. The first state becomes initial.'
                  : 'Start a named machine or open a JSON file. Once created, use Add state or double-click empty canvas to add states.'}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button
                  onClick={createInitialState}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  {machineCreated ? <Plus /> : <FilePlus2 />}
                  {machineCreated ? 'Create initial state' : 'Create machine'}
                </Button>
                <Button variant="outline" onClick={openFilePicker}>
                  <FolderOpen />
                  Open file
                </Button>
              </div>
            </div>
          )}

          <ReactFlow<StateFlowNode, TransitionBundleEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onBeforeDelete={async ({
              nodes: nodesToDelete,
              edges: edgesToDelete,
            }) => {
              if (nodesToDelete.length > 0) {
                pendingNodeDeletionEdgeIds.current = new Set(
                  edgesToDelete.map((edge) => edge.id),
                );
              }
              const rootKeys = new Set(
                getSelectionRoots(
                  graph,
                  nodesToDelete.map((node) => node.id),
                ),
              );
              const rootNodes = nodesToDelete.filter((node) =>
                rootKeys.has(node.id),
              );
              const rootIds = new Set(rootNodes.map((node) => node.id));
              const includesParent = rootNodes.some(
                (node) => getStateChildren(graph, node.id).length > 0,
              );
              if (!includesParent) {
                return { nodes: nodesToDelete, edges: edgesToDelete };
              }
              return {
                nodes: rootNodes,
                edges: edgesToDelete.filter(
                  (edge) =>
                    rootIds.has(edge.source) || rootIds.has(edge.target),
                ),
              };
            }}
            onNodeDragStart={beginGraphTransaction}
            onNodeDrag={(_, node) => {
              const parentKey = dropParentFor(node);
              setDropTargetParentKey(
                parentKey !== node.parentId ? (parentKey ?? null) : null,
              );
            }}
            onNodeDragStop={(_, node) => {
              setDropTargetParentKey(null);
              const parentKey = dropParentFor(node);
              if (parentKey && parentKey !== node.parentId) {
                setGraph((current) =>
                  reparentState(
                    {
                      ...current,
                      states: current.states.map((state) =>
                        state.key === node.id
                          ? { ...state, position: node.position }
                          : state,
                      ),
                    },
                    node.id,
                    parentKey,
                  ),
                );
                clearFeedback(`Added ${node.id} to ${parentKey}`);
              }
              commitGraphTransaction();
            }}

            onEdgesChange={onEdgesChange}
            onEdgeClick={(_, edge) => {
              const transitionIds =
                edge.data?.transitions.map(({ id }) => id) ?? [];
              if (transitionIds.length === 0) return;
              const currentId =
                selection?.kind === 'transition' &&
                transitionIds.includes(selection.id)
                  ? selection.id
                  : transitionIds[0];
              selectEditorItem({ kind: 'transition', id: currentId });
            }}
            onConnect={(connection) => {
              if (simulating) return;
              const source = graph.states.find(
                (state) => state.key === connection.source,
              );
              if (source?.final) {
                showIssues(['Final states cannot have outgoing transitions.']);
                return;
              }
              setPendingConnection(connection);
              setTransitionEvent('');
              clearFeedback('Name the transition');
            }}
            onPaneClick={() => {
              if (simulating || !recoveryComplete) return;
              selectEditorItem({ kind: 'machine', id: 'machine' });
            }}
            onDoubleClick={(event) => {
              if (
                simulating ||
                !recoveryComplete ||
                !(event.target instanceof Element) ||
                !(
                  event.target.classList.contains('react-flow__pane') ||
                  event.target.hasAttribute('data-state-frame')
                )
              ) {
                return;
              }

              if (!machineCreated) {
                openCreateDialog();
                return;
              }

              addStateAt(
                flow.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
                event.target.getAttribute('data-state-frame') ?? undefined,
              );
            }}
            onMoveEnd={(_, nextViewport: Viewport) =>
              setViewportState(nextViewport)
            }
            nodesDraggable={!simulating}
            nodesConnectable={!simulating}
            elementsSelectable
            elevateNodesOnSelect={false}
            zIndexMode="manual"
            elevateEdgesOnSelect={false}
            selectionOnDrag
            selectionMode={SelectionMode.Full}
            panOnDrag={[1]}
            panActivationKeyCode="Space"
            zoomOnDoubleClick={false}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
            deleteKeyCode={simulating ? null : ['Backspace', 'Delete']}
          >
            {minimapVisible && (
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  node.data.current
                    ? '#f59e0b'
                    : node.data.final
                      ? '#34d399'
                      : node.data.initial
                        ? '#8b5cf6'
                        : 'var(--editor-minimap-node)'
                }
                maskColor="var(--editor-minimap-mask)"
                className="!rounded-xl !border !border-[var(--editor-border)] !bg-[var(--editor-panel)] !shadow-lg"
              />
            )}
            <Controls className="!overflow-hidden !rounded-xl !border-[var(--editor-border)] !shadow-lg">
              <ControlButton
                type="button"
                onClick={toggleMinimap}
                title={minimapVisible ? 'Hide minimap' : 'Show minimap'}
                aria-label={minimapVisible ? 'Hide minimap' : 'Show minimap'}
              >
                {minimapVisible ? <EyeOff /> : <Eye />}
              </ControlButton>
            </Controls>
          </ReactFlow>

          {!simulating && graph.states.length > 0 && (
            <Button
              onClick={addStateNearCenter}
              className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-violet-600 px-4 shadow-lg shadow-violet-600/25 hover:bg-violet-700"
            >
              <Plus />
              Add state
            </Button>
          )}

          {pendingConnection && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                commitConnection();
              }}
              className="absolute left-1/2 top-20 z-20 w-[min(360px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-violet-200 bg-[var(--editor-panel)] p-4 shadow-2xl shadow-slate-900/15 dark:border-violet-500/40 dark:shadow-black/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
                    New transition
                  </p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                    <span>{pendingConnection.source}</span>
                    <ArrowRight className="size-3.5" />
                    <span>{pendingConnection.target}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPendingConnection(null)}
                  aria-label="Cancel transition"
                >
                  <X />
                </Button>
              </div>
              <div className="mt-4 flex gap-2">
                <Input
                  ref={transitionInput}
                  value={transitionEvent}
                  onChange={(event) => setTransitionEvent(event.target.value)}
                  list="transition-event-suggestions"
                  placeholder="EVENT_NAME"
                  className="font-mono uppercase"
                  aria-label="Transition event"
                />
                <datalist id="transition-event-suggestions">
                  {eventNameSuggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion}>
                      {suggestion}
                    </option>
                  ))}
                </datalist>
                <Button
                  type="submit"
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  Add
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Type an event name, then press Enter.
              </p>
            </form>
          )}

          {(issues.length > 0 || notice !== 'Ready') && (
            <div
              aria-live="polite"
              className={`absolute bottom-5 left-4 z-20 max-w-md rounded-xl border bg-[var(--editor-panel)] p-3 shadow-xl ${
                issues.length
                  ? 'border-rose-200 dark:border-rose-500/40'
                  : 'border-emerald-200 dark:border-emerald-500/40'
              }`}
            >
              <div className="flex items-start gap-2">
                {issues.length ? (
                  <CircleStop className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
                ) : (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {notice}
                  </p>
                  {issues.map((issue) => (
                    <p
                      key={issue}
                      className="mt-1 text-xs leading-5 text-rose-700 dark:text-rose-300"
                    >
                      {issue}
                    </p>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    setIssues([]);
                    setNotice('Ready');
                  }}
                  aria-label="Dismiss message"
                >
                  <X />
                </Button>
              </div>
            </div>
          )}
        </section>

        <aside className="hidden w-80 shrink-0 border-l border-[var(--editor-border)] bg-[var(--editor-panel)] md:flex md:flex-col">
          {!recoveryComplete ? (
            <div className="flex flex-1 items-center justify-center px-5 text-xs text-slate-400 dark:text-slate-500">
              Opening workspace…
            </div>
          ) : simulating ? (
            <SimulationPanel
              graph={graph}
              currentState={currentState}
              transitions={availableTransitions}
              onTransition={(transition) => {
                const targetLeaf = getInitialLeafState(
                  graph,
                  transition.target,
                );
                setSimulationState(targetLeaf);
                selectEditorItem({ kind: 'state', id: targetLeaf });
              }}
              onReset={() =>
                setSimulationState(getInitialLeafState(graph, graph.initial))
              }
            />
          ) : !machineCreated ? (
            <div className="flex flex-1 items-center justify-center px-8 text-center text-sm leading-6 text-slate-400 dark:text-slate-500">
              Create or open a machine to edit its details.
            </div>
          ) : (
            <>
              <div
                className="grid grid-cols-2 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]"
                role="tablist"
                aria-label="Right panel mode"
              >
                {(['properties', 'analysis'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={rightPanelMode === mode}
                    onClick={() => {
                      setRightPanelMode(mode);
                      if (mode === 'properties') setAnalysisHighlight(null);
                    }}
                    className={`relative px-3 py-3 text-xs font-semibold capitalize transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 ${
                      rightPanelMode === mode
                        ? 'bg-[var(--editor-panel-subtle)] text-slate-800 after:bg-violet-500 dark:text-slate-100 dark:after:bg-violet-400'
                        : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {rightPanelMode === 'analysis' ? (
                <MachineAnalysisPanel
                  analysis={machineAnalysis}
                  activeView={analysisView}
                  onActiveViewChange={(view) => {
                    setAnalysisView(view);
                    setAnalysisHighlight(null);
                  }}
                  stateDirection={stateDirection}
                  onStateDirectionChange={(direction) => {
                    setStateDirection(direction);
                    setAnalysisHighlight(null);
                  }}
                  highlightedPath={
                    analysisHighlight?.kind === 'path'
                      ? analysisHighlight.key
                      : null
                  }
                  highlightedNode={
                    analysisHighlight?.kind === 'node'
                      ? analysisHighlight.key
                      : null
                  }
                  highlightedCycle={
                    analysisHighlight?.kind === 'cycle'
                      ? analysisHighlight.key
                      : null
                  }
                  onSelectPath={(path, key) => {
                    if (
                      analysisHighlight?.kind === 'path' &&
                      analysisHighlight.key === key
                    ) {
                      setAnalysisHighlight(null);
                      return;
                    }
                    selectEditorItem({ kind: 'machine', id: 'machine' });
                    setAnalysisHighlight({
                      kind: 'path',
                      key,
                      states: path.states,
                      routes: path.states
                        .slice(1)
                        .map((target, index) =>
                          routeKeyFor(path.states[index], target),
                        ),
                    });
                    const pathStates = new Set(path.states);
                    const pathNodes = nodes.filter(({ id }) =>
                      pathStates.has(id),
                    );
                    if (pathNodes.length) {
                      requestAnimationFrame(() =>
                        flow.fitView({
                          nodes: pathNodes,
                          padding: 0.3,
                          maxZoom: 1.05,
                          duration: 300,
                        }),
                      );
                    }
                  }}
                  onHighlightNode={(state) => {
                    if (
                      analysisHighlight?.kind === 'node' &&
                      analysisHighlight.key === state
                    ) {
                      setAnalysisHighlight(null);
                      return;
                    }
                    selectEditorItem({ kind: 'machine', id: 'machine' });
                    const relatedTransitions =
                      stateDirection === 'incoming'
                        ? graph.transitions.filter(
                            (transition) => transition.target === state,
                          )
                        : getEffectiveTransitions(graph, state);
                    setAnalysisHighlight({
                      kind: 'node',
                      key: state,
                      states: [state],
                      routes: relatedTransitions.map((transition) =>
                        routeKeyFor(transition.source, transition.target),
                      ),
                    });
                    const framedStates = new Set([
                      state,
                      ...relatedTransitions.flatMap((transition) => [
                        transition.source,
                        transition.target,
                        getInitialLeafState(graph, transition.target),
                      ]),
                    ]);
                    const framedNodes = nodes.filter(({ id }) =>
                      framedStates.has(id),
                    );
                    if (framedNodes.length) {
                      requestAnimationFrame(() =>
                        flow.fitView({
                          nodes: framedNodes,
                          padding: 0.45,
                          maxZoom: 1.05,
                          duration: 300,
                        }),
                      );
                    }
                  }}
                  onHighlightCycle={(cycle, key) => {
                    if (
                      analysisHighlight?.kind === 'cycle' &&
                      analysisHighlight.key === key
                    ) {
                      setAnalysisHighlight(null);
                      return;
                    }
                    selectEditorItem({ kind: 'machine', id: 'machine' });
                    const cycleStates = new Set(cycle.states);
                    const cycleRoutes = cycle.states.map((source, index) =>
                      routeKeyFor(
                        source,
                        cycle.states[(index + 1) % cycle.states.length],
                      ),
                    );
                    const routesForPath = (path: string[] | null) => {
                      if (!path) return [];
                      return path
                        .slice(1)
                        .map((target, index) =>
                          routeKeyFor(path[index], target),
                        );
                    };
                    const contextStates = [
                      ...cycle.entryPath,
                      ...(cycle.exitPath ?? []),
                    ].filter((state) => !cycleStates.has(state));
                    setAnalysisHighlight({
                      kind: 'cycle',
                      key,
                      states: cycle.states,
                      routes: cycleRoutes,
                      contextStates,
                      contextRoutes: [
                        ...routesForPath(cycle.entryPath),
                        ...routesForPath(cycle.exitPath),
                      ],
                    });
                    const framedStates = new Set([
                      ...cycle.states,
                      ...contextStates,
                    ]);
                    const cycleNodes = nodes.filter(({ id }) =>
                      framedStates.has(id),
                    );
                    if (cycleNodes.length) {
                      requestAnimationFrame(() =>
                        flow.fitView({
                          nodes: cycleNodes,
                          padding: 0.45,
                          maxZoom: 1.05,
                          duration: 300,
                        }),
                      );
                    }
                  }}
                />
              ) : selectedStateKeys.size > 1 ? (
                <>
                  <InspectorHeader
                    eyebrow="Selection"
                    title={`${selectedStateKeys.size} states selected`}
                  />
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 [scrollbar-gutter:stable]">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={openGroupDialog}
                      disabled={Boolean(groupingUnavailableReason)}
                      aria-describedby="selection-parent-help"
                    >
                      <CopyPlus />
                      Create parent
                    </Button>
                    <p
                      id="selection-parent-help"
                      className="text-xs leading-5 text-slate-500 dark:text-slate-400"
                    >
                      {groupingUnavailableReason ??
                        'Create a parent containing the selected states. Choose its name and initial child in the next step.'}
                    </p>
                  </div>
                </>
              ) : selectedState ? (
                <StateInspector
                  state={selectedState}
                  initial={
                    selectedState.parentKey === undefined
                      ? graph.initial === selectedState.key
                      : graph.states.find(
                          (candidate) =>
                            candidate.key === selectedState.parentKey,
                        )?.initialChild === selectedState.key
                  }
                  childStates={getStateChildren(graph, selectedState.key)}
                  onSetInitialChild={(key) => {
                    if (
                      getStateChildren(graph, selectedState.key).some(
                        (child) => child.key === key,
                      )
                    ) {
                      setInitial(key);
                    }
                  }}
                  unreachable={!reachableStateKeys.has(selectedState.key)}
                  outgoingCount={
                    graph.transitions.filter(
                      (transition) => transition.source === selectedState.key,
                    ).length
                  }
                  onRename={(value) => renameState(selectedState.key, value)}
                  onSetInitial={() => setInitial(selectedState.key)}
                  onToggleFinal={() => toggleFinal(selectedState.key)}
                  onDuplicate={() => duplicateState(selectedState.key)}
                  onDelete={() => removeStates([selectedState.key])}
                  onRemoveFromParent={() => removeFromParent(selectedState.key)}
                  onUpdate={(patch) => updateState(selectedState.key, patch)}
                  onError={(message) => showIssues([message])}
                  actionNameSuggestions={actionNameSuggestions}
                  actionParameterSuggestions={actionParameterSuggestions}
                  expandedActionIds={expandedActionIds}
                  onActionExpandedChange={setActionExpanded}
                />
              ) : selectedTransition ? (
                <TransitionInspector
                  transition={selectedTransition}
                  onRename={(value) =>
                    updateTransitionEvent(selectedTransition.id, value)
                  }
                  onUpdateActions={(actions) =>
                    updateTransitionActions(selectedTransition.id, actions)
                  }
                  onError={(message) => showIssues([message])}
                  actionNameSuggestions={actionNameSuggestions}
                  actionParameterSuggestions={actionParameterSuggestions}
                  expandedActionIds={expandedActionIds}
                  onActionExpandedChange={setActionExpanded}
                  eventNameSuggestions={eventNameSuggestions}
                  onDelete={() => removeTransitions([selectedTransition.id])}
                />
              ) : (
                <MachineInspector
                  graph={graph}
                  onRename={renameMachine}
                  onUpdate={(patch) =>
                    setGraph((current) => ({ ...current, ...patch }))
                  }
                  onError={(message) => showIssues([message])}
                />
              )}
            </>
          )}
        </aside>
      </div>

      {createDialogOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) setCreateDialogError(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <form onSubmit={createMachineFromDialog} className="grid gap-5">
              <DialogHeader>
                <DialogTitle>Create machine</DialogTitle>
                <DialogDescription>
                  Name the machine and its initial state to start editing.
                </DialogDescription>
              </DialogHeader>
              <label
                htmlFor="new-machine-name"
                className="grid gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Machine name
                <Input
                  id="new-machine-name"
                  value={newMachineName}
                  onChange={(event) => {
                    setNewMachineName(event.target.value);
                    if (createDialogError) setCreateDialogError(null);
                  }}
                  placeholder="checkoutFlow"
                  aria-invalid={createDialogError ? true : undefined}
                  aria-describedby={
                    createDialogError ? 'machine-name-error' : undefined
                  }
                />
              </label>
              <label
                htmlFor="new-initial-state-name"
                className="grid gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Initial state
                <Input
                  id="new-initial-state-name"
                  aria-label="Initial state"
                  value={newInitialStateName}
                  onChange={(event) => {
                    setNewInitialStateName(event.target.value);
                    if (createDialogError) setCreateDialogError(null);
                  }}
                  placeholder="idle"
                  aria-invalid={createDialogError ? true : undefined}
                  aria-describedby={
                    createDialogError ? 'machine-name-error' : undefined
                  }
                />
                <span className="text-xs font-normal leading-5 text-slate-500 dark:text-slate-400">
                  The machine begins here when you simulate it.
                </span>
              </label>
              {createDialogError && (
                <p
                  id="machine-name-error"
                  className="text-sm text-rose-700 dark:text-rose-300"
                  role="alert"
                >
                  {createDialogError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  <FilePlus2 />
                  Create machine
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {groupDialogOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            setGroupDialogOpen(open);
            if (!open) setGroupDialogError(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <form onSubmit={groupSelectedStates} className="grid gap-5">
              <DialogHeader>
                <DialogTitle>Create parent state</DialogTitle>
                <DialogDescription>
                  The {selectedStateKeys.size} selected states become children
                  of a new parent
                  {groupScopeKey ? ` inside ${groupScopeKey}` : ''}. Transitions
                  on the parent can apply to all its children.
                </DialogDescription>
              </DialogHeader>
              <label
                htmlFor="group-state-name"
                className="grid gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Parent state name
                <Input
                  id="group-state-name"
                  value={groupName}
                  onChange={(event) => {
                    setGroupName(event.target.value);
                    setGroupDialogError(null);
                  }}
                  placeholder="stateGroup"
                  aria-invalid={groupDialogError ? true : undefined}
                />
              </label>
              <label
                htmlFor="group-initial-child"
                className="grid gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Initial child
                <select
                  id="group-initial-child"
                  value={groupInitialChild}
                  onChange={(event) => setGroupInitialChild(event.target.value)}
                  className="h-10 rounded-md border border-[var(--editor-border)] bg-[var(--editor-panel)] px-3 text-sm text-slate-800 dark:text-slate-100"
                >
                  {graph.states
                    .filter((state) => selectedStateKeys.has(state.key))
                    .map((state) => (
                      <option key={state.key} value={state.key}>
                        {state.key}
                      </option>
                    ))}
                </select>
              </label>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                The initial child is entered by default when the parent is
                entered. You can change it later in Properties.
                {groupScopeInitial &&
                  selectedStateKeys.has(groupScopeInitial) && (
                    <>
                      {' '}
                      This parent will become the initial state of{' '}
                      {groupScopeKey ?? 'the machine'}.
                    </>
                  )}
              </p>
              {groupDialogError && (
                <p
                  className="text-sm text-rose-700 dark:text-rose-300"
                  role="alert"
                >
                  {groupDialogError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGroupDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  <CopyPlus /> Create parent
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}

function InspectorHeader({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="border-b border-[var(--editor-border)] px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
        {eyebrow}
      </p>
      <h2 className="mt-1 truncate text-sm font-semibold">{title}</h2>
    </div>
  );
}

function MachineInspector({
  graph,
  onRename,
  onUpdate,
  onError,
}: {
  graph: GraphMachine;
  onRename: (id: string) => string | void;
  onUpdate: (patch: Partial<GraphMachine>) => void;
  onError: (message: string) => void;
}) {
  return (
    <>
      <InspectorHeader eyebrow="Machine" title={graph.id || 'No machine yet'} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 [scrollbar-gutter:stable]">
        <div className="block space-y-1.5">
          <FieldLabel>Machine id</FieldLabel>
          <CommitInput
            key={`machine-id:${graph.id}`}
            value={graph.id}
            onCommit={onRename}
            className="font-mono"
            ariaLabel="Machine id"
          />
        </div>
        <div className="block space-y-1.5">
          <FieldLabel>Description</FieldLabel>
          <CommitTextarea
            key={`machine-description:${graph.description}`}
            value={graph.description}
            onCommit={(description) => onUpdate({ description })}
            placeholder="What does this machine model?"
            ariaLabel="Machine description"
          />
        </div>
        <div className="block space-y-1.5">
          <FieldLabel>Tags</FieldLabel>
          <CommitInput
            key={`machine-tags:${graph.tags.join('\u001f')}`}
            value={graph.tags.join(', ')}
            onCommit={(tags) => onUpdate({ tags: parseTags(tags) })}
            ariaLabel="Machine tags"
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Comma-separated strings
          </p>
        </div>
        <div className="block space-y-1.5">
          <FieldLabel>Meta</FieldLabel>
          <JsonEditor
            key={`machine-meta:${JSON.stringify(graph.meta)}`}
            value={graph.meta}
            onCommit={(meta) => onUpdate({ meta })}
            onError={onError}
          />
        </div>
      </div>
    </>
  );
}

function StateInspector({
  state,
  initial,
  childStates,
  onSetInitialChild,
  unreachable,
  outgoingCount,
  onRename,
  onSetInitial,
  onToggleFinal,
  onDuplicate,
  onDelete,
  onRemoveFromParent,
  onUpdate,
  onError,
  actionNameSuggestions,
  actionParameterSuggestions,
  expandedActionIds,
  onActionExpandedChange,
}: {
  state: GraphState;
  initial: boolean;
  childStates: GraphState[];
  onSetInitialChild: (key: string) => void;
  unreachable: boolean;
  outgoingCount: number;
  onRename: (value: string) => void;
  onSetInitial: () => void;
  onToggleFinal: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRemoveFromParent: () => void;
  onUpdate: (patch: Partial<GraphState>) => void;
  onError: (message: string) => void;
  actionNameSuggestions: string[];
  actionParameterSuggestions: string[];
  expandedActionIds: ReadonlySet<string>;
  onActionExpandedChange: (id: string, expanded: boolean) => void;
}) {
  return (
    <>
      <InspectorHeader eyebrow="Selected state" title={state.key} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 [scrollbar-gutter:stable]">
        <div className="block space-y-1.5">
          <FieldLabel>State key</FieldLabel>
          <CommitInput
            key={`state-key:${state.key}`}
            value={state.key}
            onCommit={onRename}
            className="font-mono"
            ariaLabel="State key"
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            State role in{' '}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {state.parentKey ?? 'machine'}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={initial ? 'secondary' : 'outline'}
              size="sm"
              onClick={onSetInitial}
              disabled={initial}
              aria-label={
                state.parentKey !== undefined
                  ? `${initial ? 'Initial child' : 'Set initial child'} of ${state.parentKey}`
                  : initial
                    ? 'Machine initial state'
                    : 'Set initial state of machine'
              }
            >
              <InitialStateMark
                label={
                  state.parentKey !== undefined
                    ? 'Initial child state'
                    : 'Initial state'
                }
              />
              {initial ? 'Initial' : 'Set initial'}
            </Button>
            <Button
              variant={state.final ? 'secondary' : 'outline'}
              size="sm"
              onClick={onToggleFinal}
            >
              <FinalStateMark />
              {state.final ? 'Final' : 'Set final'}
            </Button>
          </div>
          <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            {state.parentKey !== undefined
              ? 'Initial: the default entry into this parent. Final: completes this parent.'
              : 'Initial: where the machine starts. Final: completes the machine.'}
          </p>
        </div>
        {childStates.length > 0 && (
          <div className="space-y-1.5">
            <label
              htmlFor="state-initial-child"
              className="text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              Initial child
            </label>
            <select
              id="state-initial-child"
              value={state.initialChild ?? ''}
              onChange={(event) => onSetInitialChild(event.target.value)}
              className="h-9 w-full rounded-md border border-[var(--editor-border)] bg-[var(--editor-panel)] px-3 text-sm text-slate-800 dark:text-slate-100"
            >
              {childStates.map((child) => (
                <option key={child.key} value={child.key}>
                  {child.key}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              Entered by default when this parent is entered.
            </p>
          </div>
        )}
        {unreachable && (
          <div className="flex gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs leading-5 text-orange-800 dark:border-orange-500/35 dark:bg-orange-500/10 dark:text-orange-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            This state cannot be reached from the initial state.
          </div>
        )}
        {state.final && outgoingCount > 0 && (
          <p className="text-xs leading-5 text-rose-700 dark:text-rose-300">
            Final states cannot have outgoing transitions.
          </p>
        )}
        <div className="space-y-4 border-t border-[var(--editor-border)] pt-4">
          <ActionListEditor
            actions={state.entryActions}
            suggestions={actionNameSuggestions}
            parameterSuggestions={actionParameterSuggestions}
            title="Entry actions"
            addLabel="Add entry action"
            scopeLabel="Entry action"
            withTopBorder={false}
            expandedActionIds={expandedActionIds}
            onActionExpandedChange={onActionExpandedChange}
            onChange={(entryActions) => onUpdate({ entryActions })}
            onError={onError}
          />
          <ActionListEditor
            actions={state.exitActions}
            suggestions={actionNameSuggestions}
            parameterSuggestions={actionParameterSuggestions}
            title="Exit actions"
            addLabel="Add exit action"
            scopeLabel="Exit action"
            withTopBorder={false}
            disabled={state.final}
            expandedActionIds={expandedActionIds}
            onActionExpandedChange={onActionExpandedChange}
            onChange={(exitActions) => onUpdate({ exitActions })}
            onError={onError}
          />
        </div>
        <div className="block space-y-1.5">
          <FieldLabel>Description</FieldLabel>
          <CommitTextarea
            key={`state-description:${state.key}:${state.description}`}
            value={state.description}
            onCommit={(description) => onUpdate({ description })}
            placeholder="What does this state remember?"
            ariaLabel="State description"
          />
        </div>
        <div className="block space-y-1.5">
          <FieldLabel>Tags</FieldLabel>
          <CommitInput
            key={`state-tags:${state.key}:${state.tags.join('\u001f')}`}
            value={state.tags.join(', ')}
            onCommit={(tags) => onUpdate({ tags: parseTags(tags) })}
            ariaLabel="State tags"
          />
        </div>
        <div className="block space-y-1.5">
          <FieldLabel>Meta</FieldLabel>
          <JsonEditor
            key={`state-meta:${state.key}:${JSON.stringify(state.meta)}`}
            value={state.meta}
            onCommit={(meta) => onUpdate({ meta })}
            onError={onError}
          />
        </div>
        <div className="border-t border-[var(--editor-border)] pt-4">
          {state.parentKey && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRemoveFromParent}
              className="mb-2 w-full"
            >
              Remove from parent
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicate}
            className="mb-2 w-full"
          >
            <CopyPlus />
            Duplicate state
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            className="w-full"
          >
            <Trash2 />
            Delete state
          </Button>
        </div>
      </div>
    </>
  );
}

function TransitionInspector({
  transition,
  onRename,
  onUpdateActions,
  onError,
  onDelete,
  actionNameSuggestions,
  actionParameterSuggestions,
  expandedActionIds,
  onActionExpandedChange,
  eventNameSuggestions,
}: {
  transition: GraphTransition;
  onRename: (value: string) => void;
  onUpdateActions: (actions: GraphAction[]) => void;
  onError: (message: string) => void;
  onDelete: () => void;
  actionNameSuggestions: string[];
  actionParameterSuggestions: string[];
  expandedActionIds: ReadonlySet<string>;
  onActionExpandedChange: (id: string, expanded: boolean) => void;
  eventNameSuggestions: string[];
}) {
  return (
    <>
      <InspectorHeader eyebrow="Selected transition" title={transition.event} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 [scrollbar-gutter:stable]">
        <div className="block space-y-1.5">
          <FieldLabel>Event name</FieldLabel>
          <CommitInput
            key={`transition-event:${transition.id}:${transition.event}`}
            value={transition.event}
            onCommit={onRename}
            suggestions={eventNameSuggestions}
            className="font-mono"
            ariaLabel="Transition event"
          />
        </div>
        <div className="rounded-xl border border-[var(--editor-border)] bg-[var(--editor-panel-subtle)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Route
          </p>
          <div className="mt-2 flex items-center gap-2 font-mono text-xs text-slate-700 dark:text-slate-200">
            <span className="truncate">{transition.source}</span>
            <ArrowRight className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
            <span className="truncate">{transition.target}</span>
          </div>
        </div>
        <ActionListEditor
          actions={transition.actions}
          suggestions={actionNameSuggestions}
          parameterSuggestions={actionParameterSuggestions}
          expandedActionIds={expandedActionIds}
          onActionExpandedChange={onActionExpandedChange}
          onChange={onUpdateActions}
          onError={onError}
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          className="w-full"
        >
          <Trash2 />
          Delete transition
        </Button>
      </div>
    </>
  );
}

function SimulationPanel({
  graph,
  currentState,
  transitions,
  onTransition,
  onReset,
}: {
  graph: GraphMachine;
  currentState: GraphState | undefined;
  transitions: GraphTransition[];
  onTransition: (transition: GraphTransition) => void;
  onReset: () => void;
}) {
  const hasConfiguredActions =
    graph.transitions.some((transition) => transition.actions.length > 0) ||
    graph.states.some(
      (state) => state.entryActions.length > 0 || state.exitActions.length > 0,
    );

  return (
    <>
      <InspectorHeader
        eyebrow="Simulation"
        title={currentState?.key ?? 'Unknown state'}
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 [scrollbar-gutter:stable]">
        <div
          className={`rounded-2xl border p-4 ${currentState?.final ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/35 dark:bg-emerald-500/10' : 'border-amber-200 bg-amber-50 dark:border-amber-500/35 dark:bg-amber-500/10'}`}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Current state
          </p>
          <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
            {currentState?.key}
          </p>
          {currentState?.description && (
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {currentState.description}
            </p>
          )}
          {currentState?.final && (
            <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <Check className="size-4" />
              Machine complete
            </p>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            Available events
          </p>
          {hasConfiguredActions && (
            <p className="mb-3 rounded-lg bg-[var(--editor-panel-subtle)] px-2.5 py-2 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
              Named actions are shown here but integrations are not executed in
              the local simulation.
            </p>
          )}
          <div className="space-y-2">
            {transitions.map((transition) => (
              <Button
                key={transition.id}
                variant="outline"
                onClick={() => onTransition(transition)}
                className="h-auto w-full justify-between px-3 py-2.5 font-mono text-xs"
              >
                <span className="truncate">{transition.event}</span>
                <span className="ml-auto flex items-center gap-2">
                  {transition.actions.length > 0 && (
                    <span className="rounded-md bg-violet-100 px-1.5 py-0.5 font-sans text-[9px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                      {transition.actions.length}{' '}
                      {transition.actions.length === 1 ? 'action' : 'actions'}
                    </span>
                  )}
                  <ArrowRight className="size-4 text-violet-600 dark:text-violet-300" />
                </span>
              </Button>
            ))}
            {transitions.length === 0 && !currentState?.final && (
              <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No events are available from this state.
              </p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} className="w-full">
          <RotateCcw />
          Reset to {graph.initial}
        </Button>
      </div>
    </>
  );
}

export function MachineEditor() {
  return (
    <ReactFlowProvider>
      <EditorSurface />
    </ReactFlowProvider>
  );
}
