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
