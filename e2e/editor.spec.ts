import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';

const importedMachine = {
  id: 'crmWorkflow',
  initial: 'queued',
  states: {
    queued: { on: { PROCESS: { target: 'complete' } } },
    complete: { type: 'final' },
  },
};

async function createMachine(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create machine' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create machine' });
  await dialog.getByLabel('Machine name').fill('crmWorkflow');
  await dialog.getByLabel('Initial state').fill('queued');
  await dialog.getByRole('button', { name: 'Create machine' }).click();
  await expect(page.getByRole('textbox', { name: 'Machine name' })).toHaveValue(
    'crmWorkflow',
  );
  await expect(
    page.getByText(/use Add state or double-click empty canvas/i),
  ).toHaveCount(0);
}

test('a fresh workspace is blocked until a machine is created or opened', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('img', { name: 'Mini Map' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Show minimap' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Create or open a machine' }),
  ).toBeVisible();
  await expect(
    page.getByText(/use Add state or double-click empty canvas/i),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Machine id' })).toHaveCount(
    0,
  );

  const viewport = page.locator('.react-flow__viewport');
  const pane = page.locator('.react-flow__pane');
  const paneBox = await requiredBox(pane);
  const transformBefore = await viewportTransform(viewport);
  await dragPointer(
    page,
    { x: paneBox.x + 80, y: paneBox.y + 80 },
    { x: paneBox.x + 150, y: paneBox.y + 130 },
    'middle',
  );
  await expect.poll(() => viewportTransform(viewport)).toBe(transformBefore);
});

test('a recovered project keeps its project filename after refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'remembered.se.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'state-editor-project',
        version: 1,
        xstateTarget: 'v6-machine-json',
        machine: { id: 'remembered', initial: 'idle', states: { idle: {} } },
        editor: {
          nodes: { idle: { x: 100, y: 100 } },
          viewport: { x: 0, y: 0, zoom: 1 },
          selection: { kind: 'machine', id: 'machine' },
        },
      }),
    ),
  });
  await expect(
    page.getByText('State Editor · remembered.se.json'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('State Editor · remembered.se.json'),
  ).toBeVisible();
});

test('Save, Save As, and Export JSON keep distinct file contracts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const pickerCalls: Array<{
      suggestedName: string;
      writes: string[];
    }> = [];
    Object.defineProperty(window, '__pickerCalls', { value: pickerCalls });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async (options: { suggestedName: string }) => {
        const record: { suggestedName: string; writes: string[] } = {
          suggestedName: options.suggestedName,
          writes: [],
        };
        pickerCalls.push(record);
        return {
          name: options.suggestedName,
          createWritable: async () => ({
            write: async (contents: string) => record.writes.push(contents),
            close: async () => undefined,
          }),
        };
      },
    });
  });
  await createMachine(page);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => pickerState(page)).toMatchObject({ callCount: 1 });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() => pickerState(page))
    .toMatchObject({
      callCount: 1,
      firstWriteCount: 2,
    });

  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();

  const files = await page.evaluate(() => {
    const calls = (
      window as unknown as {
        __pickerCalls: Array<{ suggestedName: string; writes: string[] }>;
      }
    ).__pickerCalls;
    return calls.map((call) => ({
      suggestedName: call.suggestedName,
      payload: JSON.parse(call.writes.at(-1) ?? 'null'),
    }));
  });

  expect(files).toHaveLength(3);
  expect(files[0]).toMatchObject({
    suggestedName: 'crmWorkflow.se.json',
    payload: {
      format: 'state-editor-project',
      version: 1,
      machine: { id: 'crmWorkflow', initial: 'queued' },
      editor: { nodes: { queued: expect.any(Object) } },
    },
  });
  expect(files[1].suggestedName).toBe('crmWorkflow.se.json');
  expect(files[2]).toEqual({
    suggestedName: 'crmWorkflow.json',
    payload: {
      id: 'crmWorkflow',
      initial: 'queued',
      states: { queued: {} },
    },
  });
});

test('a machine can be created, simulated, recovered, and resumed', async ({
  page,
}) => {
  await createMachine(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: 'crmWorkflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedMachine)),
  });
  await expect(page.getByText('Imported crmWorkflow.json')).toBeVisible();

  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(
    page.getByText('Transitions are hidden while you choose events'),
  ).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'PROCESS' }).click();
  await expect(page.getByText('Machine complete')).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Show minimap' }).click();
  await page.getByRole('button', { name: 'Hide minimap' }).click();
  await page.reload();

  await expect(page.getByRole('textbox', { name: 'Machine name' })).toHaveValue(
    'crmWorkflow',
  );
  await expect(page.getByRole('button', { name: 'Simulate' })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Show minimap' }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mini Map' })).toHaveCount(0);
});

