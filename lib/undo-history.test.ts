import { describe, expect, it } from 'vitest';

import {
  createUndoHistory,
  reduceUndoHistory,
  type UndoHistory,
  type UndoHistoryAction,
} from './undo-history';

function apply<T>(history: UndoHistory<T>, ...actions: UndoHistoryAction<T>[]) {
  return actions.reduce(reduceUndoHistory, history);
}

describe('undo history', () => {
  it('undoes and redoes a meaningful edit', () => {
    const changed = apply(createUndoHistory('idle'), {
      type: 'change',
      update: 'ringing',
    });
    const undone = reduceUndoHistory(changed, { type: 'undo' });
    const redone = reduceUndoHistory(undone, { type: 'redo' });

    expect(undone.present).toBe('idle');
    expect(redone.present).toBe('ringing');
  });

  it('clears redo when a new edit branches from an undone state', () => {
    const history = apply(
      createUndoHistory(0),
      { type: 'change', update: 1 },
      { type: 'change', update: 2 },
      { type: 'undo' },
      { type: 'change', update: 3 },
    );

    expect(history.present).toBe(3);
    expect(history.future).toEqual([]);
  });

  it('coalesces all transient drag positions into one undo step', () => {
    const start = { x: 0, y: 0 };
    const history = apply(
      createUndoHistory(start),
      { type: 'begin-transaction' },
      { type: 'change-transient', update: { x: 10, y: 5 } },
      { type: 'change-transient', update: { x: 30, y: 20 } },
      { type: 'commit-transaction' },
    );

    expect(history.past).toEqual([start]);
    expect(reduceUndoHistory(history, { type: 'undo' }).present).toBe(start);
  });

  it('resets history when opening or creating a different project', () => {
    const history = apply(
      createUndoHistory('first'),
      { type: 'change', update: 'edited' },
      { type: 'reset', value: 'opened' },
    );

    expect(history).toMatchObject({
      past: [],
      present: 'opened',
      future: [],
      transactionStart: null,
    });
  });

  it('bounds retained snapshots', () => {
    const history = apply(
      createUndoHistory(0, 2),
      { type: 'change', update: 1 },
      { type: 'change', update: 2 },
      { type: 'change', update: 3 },
    );

    expect(history.past).toEqual([1, 2]);
  });
});
