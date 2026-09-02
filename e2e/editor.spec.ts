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

  await page.locator('.react-flow__edge-textbg').click();
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