test('state and transition actions remain compact and export clean XState JSON', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__actionExportWrites', { value: writes });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'crmWorkflow.json',
        createWritable: async () => ({
          write: async (contents: string) => writes.push(contents),
          close: async () => undefined,
        }),
      }),
    });
  });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'crmWorkflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedMachine)),
  });
  await expect(page.getByText('Imported crmWorkflow.json')).toBeVisible();

  await page.getByRole('button', { name: 'Select transition PROCESS' }).click();
  await expect(page.getByText('Selected transition')).toBeVisible();
  await expectSuggestion(page.getByLabel('Transition event'), 'PROCESS');
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByLabel('Action 1 name').fill('scheduleCallback');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const parameterKey = page.getByLabel('scheduleCallback parameter key');
  await parameterKey.fill('cooldownMinutes');
  await parameterKey.press('Tab');
  await page
    .getByLabel('scheduleCallback cooldownMinutes type')
    .selectOption('number');
  const parameterValue = page.getByLabel(
    'scheduleCallback cooldownMinutes value',
  );
  await parameterValue.fill('120');
  await parameterValue.press('Tab');

  await page.getByRole('button', { name: 'Add action' }).click();
  await expectSuggestion(page.getByLabel('Action 2 name'), 'scheduleCallback');
  await page.getByLabel('Action 2 name').fill('recordAttempt');
  await page.getByLabel('Action 2 name').press('Tab');
  await expect(page.getByText('1 param', { exact: true })).toBeVisible();
  await expect(page.getByText('No params', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move recordAttempt up' }).click();

  await page.getByRole('button', { name: 'queued', exact: true }).click();
  await expect(page.getByText('Selected state')).toBeVisible();
  await page.getByRole('button', { name: 'Add entry action' }).click();
  await page.getByLabel('Entry action 1 name').fill('initializeState');
  await page.getByLabel('Entry action 1 name').press('Tab');
  const entryActions = page.locator('section').filter({
    has: page.getByText('Entry actions', { exact: true }),
  });
  await entryActions.getByRole('button', { name: 'Add', exact: true }).click();
  const entryParameterKey = page.getByLabel('initializeState parameter key');
  await expectSuggestion(entryParameterKey, 'cooldownMinutes');
  const entryParameterValue = page.getByLabel(
    'initializeState parameter1 value',
  );
  const entryParameterType = page.getByLabel('initializeState parameter1 type');
  const entryKeyBox = await requiredBox(entryParameterKey);
  const entryValueBox = await requiredBox(entryParameterValue);
  const entryTypeBox = await requiredBox(entryParameterType);
  expect(entryValueBox.y).toBeGreaterThan(entryKeyBox.y + entryKeyBox.height);
  expect(Math.abs(entryTypeBox.y - entryValueBox.y)).toBeLessThan(2);
  expect(entryValueBox.x).toBeGreaterThan(entryTypeBox.x + entryTypeBox.width);
  expect(entryKeyBox.width).toBeGreaterThan(entryValueBox.width);

  await page.getByRole('button', { name: 'complete', exact: true }).click();
  await page.getByRole('button', { name: 'queued', exact: true }).click();
  await expect(entryParameterKey).toBeVisible();
  await page
    .getByRole('button', { name: 'Remove parameter1 parameter' })
    .click();
  await page.getByRole('button', { name: 'Add exit action' }).click();
  await page.getByLabel('Exit action 1 name').fill('cleanupState');
  await page.getByLabel('Exit action 1 name').press('Tab');

  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = await page.evaluate(() => {
    const writes = (window as unknown as { __actionExportWrites: string[] })
      .__actionExportWrites;
    return JSON.parse(writes.at(-1) ?? 'null');
  });
  expect(exported.states.queued.on.PROCESS).toEqual({
    target: 'complete',
    actions: [
      { type: 'recordAttempt' },
      {
        type: 'scheduleCallback',
        params: { cooldownMinutes: 120 },
      },
    ],
  });
  expect(exported.states.queued.entry).toEqual([{ type: 'initializeState' }]);
  expect(exported.states.queued.exit).toEqual([{ type: 'cleanupState' }]);

  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(
    page.getByText(
      'Named actions are shown here but integrations are not executed in the local simulation.',
    ),
  ).toBeVisible();
  await expect(page.getByText('2 actions', { exact: true })).toBeVisible();
});

test('parallel transitions share one route while reciprocal routes stay separate', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'parallel-routes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'parallelRoutes',
        initial: 'waiting',
        states: {
          waiting: {
            on: {
              ANSWERED: { target: 'connected' },
              VOICEMAIL: { target: 'connected' },
            },
          },
          connected: {
            on: { RETRY: { target: 'waiting' } },
          },
        },
      }),
    ),
  });
  await expect(page.getByText('Imported parallel-routes.json')).toBeVisible();
  await page.waitForTimeout(350);

  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Select transition ANSWERED' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select transition VOICEMAIL' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select transition RETRY' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Select transition VOICEMAIL' })
    .click();
  await expect(page.getByLabel('Transition event')).toHaveValue('VOICEMAIL');

  const routeLabel = page.getByLabel('Transitions from waiting to connected');
  const routeLabelVisuals = await routeLabel.evaluate((element) => {
    const stateNode = document.querySelector('.react-flow__node > div');
    const labelStyle = getComputedStyle(element);
    return {
      borderWidth: labelStyle.borderTopWidth,
      labelBackground: labelStyle.backgroundColor,
      stateBackground: stateNode
        ? getComputedStyle(stateNode).backgroundColor
        : null,
      zIndex: labelStyle.zIndex,
    };
  });
  expect(routeLabelVisuals).toMatchObject({
    borderWidth: '0px',
    zIndex: '20',
  });
  expect(routeLabelVisuals.labelBackground).not.toBe(
    routeLabelVisuals.stateBackground,
  );

  const paths = await page
    .locator('.react-flow__edge-path')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('d')),
    );
  expect(new Set(paths).size).toBe(2);
});

