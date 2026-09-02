'use client';

import { useMemo } from 'react';

import type {
  MachineAnalysis,
  MachineCycle,
  MachinePath,
} from '@/lib/machine-analysis';

export type AnalysisView = 'cycles' | 'paths' | 'nodes';
export type StateDirection = 'incoming' | 'outgoing';

const ANALYSIS_VIEWS: Array<{ id: AnalysisView; label: string }> = [
  { id: 'paths', label: 'Paths' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'cycles', label: 'Cycles' },
];

function countForView(view: AnalysisView, analysis: MachineAnalysis) {
  if (view === 'cycles') return analysis.cycles.length;
  if (view === 'paths') return analysis.paths.length;
  return analysis.stateConnections.length;
}

function EmptyResult({ children }: { children: string }) {
  return (
    <p className="rounded-xl bg-[var(--editor-panel-subtle)] px-3 py-3 text-xs leading-5 text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

function AnalysisMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <>
      <span className="block text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <strong className="mt-0.5 block text-lg font-bold tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
        {value}
      </strong>
    </>
  );
}

function AnalysisListCard({
  ariaLabel,
  metricLabel,
  metricValue,
  entityLabel,
  entityValue,
  selected = false,
  pathIndex,
  onClick,
}: {
  ariaLabel: string;
  metricLabel: string;
  metricValue: number;
  entityLabel: string;
  entityValue: string;
  selected?: boolean;
  pathIndex?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-analysis-path={pathIndex}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected
          ? 'border-rose-400 bg-rose-50/70 dark:border-rose-400/70 dark:bg-rose-500/10'
          : 'border-transparent bg-[var(--editor-panel-subtle)] hover:border-[var(--editor-border)]'
      }`}
    >
      <span className="grid grid-cols-[3rem_minmax(0,1fr)]">
        <span className="border-r border-[var(--editor-border)] px-0.5 text-center">
          <AnalysisMetric label={metricLabel} value={metricValue} />
        </span>
        <span className="min-w-0 pl-2.5">
          <span className="block text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
            {entityLabel}
          </span>
          <span
            className="mt-0.5 block truncate font-mono text-sm font-semibold leading-none text-slate-800 dark:text-slate-100"
            title={entityValue}
          >
            {entityValue}
          </span>
        </span>
      </span>
    </button>
  );
}

function CyclesView({
  analysis,
  highlightedCycle,
  onHighlightCycle,
}: {
  analysis: MachineAnalysis;
  highlightedCycle: string | null;
  onHighlightCycle: (cycle: MachineCycle, key: string) => void;
}) {
  if (analysis.cycles.length === 0) {
    return (
      <EmptyResult>No cycles are reachable from the initial state.</EmptyResult>
    );
  }

  return (
    <>
      <ol className="space-y-1.5">
        {analysis.cycles.map((cycle, index) => {
          const key = cycle.states.join('\u0000');
          const selected = highlightedCycle === key;
          return (
            <li key={key}>
              <button
                type="button"
                data-analysis-cycle={index + 1}
                aria-pressed={selected}
                aria-label={`Highlight cycle ${index + 1}: entry ${cycle.entryDistance}, cycle ${cycle.cycleLength}, exit ${cycle.exitDistance ?? 'none'}`}
                onClick={() => onHighlightCycle(cycle, key)}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  selected
                    ? 'border-rose-400 bg-rose-50/70 dark:border-rose-400/70 dark:bg-rose-500/10'
                    : 'border-transparent bg-[var(--editor-panel-subtle)] hover:border-[var(--editor-border)]'
                }`}
              >
                <span className="grid grid-cols-3 divide-x divide-[var(--editor-border)] text-center">
                  <span className="px-1">
                    <AnalysisMetric label="Entry" value={cycle.entryDistance} />
                  </span>
                  <span className="px-1">
                    <AnalysisMetric label="Cycle" value={cycle.cycleLength} />
                  </span>
                  <span className="px-1">
                    <AnalysisMetric
                      label="Exit"
                      value={cycle.exitDistance ?? '—'}
                    />
                  </span>
                </span>
                <span className="mt-2 flex min-w-0 items-baseline gap-2 border-t border-[var(--editor-border)] pt-1.5">
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                    Ends at
                  </span>
                  <span
                    className="min-w-0 truncate font-mono text-xs font-semibold text-slate-800 dark:text-slate-100"
                    title={cycle.endState ?? 'No reachable end'}
                  >
                    {cycle.endState ?? 'No reachable end'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {analysis.cyclesTruncated && (
        <p className="mt-2 text-[10px] leading-4 text-slate-400 dark:text-slate-500">
          Showing the first {analysis.cycles.length} cycles.
        </p>
      )}
    </>
  );
}

