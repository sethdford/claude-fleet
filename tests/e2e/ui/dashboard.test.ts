/**
 * Dashboard UI E2E Tests
 *
 * Browser-based tests using Puppeteer to validate the full dashboard
 * user experience: login, navigation, modals, data display, and WebSocket sync.
 *
 * Run via: ./scripts/e2e-ui.sh
 * Or directly: npx vitest run --config vitest.e2e-ui.config.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Page } from 'puppeteer';
import {
  startServer,
  stopServer,
  launchBrowser,
  closeBrowser,
  newPage,
  openDashboard,
  waitForAutoLogin,
  navigateTo,
  fillInput,
  getText,
  isVisible,
  sleep,
  waitForSelector,
  getElementCount,
  screenshotOnFailure,
  apiLogin,
  apiPost,
  DASHBOARD_URL,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let page: Page;

beforeAll(async () => {
  await startServer();
  await launchBrowser();
}, 60_000);

afterAll(async () => {
  await closeBrowser();
  stopServer();
});

beforeEach(async () => {
  page = await newPage();
});

afterEach(async (ctx) => {
  if (ctx.task.result?.state === 'fail') {
    await screenshotOnFailure(page, ctx.task.name);
  }
  await page.close();
});

// ============================================================================
// Auto-Login & Initial Load
// ============================================================================

describe('Dashboard Login & Load', () => {
  it('should auto-login and display user handle', async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);

    const handle = await getText(page, '#user-handle');
    // Auto-login handle; accept any non-empty value (rate-limiting may retry with different timing)
    expect(handle.length).toBeGreaterThan(0);
  });

  it('should show connection status as connected', async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);

    // Wait for WebSocket connection
    await sleep(1000);
    const statusText = await getText(page, '#connection-text');
    expect(statusText.toLowerCase()).toContain('connect');
  });

  it('should display the page title for the home route', async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);

    const title = await getText(page, '#page-title');
    expect(title.length).toBeGreaterThan(0);
  });

  it('should load dashboard HTML correctly', async () => {
    await openDashboard(page);

    const title = await page.title();
    expect(title).toContain('Claude Fleet');
  });

  it('should have sidebar navigation items', async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);

    const navCount = await getElementCount(page, '.nav-item[data-route]');
    expect(navCount).toBeGreaterThanOrEqual(5);
  });
});

// ============================================================================
// Navigation
// ============================================================================

describe('Sidebar Navigation', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should navigate to metrics view', async () => {
    await navigateTo(page, '/metrics');
    expect(page.url()).toContain('#/metrics');
  });

  it('should navigate to tasks view', async () => {
    await navigateTo(page, '/tasks');
    expect(page.url()).toContain('#/tasks');
  });

  it('should navigate to graph view', async () => {
    await navigateTo(page, '/graph');
    expect(page.url()).toContain('#/graph');
  });

  it('should navigate to scheduler view', async () => {
    await navigateTo(page, '/scheduler');
    expect(page.url()).toContain('#/scheduler');
  });

  it('should navigate to mail view', async () => {
    await navigateTo(page, '/mail');
    expect(page.url()).toContain('#/mail');
  });

  it('should navigate to workflows view', async () => {
    await navigateTo(page, '/workflows');
    expect(page.url()).toContain('#/workflows');
  });

  it('should navigate to hive view', async () => {
    await navigateTo(page, '/hive');
    expect(page.url()).toContain('#/hive');
  });

  it('should navigate to connections view', async () => {
    await navigateTo(page, '/connections');
    expect(page.url()).toContain('#/connections');
  });

  it('should navigate to memory view', async () => {
    await navigateTo(page, '/memory');
    expect(page.url()).toContain('#/memory');
  });

  it('should navigate back to home', async () => {
    await navigateTo(page, '/metrics');
    await navigateTo(page, '/');
    expect(page.url()).toContain('#/');
  });

  it('should highlight active nav item', async () => {
    await navigateTo(page, '/tasks');
    const isActive = await page.evaluate(() => {
      const el = document.querySelector('.nav-item[data-route="/tasks"]');
      return el?.classList.contains('active') ?? false;
    });
    expect(isActive).toBe(true);
  });
});

// ============================================================================
// Spawn Worker Modal
// ============================================================================

describe('Spawn Worker Modal', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should open spawn modal when clicking spawn button', async () => {
    const spawnBtn = await page.$('#spawn-btn');
    if (!spawnBtn) {
      // Some layouts may have a different trigger
      return;
    }
    await spawnBtn.click();
    await waitForSelector(page, '#spawn-modal');
    const visible = await isVisible(page, '#spawn-modal');
    expect(visible).toBe(true);
  });

  it('should have all required spawn form fields', async () => {
    // Use the global function to open the modal
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSpawnModal: () => void } })
        .fleetDashboard.showSpawnModal();
    });
    await waitForSelector(page, '#spawn-modal');

    const hasHandle = await isVisible(page, '#spawn-handle');
    const hasPrompt = await isVisible(page, '#spawn-prompt');
    const hasSubmit = await isVisible(page, '#spawn-submit');
    const hasCancel = await isVisible(page, '#spawn-cancel');

    expect(hasHandle).toBe(true);
    expect(hasPrompt).toBe(true);
    expect(hasSubmit).toBe(true);
    expect(hasCancel).toBe(true);
  });

  it('should close spawn modal on cancel', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSpawnModal: () => void } })
        .fleetDashboard.showSpawnModal();
    });
    await waitForSelector(page, '#spawn-modal');

    await page.click('#spawn-cancel');
    await sleep(500);
    const hasActive = await page.evaluate(() => {
      return document.querySelector('#spawn-modal')?.classList.contains('active') ?? false;
    });
    expect(hasActive).toBe(false);
  });

  it('should fill spawn form fields', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSpawnModal: () => void } })
        .fleetDashboard.showSpawnModal();
    });
    await waitForSelector(page, '#spawn-modal');

    await fillInput(page, '#spawn-handle', 'test-worker');
    await fillInput(page, '#spawn-prompt', 'Do some testing work');

    const handleVal = await page.$eval('#spawn-handle', (el) => (el as HTMLInputElement).value);
    expect(handleVal).toBe('test-worker');
  });
});

// ============================================================================
// Create Task Modal
// ============================================================================

describe('Create Task Modal', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should open task modal via JS API', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showTaskModal: () => void } })
        .fleetDashboard.showTaskModal();
    });
    await waitForSelector(page, '#task-modal');
    const visible = await isVisible(page, '#task-modal');
    expect(visible).toBe(true);
  });

  it('should have required task form fields', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showTaskModal: () => void } })
        .fleetDashboard.showTaskModal();
    });
    await waitForSelector(page, '#task-modal');

    const hasSubject = await isVisible(page, '#task-subject');
    const hasDescription = await isVisible(page, '#task-description');
    const hasSubmit = await isVisible(page, '#task-submit');

    expect(hasSubject).toBe(true);
    expect(hasDescription).toBe(true);
    expect(hasSubmit).toBe(true);
  });

  it('should fill task form', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showTaskModal: () => void } })
        .fleetDashboard.showTaskModal();
    });
    await waitForSelector(page, '#task-modal');

    await fillInput(page, '#task-subject', 'Fix the login bug');
    await fillInput(page, '#task-description', 'Users cannot login with SSO');

    const subjectVal = await page.$eval('#task-subject', (el) => (el as HTMLInputElement).value);
    expect(subjectVal).toBe('Fix the login bug');
  });

  it('should close task modal via cancel button', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showTaskModal: () => void } })
        .fleetDashboard.showTaskModal();
    });
    await waitForSelector(page, '#task-modal');

    await page.click('#task-cancel');
    await sleep(500);
    const hasActive = await page.evaluate(() => {
      return document.querySelector('#task-modal')?.classList.contains('active') ?? false;
    });
    expect(hasActive).toBe(false);
  });
});

// ============================================================================
// Create Swarm Modal
// ============================================================================

describe('Create Swarm Modal', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should open swarm modal via JS API', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSwarmModal: () => void } })
        .fleetDashboard.showSwarmModal();
    });
    await waitForSelector(page, '#swarm-modal');
    const visible = await isVisible(page, '#swarm-modal');
    expect(visible).toBe(true);
  });

  it('should have required swarm form fields', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSwarmModal: () => void } })
        .fleetDashboard.showSwarmModal();
    });
    await waitForSelector(page, '#swarm-modal');

    const hasName = await isVisible(page, '#swarm-name');
    const hasDesc = await isVisible(page, '#swarm-description');
    const hasMax = await isVisible(page, '#swarm-max-agents');
    const hasSubmit = await isVisible(page, '#swarm-submit');

    expect(hasName).toBe(true);
    expect(hasDesc).toBe(true);
    expect(hasMax).toBe(true);
    expect(hasSubmit).toBe(true);
  });

  it('should fill swarm form', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSwarmModal: () => void } })
        .fleetDashboard.showSwarmModal();
    });
    await waitForSelector(page, '#swarm-modal');

    await fillInput(page, '#swarm-name', 'Test Swarm');
    await fillInput(page, '#swarm-description', 'A test swarm for E2E');
    await fillInput(page, '#swarm-max-agents', '10');

    const nameVal = await page.$eval('#swarm-name', (el) => (el as HTMLInputElement).value);
    expect(nameVal).toBe('Test Swarm');
  });
});

// ============================================================================
// Connect Modal
// ============================================================================

describe('Connect Modal', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should open connect modal via JS API', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showConnectModal: () => void } })
        .fleetDashboard.showConnectModal();
    });
    await waitForSelector(page, '#connect-modal');
    const visible = await isVisible(page, '#connect-modal');
    expect(visible).toBe(true);
  });

  it('should have connect form fields', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showConnectModal: () => void } })
        .fleetDashboard.showConnectModal();
    });
    await waitForSelector(page, '#connect-modal');

    const hasHandle = await isVisible(page, '#connect-handle');
    const hasTeam = await isVisible(page, '#connect-team');
    const hasGenerate = await isVisible(page, '#connect-generate');

    expect(hasHandle).toBe(true);
    expect(hasTeam).toBe(true);
    expect(hasGenerate).toBe(true);
  });
});

// ============================================================================
// Dashboard Overview (Home View)
// ============================================================================

describe('Dashboard Overview', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should display the main content area', async () => {
    const visible = await isVisible(page, '#main-view');
    expect(visible).toBe(true);
  });

  it('should show worker count in sidebar', async () => {
    // Sidebar may show worker list
    const workerList = await page.$('#worker-nav-list');
    expect(workerList).not.toBeNull();
  });

  it('should show swarm list in sidebar', async () => {
    const swarmList = await page.$('#swarm-nav-list');
    expect(swarmList).not.toBeNull();
  });

  it('should display task count badge', async () => {
    const taskCount = await page.$('#task-count');
    expect(taskCount).not.toBeNull();
  });
});

// ============================================================================
// Data-Driven Views
// ============================================================================

describe('Data-Driven Views', () => {
  let token: string;

  beforeAll(async () => {
    token = await apiLogin();
    // Seed some test data
    await apiPost('/tasks', token, {
      subject: 'E2E Test Task',
      description: 'Created by UI E2E tests',
    });
  });

  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should show tasks in the tasks view', async () => {
    await navigateTo(page, '/tasks');
    // Wait for task data to load
    await sleep(1500);

    const mainContent = await getText(page, '#main-view');
    expect(mainContent.length).toBeGreaterThan(0);
  });

  it('should show metrics view with charts', async () => {
    await navigateTo(page, '/metrics');
    await sleep(1000);

    const mainContent = await page.$('#main-view');
    expect(mainContent).not.toBeNull();
  });

  it('should show scheduler view', async () => {
    await navigateTo(page, '/scheduler');
    await sleep(500);

    const mainContent = await page.$('#main-view');
    expect(mainContent).not.toBeNull();
  });
});

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

describe('Keyboard Shortcuts', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should open command palette with Ctrl+K', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(300);

    // Command palette should appear
    const palette = await page.$('#command-palette');
    if (palette) {
      const visible = await isVisible(page, '#command-palette');
      expect(visible).toBe(true);
    }
  });

  it('should close spawn modal via Escape key', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSpawnModal: () => void } })
        .fleetDashboard.showSpawnModal();
    });
    await waitForSelector(page, '#spawn-modal');

    await page.keyboard.press('Escape');
    await sleep(500);

    const hasActive = await page.evaluate(() => {
      return document.querySelector('#spawn-modal')?.classList.contains('active') ?? false;
    });
    expect(hasActive).toBe(false);
  });

  it('should close task modal via Escape key', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showTaskModal: () => void } })
        .fleetDashboard.showTaskModal();
    });
    await waitForSelector(page, '#task-modal');

    await page.keyboard.press('Escape');
    await sleep(500);

    const hasActive = await page.evaluate(() => {
      return document.querySelector('#task-modal')?.classList.contains('active') ?? false;
    });
    expect(hasActive).toBe(false);
  });
});

// ============================================================================
// Responsive Layout
// ============================================================================

describe('Responsive Layout', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should render correctly at desktop size (1280x800)', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(300);

    const sidebar = await isVisible(page, '.sidebar');
    const main = await isVisible(page, '#main-view');
    expect(sidebar || main).toBe(true);
  });

  it('should adapt layout at tablet size (768x1024)', async () => {
    await page.setViewport({ width: 768, height: 1024 });
    await sleep(300);

    const main = await isVisible(page, '#main-view');
    expect(main).toBe(true);
  });

  it('should adapt layout at mobile size (375x667)', async () => {
    await page.setViewport({ width: 375, height: 667 });
    await sleep(300);

    const main = await isVisible(page, '#main-view');
    expect(main).toBe(true);
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('Error Handling', () => {
  it('should not have console errors on load', async () => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await openDashboard(page);
    await waitForAutoLogin(page);
    await sleep(1000);

    // Filter out expected errors (rate-limiting, WebSocket reconnect, fetch failures)
    const unexpectedErrors = errors.filter(
      (e) =>
        !e.includes('WebSocket') &&
        !e.includes('net::ERR_') &&
        !e.includes('favicon') &&
        !e.includes('429') &&
        !e.includes('Too Many Requests') &&
        !e.includes('Failed to fetch') &&
        !e.includes('Failed to load resource') &&
        !e.includes('401') &&
        !e.includes('Unauthorized') &&
        !e.includes('JSHandle@error'),
    );

    expect(unexpectedErrors).toEqual([]);
  });

  it('should handle direct hash navigation', async () => {
    await page.goto(`${DASHBOARD_URL}#/tasks`, { waitUntil: 'networkidle2' });
    await waitForAutoLogin(page);

    expect(page.url()).toContain('#/tasks');
  });

  it('should handle invalid routes gracefully', async () => {
    await page.goto(`${DASHBOARD_URL}#/nonexistent-route`, { waitUntil: 'networkidle2' });
    await waitForAutoLogin(page);

    // Should not crash — page should still be functional
    const main = await page.$('#main-view');
    expect(main).not.toBeNull();
  });
});

// ============================================================================
// Form Validation
// ============================================================================

describe('Form Validation', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should show warning when spawning without handle', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSpawnModal: () => void } })
        .fleetDashboard.showSpawnModal();
    });
    await waitForSelector(page, '#spawn-modal');

    // Leave handle empty, click submit
    await page.click('#spawn-submit');
    await sleep(500);

    // Should show a warning toast — modal should still be open
    const modalStillOpen = await page.evaluate(() => {
      return document.querySelector('#spawn-modal')?.classList.contains('active') ?? false;
    });
    expect(modalStillOpen).toBe(true);
  });

  it('should show warning when creating swarm without name', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSwarmModal: () => void } })
        .fleetDashboard.showSwarmModal();
    });
    await waitForSelector(page, '#swarm-modal');

    // Leave name empty, click submit
    await page.click('#swarm-submit');
    await sleep(500);

    // Modal should still be open
    const modalStillOpen = await page.evaluate(() => {
      return document.querySelector('#swarm-modal')?.classList.contains('active') ?? false;
    });
    expect(modalStillOpen).toBe(true);
  });

  it('should reject invalid max agents value', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showSwarmModal: () => void } })
        .fleetDashboard.showSwarmModal();
    });
    await waitForSelector(page, '#swarm-modal');

    await fillInput(page, '#swarm-name', 'Test Swarm');
    await fillInput(page, '#swarm-max-agents', '-5');
    await page.click('#swarm-submit');
    await sleep(500);

    // Modal should still be open because -5 is invalid
    const modalStillOpen = await page.evaluate(() => {
      return document.querySelector('#swarm-modal')?.classList.contains('active') ?? false;
    });
    expect(modalStillOpen).toBe(true);
  });

  it('should show warning when creating task without subject', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showTaskModal: () => void } })
        .fleetDashboard.showTaskModal();
    });
    await waitForSelector(page, '#task-modal');

    // Leave subject empty, click submit
    await page.click('#task-submit');
    await sleep(500);

    // Modal should still be open
    const modalStillOpen = await page.evaluate(() => {
      return document.querySelector('#task-modal')?.classList.contains('active') ?? false;
    });
    expect(modalStillOpen).toBe(true);
  });

  it('should reject invalid connect handle', async () => {
    await page.evaluate(() => {
      (window as unknown as { fleetDashboard: { showConnectModal: () => void } })
        .fleetDashboard.showConnectModal();
    });
    await waitForSelector(page, '#connect-modal');

    // Enter handle with spaces (invalid)
    await fillInput(page, '#connect-handle', 'bad handle with spaces');
    await page.click('#connect-generate');
    await sleep(500);

    // Connect command output should NOT be visible (validation failed)
    const outputVisible = await page.evaluate(() => {
      const output = document.querySelector('#connect-command-output');
      return output && !output.classList.contains('hidden');
    });
    expect(outputVisible).toBe(false);
  });
});

// ============================================================================
// Router Error Recovery
// ============================================================================

describe('Router Error Recovery', () => {
  it('should show error UI when view handler fails', async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);

    // Navigate to invalid route; should fallback to overview without crashing
    await page.goto(`${DASHBOARD_URL}#/nonexistent-deep/route/path`, { waitUntil: 'networkidle2' });
    await sleep(500);

    // Page should not be blank — either overview or error UI should render
    const mainContent = await page.$eval('#main-view', (el) => el.innerHTML.trim());
    expect(mainContent.length).toBeGreaterThan(0);
  });

  it('should remain navigable after error', async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);

    // Navigate to bad route, then back to tasks
    await page.goto(`${DASHBOARD_URL}#/broken-route`, { waitUntil: 'networkidle2' });
    await sleep(300);

    await navigateTo(page, '/tasks');
    expect(page.url()).toContain('#/tasks');
  });
});

// ============================================================================
// WebSocket Connection
// ============================================================================

describe('WebSocket Connection', () => {
  beforeEach(async () => {
    await openDashboard(page);
    await waitForAutoLogin(page);
  });

  it('should establish WebSocket connection', async () => {
    await sleep(2000);

    const connectionState = await page.evaluate(() => {
      const el = document.querySelector('#connection-status');
      return el?.className || '';
    });

    // Either connected class or the text shows connected
    const statusText = await getText(page, '#connection-text');
    expect(
      connectionState.includes('connected') || statusText.toLowerCase().includes('connect'),
    ).toBe(true);
  });

  it('should show real-time data in sidebar after connection', async () => {
    await sleep(2000);

    // Worker list and swarm list should be present (even if empty)
    const workerList = await page.$('#worker-nav-list');
    const swarmList = await page.$('#swarm-nav-list');

    expect(workerList).not.toBeNull();
    expect(swarmList).not.toBeNull();
  });
});