test('machine analysis separates cycles, paths, and node connections', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'analysis.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'analysis',
        initial: 'start',
        states: {
          start: {
            on: {
              ENTER: { target: 'A' },
              DIRECT: { target: 'done' },
            },
          },
          A: { on: { NEXT: { target: 'B' } } },
          B: {
            on: {
              RETRY: { target: 'A' },
              FINISH: { target: 'done' },
            },
          },
          done: { type: 'final' },
        },
      }),
    ),
  });

  await page.getByRole('tab', { name: 'Analysis' }).click();
  await expect(
    page
      .getByRole('tablist', { name: 'Analysis view' })
      .getByRole('tab')
      .allTextContents(),
  ).resolves.toEqual(['Paths2', 'Nodes4', 'Cycles1']);
  await expect(page.getByRole('tab', { name: /^Paths/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Length').first()).toBeVisible();
  await expect(page.getByText('3', { exact: true })).toBeVisible();
  await expect(page.getByText('Ends at').first()).toBeVisible();
  await expect(page.locator('aside').getByText('Final state')).toHaveCount(0);
  await expect(page.locator('aside').getByText('Terminal state')).toHaveCount(
    0,
  );

  const longestPath = page.locator('[data-analysis-path="1"]');
  await longestPath.click();
  await expect(longestPath).toHaveAttribute('aria-pressed', 'true');
  for (const state of ['start', 'A', 'B', 'done']) {
    await expect(
      page.locator(`.react-flow__node[data-id="${state}"] > div`),
    ).toHaveAttribute('data-analysis-highlighted', 'true');
  }
  for (const route of ['start->A', 'A->B', 'B->done']) {
    await expect(
      page.locator(`[data-transition-route="${route}"]`),
    ).toHaveAttribute('data-analysis-highlighted', 'true');
  }

  await page.getByRole('tab', { name: /^Nodes/ }).click();
  await expect(page.getByRole('button', { name: 'Incoming' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const nodeA = page.getByRole('button', { name: 'Locate node A' });
  await nodeA.click();
  await expect(nodeA).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.react-flow__node[data-id="A"] > div'),
  ).toHaveAttribute('data-analysis-highlighted', 'true');
  for (const route of ['start->A', 'B->A']) {
    await expect(
      page.locator(`[data-transition-route="${route}"]`),
    ).toHaveAttribute('data-analysis-highlighted', 'true');
  }

  await page.getByRole('button', { name: 'Outgoing' }).click();
  await expect(page.getByRole('button', { name: 'Outgoing' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await nodeA.click();
  await expect(page.locator('[data-transition-route="A->B"]')).toHaveAttribute(
    'data-analysis-highlighted',
    'true',
  );

  await page.getByRole('tab', { name: /^Cycles/ }).click();
  const cycle = page.getByRole('button', {
    name: 'Highlight cycle 1: entry 1, cycle 2, exit 1',
  });
  await expect(cycle).toBeVisible();
  await expect(cycle.getByText('Entry')).toBeVisible();
  await expect(cycle.getByText('Cycle')).toBeVisible();
  await expect(cycle.getByText('Exit')).toBeVisible();
  await expect(cycle.getByText('done')).toBeVisible();
  await expect(longestPath).toHaveCount(0);
  await cycle.click();
  await expect(cycle).toHaveAttribute('aria-pressed', 'true');
  for (const state of ['A', 'B']) {
    await expect(
      page.locator(`.react-flow__node[data-id="${state}"] > div`),
    ).toHaveAttribute('data-analysis-highlighted', 'true');
  }
  for (const route of ['A->B', 'B->A']) {
    await expect(
      page.locator(`[data-transition-route="${route}"]`),
    ).toHaveAttribute('data-analysis-highlighted', 'true');
  }
  for (const state of ['start', 'done']) {
    await expect(
      page.locator(`.react-flow__node[data-id="${state}"] > div`),
    ).toHaveAttribute('data-analysis-context-highlighted', 'true');
  }
  for (const route of ['start->A', 'B->done']) {
    await expect(
      page.locator(`[data-transition-route="${route}"]`),
    ).toHaveAttribute('data-analysis-context-highlighted', 'true');
  }

  const edgeLayer = async (routeId: string) =>
    page
      .locator(`.react-flow__edge[data-id="${routeId}"]`)
      .evaluate((element) => {
        const edgeLayerElement = element.parentElement;
        return edgeLayerElement
          ? Number(getComputedStyle(edgeLayerElement).zIndex)
          : Number.NaN;
      });
  const labelLayer = async (route: string) =>
    page
      .locator(`[data-transition-route="${route}"]`)
      .evaluate((element) => Number(getComputedStyle(element).zIndex));

  expect(await edgeLayer('transition-route:A:B')).toBeGreaterThan(
    await edgeLayer('transition-route:start:A'),
  );
  expect(await edgeLayer('transition-route:start:A')).toBeGreaterThan(
    await edgeLayer('transition-route:start:done'),
  );
  expect(await labelLayer('A->B')).toBeGreaterThan(
    await labelLayer('start->A'),
  );
  expect(await labelLayer('start->A')).toBeGreaterThan(
    await labelLayer('start->done'),
  );
  await expect(page.getByRole('tab', { name: 'Analysis' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Issues', { exact: true })).toHaveCount(0);
});

test('drag selection moves multiple nodes while middle-click and Space drag pan', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'selection.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'selectionDemo',
        initial: 'one',
        states: {
          one: {},
          two: {},
          three: {},
        },
      }),
    ),
  });
  await expect(page.getByText('Imported selection.json')).toBeVisible();
  await page.waitForTimeout(350);

  const first = page.locator('.react-flow__node[data-id="one"]');
  const second = page.locator('.react-flow__node[data-id="two"]');
  const third = page.locator('.react-flow__node[data-id="three"]');
  await expect(first).toBeVisible();

  const firstBox = await requiredBox(first);
  const secondBox = await requiredBox(second);
  const selectionPaneBox = await requiredBox(page.locator('.react-flow__pane'));
  await dragPointer(
    page,
    {
      x: Math.max(
        selectionPaneBox.x + 4,
        Math.min(firstBox.x, secondBox.x) - 16,
      ),
      y: Math.max(
        selectionPaneBox.y + 4,
        Math.min(firstBox.y, secondBox.y) - 16,
      ),
    },
    {
      x:
        Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width) +
        16,
      y:
        Math.max(firstBox.y + firstBox.height, secondBox.y + secondBox.height) +
        16,
    },
  );

  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await expect(first).toHaveClass(/selected/);
  await expect(second).toHaveClass(/selected/);
  await expect(third).not.toHaveClass(/selected/);

  const beforeFirstMove = await requiredBox(first);
  const beforeSecondMove = await requiredBox(second);
  const moveBy = { x: 70, y: 45 };
  await dragPointer(page, centerOf(beforeFirstMove), {
    x: centerOf(beforeFirstMove).x + moveBy.x,
    y: centerOf(beforeFirstMove).y + moveBy.y,
  });
  const afterFirstMove = await requiredBox(first);
  const afterSecondMove = await requiredBox(second);
  const firstDelta = {
    x: afterFirstMove.x - beforeFirstMove.x,
    y: afterFirstMove.y - beforeFirstMove.y,
  };
  const secondDelta = {
    x: afterSecondMove.x - beforeSecondMove.x,
    y: afterSecondMove.y - beforeSecondMove.y,
  };
  expect(firstDelta.x).toBeGreaterThan(30);
  expect(firstDelta.y).toBeGreaterThan(20);
  expect(secondDelta.x).toBeCloseTo(firstDelta.x, 0);
  expect(secondDelta.y).toBeCloseTo(firstDelta.y, 0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectPositionNear(first, beforeFirstMove);
  await expectPositionNear(second, beforeSecondMove);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();

  await page.getByRole('button', { name: 'Redo' }).click();
  await expectPositionNear(first, afterFirstMove);
  await expectPositionNear(second, afterSecondMove);

  await page.keyboard.press('Control+z');
  await expectPositionNear(first, beforeFirstMove);
  await page.keyboard.press('Control+Shift+z');
  await expectPositionNear(first, afterFirstMove);

  const pane = page.locator('.react-flow__pane');
  const paneBox = await requiredBox(pane);
  await expect(pane).toHaveCSS('cursor', 'default');
  const viewport = page.locator('.react-flow__viewport');
  const beforeMiddlePan = await viewportTransform(viewport);
  await dragPointer(
    page,
    { x: paneBox.x + paneBox.width - 120, y: paneBox.y + 90 },
    { x: paneBox.x + paneBox.width - 70, y: paneBox.y + 120 },
    'middle',
  );
  await expect
    .poll(() => viewportTransform(viewport))
    .not.toBe(beforeMiddlePan);

  const beforeSpacePan = await viewportTransform(viewport);
  await page.keyboard.down('Space');
  await dragPointer(
    page,
    { x: paneBox.x + 110, y: paneBox.y + 90 },
    { x: paneBox.x + 155, y: paneBox.y + 125 },
  );
  await page.keyboard.up('Space');
  await expect.poll(() => viewportTransform(viewport)).not.toBe(beforeSpacePan);
});

test('grouping the global initial state preserves both initial scopes on export', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__groupInitialExportWrites', {
      value: writes,
    });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'groupInitial.json',
        createWritable: async () => ({
          write: async (contents: string) => writes.push(contents),
          close: async () => undefined,
        }),
      }),
    });
  });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'groupInitial.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'groupInitial',
        initial: 'two',
        states: { one: {}, two: {}, three: {} },
      }),
    ),
  });
  await expect(page.getByText('Imported groupInitial.json')).toBeVisible();
  await page.waitForTimeout(350);

  const first = page.locator('.react-flow__node[data-id="one"]');
  const second = page.locator('.react-flow__node[data-id="two"]');
  const paneBox = await requiredBox(page.locator('.react-flow__pane'));
  const firstBox = await requiredBox(first);
  const secondBox = await requiredBox(second);
  await dragPointer(
    page,
    {
      x: Math.max(paneBox.x + 4, Math.min(firstBox.x, secondBox.x) - 16),
      y: Math.max(paneBox.y + 4, Math.min(firstBox.y, secondBox.y) - 16),
    },
    {
      x:
        Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width) +
        16,
      y:
        Math.max(firstBox.y + firstBox.height, secondBox.y + secondBox.height) +
        16,
    },
  );
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);

  const properties = page.locator('aside');
  await expect(
    properties.getByRole('heading', { name: '2 states selected' }),
  ).toBeVisible();
  await expect(properties.getByLabel('State key', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page
      .locator('header')
      .getByRole('button', { name: 'Create parent', exact: true }),
  ).toHaveCount(0);
  await properties
    .getByRole('button', { name: 'Create parent', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create parent state' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    properties.getByRole('heading', { name: '2 states selected' }),
  ).toBeVisible();
  await properties
    .getByRole('button', { name: 'Create parent', exact: true })
    .click();
  await dialog.getByLabel('Parent state name').fill('workflow');
  await expect(dialog.getByLabel('Initial child')).toHaveValue('two');
  await dialog
    .getByRole('button', { name: 'Create parent', exact: true })
    .click();

  const parent = page.locator('.react-flow__node[data-id="workflow"]');
  await expect(parent).toBeVisible();
  await expect(
    page
      .locator('.react-flow__node[data-id="two"]')
      .getByLabel('Initial child state'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = await page.evaluate(() => {
    const writes = (
      window as unknown as { __groupInitialExportWrites: string[] }
    ).__groupInitialExportWrites;
    return JSON.parse(writes.at(-1) ?? 'null');
  });
  expect(exported.initial).toBe('workflow');
  expect(exported.states.workflow.initial).toBe('two');
  expect(Object.keys(exported.states.workflow.states)).toEqual(['one', 'two']);
  expect(exported.states.three).toEqual({ id: 'three' });
  await expect(properties.getByLabel('State key', { exact: true })).toHaveValue(
    'workflow',
  );
  await expect(
    properties.getByRole('button', { name: 'Create parent', exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Edit machine details', exact: true })
    .click();
  await page.getByRole('button', { name: 'one', exact: true }).click();
  await page.keyboard.down('Control');
  await page.getByRole('button', { name: 'three', exact: true }).click();
  await page.keyboard.up('Control');
  await expect(
    properties.getByRole('heading', { name: '2 states selected' }),
  ).toBeVisible();
  await expect(
    properties.getByRole('button', { name: 'Create parent', exact: true }),
  ).toBeDisabled();
  await expect(
    properties.getByText('Select states that share the same parent.'),
  ).toBeVisible();
  await page.keyboard.down('Control');
  await page.getByRole('button', { name: 'three', exact: true }).click();
  await page.keyboard.up('Control');
  await expect(properties.getByLabel('State key', { exact: true })).toHaveValue(
    'one',
  );
  await expect(
    properties.getByRole('heading', { name: '2 states selected' }),
  ).toHaveCount(0);
});
test('duplicating a state copies its data into an offset visual node', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__duplicateExportWrites', { value: writes });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'duplicateDemo.json',
        createWritable: async () => ({
          write: async (contents: string) => writes.push(contents),
          close: async () => undefined,
        }),
      }),
    });
  });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'duplicateDemo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'duplicateDemo',
        initial: 'configured',
        states: {
          configured: {
            description: 'Carries reusable behavior',
            tags: ['reusable'],
            meta: { priority: 3 },
            entry: [{ type: 'prepare', params: { mode: 'safe' } }],
            exit: [{ type: 'cleanup' }],
          },
          finished: { type: 'final' },
        },
      }),
    ),
  });
  await expect(page.getByText('Imported duplicateDemo.json')).toBeVisible();

  const original = page.locator('.react-flow__node[data-id="configured"]');
  const originalBox = await requiredBox(original);
  await page.getByRole('button', { name: 'configured', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate state' }).click();

  const duplicate = page.locator('.react-flow__node[data-id="configuredCopy"]');
  await expect(duplicate).toBeVisible();
  const duplicateBox = await requiredBox(duplicate);
  expect(duplicateBox.x).toBeGreaterThan(originalBox.x + 20);
  expect(duplicateBox.y).toBeGreaterThan(originalBox.y + 20);
  await expect(page.getByLabel('State key')).toHaveValue('configuredCopy');
  await expect(page.getByLabel('State description')).toHaveValue(
    'Carries reusable behavior',
  );
  await expect(page.getByLabel('State tags')).toHaveValue('reusable');
  await expect(
    page.locator('summary').getByText('prepare', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('summary').getByText('cleanup', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'finished', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate state' }).click();
  const finalDuplicate = page.locator(
    '.react-flow__node[data-id="finishedCopy"]',
  );
  await expect(finalDuplicate).toBeVisible();
  await expect(finalDuplicate.getByLabel('Final state')).toBeVisible();

  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = await page.evaluate(() => {
    const writes = (window as unknown as { __duplicateExportWrites: string[] })
      .__duplicateExportWrites;
    return JSON.parse(writes.at(-1) ?? 'null');
  });
  expect(exported.states.configuredCopy).toEqual(exported.states.configured);
  expect(exported.states.finishedCopy).toEqual({ type: 'final' });
});

test('double-clicking empty canvas creates a state without zooming', async ({
  page,
}) => {
  await createMachine(page);
  const pane = page.locator('.react-flow__pane');
  const paneBox = await requiredBox(pane);
  const viewport = page.locator('.react-flow__viewport');
  await page.waitForTimeout(350);
  const transformBefore = await viewportTransform(viewport);
  const nodes = page.locator('.react-flow__node');
  await expect(nodes).toHaveCount(1);

  await page.mouse.dblclick(paneBox.x + paneBox.width - 140, paneBox.y + 100, {
    delay: 80,
  });

  await expect(nodes).toHaveCount(2);
  await expect.poll(() => viewportTransform(viewport)).toBe(transformBefore);
});

test('parent transitions float on the frame while ordinary transitions keep node handles', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'routing.se.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'state-editor-project',
        version: 1,
        xstateTarget: 'v6-machine-json',
        machine: {
          id: 'routingDemo',
          initial: 'group',
          states: {
            group: {
              initial: 'inside',
              states: { inside: {} },
              on: { LEAVE: { target: 'outside' } },
            },
            outside: { on: { RETURN: { target: 'group' } } },
            leafA: { on: { NEXT: { target: 'leafB' } } },
            leafB: {},
          },
        },
        editor: {
          nodes: {
            group: { x: 80, y: 80 },
            inside: { x: 48, y: 76 },
            outside: { x: 620, y: 180 },
            leafA: { x: 100, y: 520 },
            leafB: { x: 620, y: 520 },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          selection: { kind: 'machine', id: 'machine' },
        },
      }),
    ),
  });
  await expect(page.getByText('Opened routing.se.json')).toBeVisible();
  await expect(
    page.locator('[data-transition-route="group->outside"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-transition-route="outside->group"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-transition-route="leafA->leafB"]'),
  ).toBeVisible();

  const readGeometry = () =>
    page.evaluate(() => {
      type Point = { x: number; y: number };
      const routeEndpoints = (routeId: string) => {
        const path = document.querySelector<SVGPathElement>(
          `.react-flow__edge[data-id="${routeId}"] .react-flow__edge-path`,
        );
        if (!path) return null;
        const numbers = (
          path.getAttribute('d')?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
        ).map(Number);
        const matrix = path.getScreenCTM();
        const svg = path.ownerSVGElement;
        if (numbers.length < 4 || !matrix || !svg) return null;
        const toScreen = (x: number, y: number): Point => {
          const point = svg.createSVGPoint();
          point.x = x;
          point.y = y;
          const transformed = point.matrixTransform(matrix);
          return { x: transformed.x, y: transformed.y };
        };
        return {
          start: toScreen(numbers[0], numbers[1]),
          end: toScreen(numbers.at(-2)!, numbers.at(-1)!),
        };
      };
      const center = (element: Element | null): Point | null => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const distance = (first: Point, second: Point) =>
        Math.hypot(first.x - second.x, first.y - second.y);
      const onBoundary = (point: Point, box: DOMRect) => {
        const inside =
          point.x >= box.left - 2 &&
          point.x <= box.right + 2 &&
          point.y >= box.top - 2 &&
          point.y <= box.bottom + 2;
        const sideDistance = Math.min(
          Math.abs(point.x - box.left),
          Math.abs(point.x - box.right),
          Math.abs(point.y - box.top),
          Math.abs(point.y - box.bottom),
        );
        return inside && sideDistance < 3;
      };
      const parent = document.querySelector(
        '.react-flow__node[data-id="group"]',
      );
      const outside = document.querySelector(
        '.react-flow__node[data-id="outside"]',
      );
      const leafA = document.querySelector(
        '.react-flow__node[data-id="leafA"]',
      );
      const leafB = document.querySelector(
        '.react-flow__node[data-id="leafB"]',
      );
      const outbound = routeEndpoints('transition-route:group:outside');
      const inbound = routeEndpoints('transition-route:outside:group');
      const ordinary = routeEndpoints('transition-route:leafA:leafB');
      const outsideInput = center(
        outside?.querySelector('.react-flow__handle-left') ?? null,
      );
      const outsideOutput = center(
        outside?.querySelector('.react-flow__handle-right') ?? null,
      );
      const leafOutput = center(
        leafA?.querySelector('.react-flow__handle-right') ?? null,
      );
      const leafInput = center(
        leafB?.querySelector('.react-flow__handle-left') ?? null,
      );
      if (
        !parent ||
        !outbound ||
        !inbound ||
        !ordinary ||
        !outsideInput ||
        !outsideOutput ||
        !leafOutput ||
        !leafInput
      )
        return null;
      const parentBox = parent.getBoundingClientRect();
      return {
        outboundStartsOnFrame: onBoundary(outbound.start, parentBox),
        inboundEndsOnFrame: onBoundary(inbound.end, parentBox),
        separatedFrameEndpoints: distance(outbound.start, inbound.end),
        outboundLeafDistance: distance(outbound.end, outsideInput),
        inboundLeafDistance: distance(inbound.start, outsideOutput),
        ordinarySourceDistance: distance(ordinary.start, leafOutput),
        ordinaryTargetDistance: distance(ordinary.end, leafInput),
      };
    });
  await expect.poll(readGeometry).not.toBeNull();
  const geometry = await readGeometry();

  expect(geometry).toMatchObject({
    outboundStartsOnFrame: true,
    inboundEndsOnFrame: true,
  });
  expect(geometry!.separatedFrameEndpoints).toBeGreaterThan(10);
  expect(
    Math.max(
      geometry!.outboundLeafDistance,
      geometry!.inboundLeafDistance,
      geometry!.ordinarySourceDistance,
      geometry!.ordinaryTargetDistance,
    ),
  ).toBeLessThan(7);
});
test('deleting a parent keeps child transitions and uses one undo step', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__parentExportWrites', { value: writes });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'parentDemo.json',
        createWritable: async () => ({
          write: async (contents: string) => writes.push(contents),
          close: async () => undefined,
        }),
      }),
    });
  });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'parentDemo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'parentDemo',
        initial: 'contacting',
        states: {
          contacting: {
            initial: 'calling',
            states: {
              calling: { on: { VOICEMAIL: { target: 'voicemail' } } },
              voicemail: {},
            },
          },
          done: { type: 'final' },
        },
      }),
    ),
  });
  await expect(
    page.getByRole('button', { name: 'contacting', exact: true }),
  ).toBeVisible();
  const newState = page.locator('.react-flow__node[data-id="done"]');
  const parentFrame = page.locator('.react-flow__node[data-id="contacting"]');
  const initialChild = page.locator('.react-flow__node[data-id="calling"]');
  const parentInput = parentFrame.locator('.react-flow__handle-left');
  const parentOutput = parentFrame.locator('.react-flow__handle-right');
  await expect(parentInput).toHaveCount(1);
  await expect(parentOutput).toHaveCount(1);
  await expect(initialChild.getByLabel('Initial child state')).toBeVisible();
  await expect
    .poll(async () => {
      const frameBox = await requiredBox(parentFrame);
      const inputBox = await requiredBox(parentInput);
      const outputBox = await requiredBox(parentOutput);
      const centerY = frameBox.y + frameBox.height / 2;
      return Math.max(
        Math.abs(inputBox.y + inputBox.height / 2 - centerY),
        Math.abs(outputBox.y + outputBox.height / 2 - centerY),
      );
    })
    .toBeLessThan(2);
  expect((await requiredBox(parentInput)).width).toBeGreaterThanOrEqual(16);
  expect((await requiredBox(parentOutput)).width).toBeGreaterThanOrEqual(16);
  const newStateBox = await requiredBox(newState);
  const parentFrameBox = await requiredBox(parentFrame);
  await dragPointer(page, centerOf(newStateBox), {
    x: parentFrameBox.x + parentFrameBox.width - 80,
    y: parentFrameBox.y + parentFrameBox.height - 60,
  });
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const groupedExport = await page.evaluate(() =>
    JSON.parse(
      (
        window as unknown as { __parentExportWrites: string[] }
      ).__parentExportWrites.at(-1) ?? 'null',
    ),
  );
  expect(groupedExport.states.contacting.states.done).toEqual({
    id: 'done',
    type: 'final',
  });
  const stacking = await page.evaluate(() => {
    const parent = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="contacting"]',
    );
    const child = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="calling"]',
    );
    const edge = document.querySelector<HTMLElement>('.react-flow__edge');
    const zIndex = (element: HTMLElement | null) => {
      const parsed = Number.parseInt(getComputedStyle(element!).zIndex, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      parent: zIndex(parent),
      edge: zIndex(edge?.parentElement as HTMLElement | null),
      child: zIndex(child),
    };
  });
  expect(stacking.edge).toBeGreaterThan(stacking.parent);
  expect(stacking.child).toBeGreaterThan(stacking.edge);
  await page.getByRole('button', { name: 'contacting', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(
    page.getByRole('button', { name: 'contacting', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'calling', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'voicemail', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = await page.evaluate(() =>
    JSON.parse(
      (
        window as unknown as { __parentExportWrites: string[] }
      ).__parentExportWrites.at(-1) ?? 'null',
    ),
  );
  expect(exported.states.calling.on.VOICEMAIL.target).toBe('voicemail');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.getByRole('button', { name: 'contacting', exact: true }),
  ).toBeVisible();
});

async function pickerState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const calls = (
      window as unknown as {
        __pickerCalls: Array<{ suggestedName: string; writes: string[] }>;
      }
    ).__pickerCalls;
    return {
      callCount: calls.length,
      firstWriteCount: calls[0]?.writes.length ?? 0,
    };
  });
}