function PathsView({
  analysis,
  highlightedPath,
  onSelectPath,
}: {
  analysis: MachineAnalysis;
  highlightedPath: string | null;
  onSelectPath: (path: MachinePath, key: string) => void;
}) {
  if (analysis.paths.length === 0) {
    return (
      <EmptyResult>
        No finite paths are available from the initial state.
      </EmptyResult>
    );
  }

  return (
    <ol className="space-y-1.5">
      {analysis.paths.map((path, index) => {
        const key = path.states.join('\u0000');
        const selected = highlightedPath === key;
        const transitionCount = path.states.length - 1;
        const endState = path.states.at(-1)!;
        return (
          <li key={key}>
            <AnalysisListCard
              pathIndex={index + 1}
              selected={selected}
              ariaLabel={`Highlight path of length ${transitionCount} ending at ${endState}`}
              onClick={() => onSelectPath(path, key)}
              metricLabel="Length"
              metricValue={transitionCount}
              entityLabel="Ends at"
              entityValue={endState}
            />
          </li>
        );
      })}
    </ol>
  );
}

function NodesView({
  analysis,
  stateDirection,
  onStateDirectionChange,
  highlightedNode,
  onHighlightNode,
}: {
  analysis: MachineAnalysis;
  stateDirection: StateDirection;
  onStateDirectionChange: (direction: StateDirection) => void;
  highlightedNode: string | null;
  onHighlightNode: (state: string) => void;
}) {
  const states = useMemo(() => {
    const transitionKey =
      stateDirection === 'incoming'
        ? 'incomingTransitions'
        : 'outgoingTransitions';
    const stateKey =
      stateDirection === 'incoming' ? 'incomingStates' : 'outgoingStates';
    return [...analysis.stateConnections].sort(
      (first, second) =>
        second[transitionKey] - first[transitionKey] ||
        second[stateKey] - first[stateKey] ||
        first.state.localeCompare(second.state),
    );
  }, [analysis.stateConnections, stateDirection]);

  return (
    <>
      <fieldset className="grid grid-cols-2 border-b border-[var(--editor-border)]">
        <legend className="sr-only">State connection direction</legend>
        {(['incoming', 'outgoing'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onStateDirectionChange(direction)}
            aria-pressed={stateDirection === direction}
            className={`relative px-2 pb-2 pt-0.5 text-[11px] font-semibold capitalize transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 ${
              stateDirection === direction
                ? 'text-slate-800 after:bg-violet-500 dark:text-slate-100 dark:after:bg-violet-400'
                : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
            }`}
          >
            {direction}
          </button>
        ))}
      </fieldset>
      <ol className="mt-2 space-y-1.5">
        {states.map((item) => {
          const transitions =
            stateDirection === 'incoming'
              ? item.incomingTransitions
              : item.outgoingTransitions;
          return (
            <li key={item.state}>
              <AnalysisListCard
                ariaLabel={`Locate node ${item.state}`}
                selected={highlightedNode === item.state}
                onClick={() => onHighlightNode(item.state)}
                metricLabel="Events"
                metricValue={transitions}
                entityLabel="Node"
                entityValue={item.state}
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function MachineAnalysisPanel({
  analysis,
  activeView,
  onActiveViewChange,
  stateDirection,
  onStateDirectionChange,
  highlightedPath,
  highlightedNode,
  highlightedCycle,
  onSelectPath,
  onHighlightNode,
  onHighlightCycle,
}: {
  analysis: MachineAnalysis;
  activeView: AnalysisView;
  onActiveViewChange: (view: AnalysisView) => void;
  stateDirection: StateDirection;
  onStateDirectionChange: (direction: StateDirection) => void;
  highlightedPath: string | null;
  highlightedNode: string | null;
  highlightedCycle: string | null;
  onSelectPath: (path: MachinePath, key: string) => void;
  onHighlightNode: (state: string) => void;
  onHighlightCycle: (cycle: MachineCycle, key: string) => void;
}) {
  return (
    <>
      <div className="border-b border-[var(--editor-border)]">
        <div
          className="grid grid-cols-3"
          role="tablist"
          aria-label="Analysis view"
        >
          {ANALYSIS_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={activeView === view.id}
              onClick={() => onActiveViewChange(view.id)}
              className={`relative px-1.5 py-2.5 text-[11px] font-semibold transition-colors after:absolute after:inset-x-4 after:-bottom-px after:h-0.5 ${
                activeView === view.id
                  ? 'text-slate-800 after:bg-violet-500 dark:text-slate-100 dark:after:bg-violet-400'
                  : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              {view.label}
              <span className="ml-1 font-mono text-[9px] opacity-60">
                {countForView(view.id, analysis)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
        {activeView === 'cycles' ? (
          <CyclesView
            analysis={analysis}
            highlightedCycle={highlightedCycle}
            onHighlightCycle={onHighlightCycle}
          />
        ) : activeView === 'paths' ? (
          <PathsView
            analysis={analysis}
            highlightedPath={highlightedPath}
            onSelectPath={onSelectPath}
          />
        ) : (
          <NodesView
            analysis={analysis}
            stateDirection={stateDirection}
            onStateDirectionChange={onStateDirectionChange}
            highlightedNode={highlightedNode}
            onHighlightNode={onHighlightNode}
          />
        )}
      </div>
    </>
  );
}
