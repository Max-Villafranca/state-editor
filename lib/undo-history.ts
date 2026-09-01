import { useCallback, useReducer, type SetStateAction } from 'react';

export type UndoHistory<T> = {
  past: T[];
  present: T;
  future: T[];
  transactionStart: T | null;
  limit: number;
};

export type UndoHistoryAction<T> =
  | { type: 'change'; update: SetStateAction<T> }
  | { type: 'change-transient'; update: SetStateAction<T> }
  | { type: 'begin-transaction' }
  | { type: 'commit-transaction' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T };

function resolveUpdate<T>(update: SetStateAction<T>, current: T) {
  return typeof update === 'function'
    ? (update as (value: T) => T)(current)
    : update;
}

function appendBounded<T>(values: T[], value: T, limit: number) {
  const next = [...values, value];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function createUndoHistory<T>(
  initialValue: T,
  limit = 75,
): UndoHistory<T> {
  return {
    past: [],
    present: initialValue,
    future: [],
    transactionStart: null,
    limit,
  };
}

export function reduceUndoHistory<T>(
  history: UndoHistory<T>,
  action: UndoHistoryAction<T>,
): UndoHistory<T> {
  if (action.type === 'reset') {
    return createUndoHistory(action.value, history.limit);
  }

  if (action.type === 'begin-transaction') {
    return history.transactionStart === null
      ? { ...history, transactionStart: history.present }
      : history;
  }

  if (action.type === 'change-transient') {
    const next = resolveUpdate(action.update, history.present);
    if (Object.is(next, history.present)) return history;
    return {
      ...history,
      present: next,
      transactionStart: history.transactionStart ?? history.present,
    };
  }

  if (action.type === 'commit-transaction') {
    if (history.transactionStart === null) return history;
    if (Object.is(history.transactionStart, history.present)) {
      return { ...history, transactionStart: null };
    }
    return {
      ...history,
      past: appendBounded(
        history.past,
        history.transactionStart,
        history.limit,
      ),
      future: [],
      transactionStart: null,
    };
  }

  if (action.type === 'change') {
    const next = resolveUpdate(action.update, history.present);
    if (Object.is(next, history.present)) return history;
    const previous = history.transactionStart ?? history.present;
    return {
      ...history,
      past: appendBounded(history.past, previous, history.limit),
      present: next,
      future: [],
      transactionStart: null,
    };
  }

  if (action.type === 'undo') {
    const previous = history.past.at(-1);
    if (previous === undefined) return history;
    return {
      ...history,
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
      transactionStart: null,
    };
  }

  const next = history.future[0];
  if (next === undefined) return history;
  return {
    ...history,
    past: appendBounded(history.past, history.present, history.limit),
    present: next,
    future: history.future.slice(1),
    transactionStart: null,
  };
}

export function useUndoableState<T>(initialValue: T | (() => T), limit = 75) {
  const [history, dispatch] = useReducer(reduceUndoHistory<T>, undefined, () =>
    createUndoHistory(
      typeof initialValue === 'function'
        ? (initialValue as () => T)()
        : initialValue,
      limit,
    ),
  );

  const change = useCallback((update: SetStateAction<T>) => {
    dispatch({ type: 'change', update });
  }, []);
  const changeTransient = useCallback((update: SetStateAction<T>) => {
    dispatch({ type: 'change-transient', update });
  }, []);
  const beginTransaction = useCallback(() => {
    dispatch({ type: 'begin-transaction' });
  }, []);
  const commitTransaction = useCallback(() => {
    dispatch({ type: 'commit-transaction' });
  }, []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback(
    (value: T) => dispatch({ type: 'reset', value }),
    [],
  );

  return {
    value: history.present,
    change,
    changeTransient,
    beginTransaction,
    commitTransaction,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
