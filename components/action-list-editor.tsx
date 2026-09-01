'use client';

import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GraphAction, JsonValue } from '@/lib/machine-json';

function makeActionId() {
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type ActionParamKind = 'text' | 'number' | 'boolean' | 'null' | 'json';

function actionParamKind(value: JsonValue): ActionParamKind {
  if (value === null) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'text';
  return 'json';
}

function actionParamDefault(kind: ActionParamKind): JsonValue {
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  if (kind === 'null') return null;
  if (kind === 'json') return {};
  return '';
}

function CommitInput({
  value,
  onCommit,
  className = '',
  ariaLabel,
  suggestions = [],
}: {
  value: string;
  onCommit: (value: string) => string | void;
  className?: string;
  ariaLabel: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState(value);
  const cancelCommit = useRef(false);
  const listId = suggestions.length
    ? `suggestions-${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : undefined;

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

function ActionParamValueInput({
  actionType,
  paramKey,
  value,
  onChange,
  onError,
}: {
  actionType: string;
  paramKey: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  onError: (message: string) => void;
}) {
  const kind = actionParamKind(value);
  const ariaLabel = `${actionType || 'Action'} ${paramKey} value`;

  if (kind === 'boolean') {
    return (
      <select
        value={value ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
        className="h-7 min-w-0 rounded-lg border border-input bg-transparent px-1.5 font-mono text-[11px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 dark:bg-input/30"
        aria-label={ariaLabel}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (kind === 'null') {
    return (
      <Input
        value="null"
        disabled
        className="h-7 px-2 font-mono text-[11px]"
        aria-label={ariaLabel}
      />
    );
  }

  const formatted =
    kind === 'json'
      ? JSON.stringify(value)
      : kind === 'number'
        ? String(value as number)
        : (value as string);

  return (
    <CommitInput
      key={`${kind}:${formatted}`}
      value={formatted}
      onCommit={(draft) => {
        if (kind === 'number') {
          const parsed = Number(draft);
          if (!draft.trim() || !Number.isFinite(parsed)) {
            onError(`${paramKey} must be a finite number.`);
            return formatted;
          }
          onChange(parsed);
          return String(parsed);
        }
        if (kind === 'json') {
          try {
            const parsed = JSON.parse(draft) as unknown;
            if (parsed === null || typeof parsed !== 'object') {
              onError(`${paramKey} must be a JSON object or array.`);
              return formatted;
            }
            onChange(parsed as JsonValue);
            return JSON.stringify(parsed);
          } catch {
            onError(`${paramKey} must contain valid JSON.`);
            return formatted;
          }
        }
        onChange(draft);
        return draft;
      }}
      className="h-7 px-2 font-mono text-[11px]"
      ariaLabel={ariaLabel}
    />
  );
}

export function ActionListEditor({
  actions,
  suggestions,
  title = 'Actions',
  addLabel = 'Add action',
  scopeLabel = 'Action',
  withTopBorder = true,
  disabled = false,
  onChange,
  onError,
}: {
  actions: GraphAction[];
  suggestions: string[];
  title?: string;
  addLabel?: string;
  scopeLabel?: string;
  withTopBorder?: boolean;
  disabled?: boolean;
  onChange: (actions: GraphAction[]) => void;
  onError: (message: string) => void;
}) {
  const [expandedActionIds, setExpandedActionIds] = useState<Set<string>>(
    () => new Set(),
  );

  const updateAction = (id: string, patch: Partial<GraphAction>) => {
    onChange(
      actions.map((action) =>
        action.id === id ? { ...action, ...patch } : action,
      ),
    );
  };

  const addParameter = (action: GraphAction) => {
    const currentParams = action.params ?? {};
    let index = Object.keys(currentParams).length + 1;
    let key = `parameter${index}`;
    while (key in currentParams) {
      index += 1;
      key = `parameter${index}`;
    }
    updateAction(action.id, { params: { ...currentParams, [key]: '' } });
  };

  const renameParameter = (
    action: GraphAction,
    oldKey: string,
    requestedKey: string,
  ) => {
    const currentParams = action.params ?? {};
    const nextKey = requestedKey.trim();
    if (!nextKey) {
      onError('Parameter keys cannot be empty.');
      return oldKey;
    }
    if (nextKey !== oldKey && nextKey in currentParams) {
      onError(`This action already has a ${nextKey} parameter.`);
      return oldKey;
    }
    const params = Object.fromEntries(
      Object.entries(currentParams).map(([key, paramValue]) => [
        key === oldKey ? nextKey : key,
        paramValue,
      ]),
    );
    updateAction(action.id, { params });
    return nextKey;
  };

  return (
    <section
      className={`space-y-2.5 ${withTopBorder ? 'border-t border-[var(--editor-border)] pt-4' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {title}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
            {actions.length
              ? `${actions.length} action${actions.length === 1 ? '' : 's'} · ${actions.length === 1 ? 'runs' : 'run'} in order`
              : 'None'}
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => {
            const id = makeActionId();
            setExpandedActionIds((current) => new Set(current).add(id));
            onChange([...actions, { id, type: '' }]);
          }}
        >
          <Plus />
          {addLabel}
        </Button>
      </div>

      {actions.map((action, actionIndex) => {
        const params = action.params ?? {};
        const parameterCount = Object.keys(params).length;
        return (
          <details
            key={action.id}
            open={expandedActionIds.has(action.id)}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExpandedActionIds((current) => {
                const next = new Set(current);
                if (open) next.add(action.id);
                else next.delete(action.id);
                return next;
              });
            }}
            className="group rounded-xl border border-[var(--editor-border)] bg-[var(--editor-panel-subtle)]"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-violet-100 font-mono text-[10px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                {actionIndex + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                {action.type || 'New action'}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {parameterCount
                  ? `${parameterCount} param${parameterCount === 1 ? '' : 's'}`
                  : 'No params'}
              </span>
              <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90 dark:text-slate-500">
                ▶
              </span>
            </summary>

            <div className="space-y-3 border-t border-[var(--editor-border)] px-3 pb-3 pt-2.5">
              <div className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                  Action name
                </span>
                <CommitInput
                  key={`action-name:${action.id}:${action.type}`}
                  value={action.type}
                  onCommit={(type) => updateAction(action.id, { type })}
                  suggestions={suggestions}
                  className="h-7 font-mono text-xs"
                  ariaLabel={`${scopeLabel} ${actionIndex + 1} name`}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                    Parameters
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => addParameter(action)}
                  >
                    <Plus />
                    Add
                  </Button>
                </div>

                {Object.entries(params).map(([key, value]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)_24px] items-center gap-1"
                  >
                    <CommitInput
                      value={key}
                      onCommit={(nextKey) =>
                        renameParameter(action, key, nextKey)
                      }
                      className="h-7 px-2 font-mono text-[11px]"
                      ariaLabel={`${action.type || 'Action'} parameter key`}
                    />
                    <select
                      value={actionParamKind(value)}
                      onChange={(event) =>
                        updateAction(action.id, {
                          params: {
                            ...params,
                            [key]: actionParamDefault(
                              event.target.value as ActionParamKind,
                            ),
                          },
                        })
                      }
                      className="h-7 rounded-lg border border-input bg-transparent px-1 text-[10px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 dark:bg-input/30"
                      aria-label={`${action.type || 'Action'} ${key} type`}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="null">Null</option>
                      <option value="json">JSON</option>
                    </select>
                    <ActionParamValueInput
                      actionType={action.type}
                      paramKey={key}
                      value={value}
                      onChange={(nextValue) =>
                        updateAction(action.id, {
                          params: { ...params, [key]: nextValue },
                        })
                      }
                      onError={onError}
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        const { [key]: _removed, ...remainingParams } = params;
                        updateAction(action.id, {
                          params:
                            Object.keys(remainingParams).length > 0
                              ? remainingParams
                              : undefined,
                        });
                      }}
                      aria-label={`Remove ${key} parameter`}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    onChange(
                      actions.filter((candidate) => candidate.id !== action.id),
                    )
                  }
                  className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                  aria-label={`Remove ${scopeLabel.toLowerCase()} ${action.type || actionIndex + 1}`}
                >
                  <Trash2 />
                  Remove action
                </Button>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={actionIndex === 0}
                    onClick={() => {
                      const next = [...actions];
                      [next[actionIndex - 1], next[actionIndex]] = [
                        next[actionIndex],
                        next[actionIndex - 1],
                      ];
                      onChange(next);
                    }}
                    aria-label={`Move ${action.type || `action ${actionIndex + 1}`} up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={actionIndex === actions.length - 1}
                    onClick={() => {
                      const next = [...actions];
                      [next[actionIndex], next[actionIndex + 1]] = [
                        next[actionIndex + 1],
                        next[actionIndex],
                      ];
                      onChange(next);
                    }}
                    aria-label={`Move ${action.type || `action ${actionIndex + 1}`} down`}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              </div>
            </div>
          </details>
        );
      })}
    </section>
  );
}