async function requiredBox(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectSuggestion(
  input: import('@playwright/test').Locator,
  suggestion: string,
) {
  const listId = await input.getAttribute('list');
  expect(listId).toBeTruthy();
  await expect(
    input.page().locator(`datalist#${listId} option[value="${suggestion}"]`),
  ).toHaveCount(1);
}

async function expectPositionNear(
  locator: import('@playwright/test').Locator,
  expected: { x: number; y: number },
) {
  await expect
    .poll(async () => {
      const actual = await requiredBox(locator);
      return {
        x: Math.round(actual.x),
        y: Math.round(actual.y),
      };
    })
    .toEqual({ x: Math.round(expected.x), y: Math.round(expected.y) });
}

function centerOf(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragPointer(
  page: import('@playwright/test').Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  button: 'left' | 'middle' = 'left',
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up({ button });
}

async function viewportTransform(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => getComputedStyle(element).transform);
}

test('initial controls keep machine and child scopes separate', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__initialWrites', { value: writes });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'initialScopes.json',
        createWritable: async () => ({
          write: async (contents: string) => writes.push(contents),
          close: async () => undefined,
        }),
      }),
    });
  });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'initialScopes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'initialScopes',
        initial: 'workflow',
        states: {
          workflow: { initial: 'ready', states: { ready: {}, active: {} } },
          other: { initial: 'waiting', states: { waiting: {} } },
        },
      }),
    ),
  });
  const selectState = (key: string) =>
    page.getByRole('button', { name: key, exact: true }).click();
  const readWrites = () =>
    page.evaluate(
      () =>
        (window as unknown as { __initialWrites: string[] }).__initialWrites,
    );
  const exportMachine = async () => {
    const before = (await readWrites()).length;
    await page
      .getByRole('button', { name: 'Export JSON', exact: true })
      .click();
    await expect.poll(async () => (await readWrites()).length).toBe(before + 1);
    return JSON.parse((await readWrites()).at(-1)!);
  };

  await selectState('active');
  await page.getByRole('button', { name: /Set initial/ }).click();
  let exported = await exportMachine();
  expect(exported).not.toBeNull();
  expect(exported.initial).toBe('workflow');
  expect(exported.states.workflow.initial).toBe('active');
  expect(exported.states.other.initial).toBe('waiting');

  await expect(
    page.getByRole('button', {
      name: 'Initial child of workflow',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page
      .locator('.react-flow__node[data-id="active"]')
      .getByLabel('Initial child state'),
  ).toBeVisible();
  await expect(
    page
      .locator('.react-flow__node[data-id="ready"]')
      .getByLabel('Initial child state'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  exported = await exportMachine();
  expect(exported.states.workflow.initial).toBe('ready');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(
    page.locator('aside').getByRole('heading', { name: 'active', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  await selectState('workflow');
  await expect(
    page.getByRole('button', { name: 'Machine initial state', exact: true }),
  ).toBeDisabled();
  const initialChild = page.getByRole('combobox', {
    name: 'Initial child',
    exact: true,
  });
  await expect(initialChild).toHaveValue('active');
  await expect(initialChild.locator('option')).toHaveText(['ready', 'active']);
  await initialChild.selectOption('ready');
  exported = await exportMachine();
  expect(exported.initial).toBe('workflow');
  expect(exported.states.workflow.initial).toBe('ready');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(initialChild).toHaveValue('active');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(initialChild).toHaveValue('ready');

  await selectState('other');
  await page
    .getByRole('button', { name: 'Set initial state of machine', exact: true })
    .click();
  exported = await exportMachine();
  expect(exported.initial).toBe('other');
  expect(exported.states.workflow.initial).toBe('ready');
  expect(exported.states.other.initial).toBe('waiting');
  await page.reload();
  await selectState('workflow');
  await expect(
    page.getByRole('combobox', { name: 'Initial child', exact: true }),
  ).toHaveValue('ready');
  await selectState('waiting');
  await expect(
    page.getByRole('button', { name: 'Initial child of other', exact: true }),
  ).toBeDisabled();
});

test('nested parents preserve routes, scoped entry, subtree movement and one-step undo', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__nestedWrites', { value: writes });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'nested.json',
        createWritable: async () => ({
          write: async (contents: string) => writes.push(contents),
          close: async () => undefined,
        }),
      }),
    });
  });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'nested.se.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'state-editor-project',
        version: 1,
        xstateTarget: 'v6-machine-json',
        machine: {
          id: 'nested',
          initial: 'outer',
          states: {
            outer: {
              initial: 'b',
              states: {
                a: { on: { NEXT: { target: 'b' } } },
                b: { on: { BACK: { target: 'a' } } },
                spare: {},
              },
              on: { FINISH: { target: '#done' } },
            },
            done: { id: 'done', type: 'final' },
          },
        },
        editor: {
          nodes: {
            outer: { x: 40, y: 30 },
            a: { x: 64, y: 160 },
            b: { x: 330, y: 160 },
            spare: { x: 64, y: 480 },
            done: { x: 850, y: 50 },
          },
          viewport: { x: 0, y: 0, zoom: 0.8 },
          selection: { kind: 'machine', id: 'machine' },
        },
      }),
    ),
  });
  const node = (key: string) =>
    page.locator('.react-flow__node[data-id="' + key + '"]');
  const select = (key: string) =>
    page.getByRole('button', { name: key, exact: true }).click();
  const properties = page.locator('aside');
  const exportMachine = async () => {
    const read = () =>
      page.evaluate(
        () =>
          (window as unknown as { __nestedWrites: string[] }).__nestedWrites,
      );
    const count = (await read()).length;
    await page
      .getByRole('button', { name: 'Export JSON', exact: true })
      .click();
    await expect.poll(async () => (await read()).length).toBe(count + 1);
    return JSON.parse((await read()).at(-1)!);
  };
  const group = async (
    first: string,
    second: string,
    name: string,
    initial: string,
  ) => {
    await page
      .getByRole('button', { name: 'Edit machine details', exact: true })
      .click();
    const firstBox = await requiredBox(node(first));
    const secondBox = await requiredBox(node(second));
    // Native Shift-drag starts a selection inside a frame without moving it.
    await page.keyboard.down('Shift');
    await dragPointer(
      page,
      {
        x: Math.min(firstBox.x, secondBox.x) - 12,
        y: Math.min(firstBox.y, secondBox.y) - 12,
      },
      {
        x:
          Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width) +
          12,
        y:
          Math.max(
            firstBox.y + firstBox.height,
            secondBox.y + secondBox.height,
          ) + 12,
      },
    );
    await page.keyboard.up('Shift');
    await expect(
      properties.getByRole('button', { name: 'Create parent', exact: true }),
    ).toBeEnabled();
    await expect(node('outer')).not.toHaveClass(/selected/);
    await expect(node(first)).toHaveClass(/selected/);
    await expect(node(second)).toHaveClass(/selected/);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await properties
      .getByRole('button', { name: 'Create parent', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Create parent state' });
    await dialog.getByLabel('Parent state name').fill(name);
    await expect(dialog.getByLabel('Initial child')).toHaveValue(initial);
    await dialog
      .getByRole('button', { name: 'Create parent', exact: true })
      .click();
    await expect(node(name)).toBeVisible();
  };
  const leafRoute = page.locator(
    '.react-flow__edge[data-id="transition-route:a:b"] .react-flow__edge-path',
  );
  await expect(leafRoute).toHaveAttribute('d', /M/);
  const originalRoute = await leafRoute.getAttribute('d');
  const label = page.locator('[data-transition-route="a->b"]');
  const originalLabel = await label.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  await group('a', 'b', 'inner', 'b');
  await expect(leafRoute).toHaveAttribute('d', originalRoute!);
  expect(
    await label.evaluate((element) => (element as HTMLElement).style.transform),
  ).toBe(originalLabel);
  await group('inner', 'spare', 'middle', 'inner');
  let exported = await exportMachine();
  expect(exported.initial).toBe('outer');
  expect(exported.states.outer.initial).toBe('middle');
  expect(exported.states.outer.states.middle.initial).toBe('inner');
  expect(exported.states.outer.states.middle.states.inner.initial).toBe('b');
  expect(
    exported.states.outer.states.middle.states.inner.states.a.on.NEXT.target,
  ).toBe('b');

  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
  for (const [child, parent] of [
    ['inner', 'middle'],
    ['middle', 'outer'],
    ['a', 'inner'],
  ]) {
    const childBox = await requiredBox(node(child));
    const parentBox = await requiredBox(node(parent));
    expect(childBox.x).toBeGreaterThan(parentBox.x);
    expect(childBox.y).toBeGreaterThan(parentBox.y);
    expect(childBox.x + childBox.width).toBeLessThan(
      parentBox.x + parentBox.width,
    );
    expect(childBox.y + childBox.height).toBeLessThan(
      parentBox.y + parentBox.height,
    );
  }
  const layers = await page.evaluate(() => {
    const layer = (selector: string) =>
      Number(getComputedStyle(document.querySelector(selector)!).zIndex);
    return {
      outer: layer('.react-flow__node[data-id="outer"]'),
      middle: layer('.react-flow__node[data-id="middle"]'),
      inner: layer('.react-flow__node[data-id="inner"]'),
      leaf: layer('.react-flow__node[data-id="a"]'),
      edge: Number(
        getComputedStyle(
          document.querySelector('.react-flow__edge')!.parentElement!,
        ).zIndex,
      ),
    };
  });
  expect(layers.middle).toBeGreaterThan(layers.outer);
  expect(layers.inner).toBeGreaterThan(layers.middle);
  expect(layers.edge).toBeGreaterThan(layers.inner);
  expect(layers.leaf).toBeGreaterThan(layers.edge);
  await page.screenshot({ path: test.info().outputPath('nested-parents.png') });

  const before = await requiredBox(node('b'));
  const handle = await requiredBox(
    page.getByRole('button', { name: 'outer', exact: true }),
  );
  // Drag the frame's header background, not its name button (which is deliberately non-draggable).
  await dragPointer(
    page,
    { x: handle.x + handle.width + 50, y: handle.y + 8 },
    { x: handle.x + handle.width + 85, y: handle.y + 33 },
  );
  const after = await requiredBox(node('b'));
  expect(after.x - before.x).toBeGreaterThan(20);
  expect(after.y - before.y).toBeGreaterThan(15);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectPositionNear(node('b'), before);

  await select('inner');
  await page.keyboard.press('Delete');
  await expect(node('inner')).toHaveCount(0);
  exported = await exportMachine();
  expect(exported.states.outer.states.middle.initial).toBe('b');
  expect(exported.states.outer.states.middle.states.a.on.NEXT.target).toBe('b');
  expect(exported.states.outer.states.middle.states.b.on.BACK.target).toBe('a');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(node('inner')).toBeVisible();
  exported = await exportMachine();
  expect(exported.states.outer.states.middle.states.inner.initial).toBe('b');

  await select('b');
  await properties
    .getByRole('button', { name: 'Remove from parent', exact: true })
    .click();
  exported = await exportMachine();
  expect(exported.states.outer.states.middle.states.b).toBeTruthy();
  expect(exported.states.outer.states.middle.states.inner.initial).toBe('a');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  exported = await exportMachine();
  expect(exported.states.outer.states.middle.states.inner.initial).toBe('b');

  await page
    .getByRole('button', { name: 'Edit machine details', exact: true })
    .click();
  const innerBox = await requiredBox(node('inner'));
  await page.mouse.dblclick(
    innerBox.x + 40,
    innerBox.y + innerBox.height - 60,
    { delay: 80 },
  );
  await page.keyboard.press('Enter');
  exported = await exportMachine();
  expect(
    exported.states.outer.states.middle.states.inner.states.state8,
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(node('state8')).toHaveCount(0);

  await select('done');
  const doneBeforeDrop = await requiredBox(node('done'));
  const targetFrame = await requiredBox(node('inner'));
  await dragPointer(page, centerOf(doneBeforeDrop), {
    x: targetFrame.x + targetFrame.width / 2,
    y: targetFrame.y + targetFrame.height - 60,
  });
  exported = await exportMachine();
  expect(
    exported.states.outer.states.middle.states.inner.states.done,
  ).toMatchObject({ type: 'final' });
  expect(exported.states.done).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectPositionNear(node('done'), doneBeforeDrop);
  exported = await exportMachine();
  expect(exported.states.done).toMatchObject({ type: 'final' });

  await page.reload();
  await expect(node('inner')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(
    properties.getByRole('heading', { name: 'b', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect(
    page.getByText('Machine complete', { exact: true }),
  ).toBeVisible();
});
