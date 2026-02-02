/**
 * Puppeteer UI E2E Test Helpers
 *
 * Shared utilities for browser-based dashboard testing.
 * Handles server lifecycle, browser launch, authentication,
 * navigation, and common assertions.
 */

import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { execSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.E2E_PORT) || 4797;
const BASE_URL = `http://localhost:${PORT}`;
const DASHBOARD_URL = `${BASE_URL}/dashboard/`;
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOW_MO = Number(process.env.SLOW_MO) || 0;
const TIMEOUT = 15_000;

export { PORT, BASE_URL, DASHBOARD_URL, TIMEOUT };

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;
let dbDir: string | null = null;

export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    dbDir = mkdtempSync(join(tmpdir(), 'fleet-ui-e2e-'));
    const dbPath = join(dbDir, 'fleet.db');

    // Kill anything on our port
    try {
      const pid = execSync(`lsof -ti :${PORT} 2>/dev/null`).toString().trim();
      if (pid) {
        execSync(`kill ${pid} 2>/dev/null`);
      }
    } catch {
      // Nothing on port — fine
    }

    const distIndex = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(distIndex)) {
      reject(new Error('dist/index.js not found. Run `npm run build` first.'));
      return;
    }

    serverProcess = spawn('node', [distIndex], {
      env: {
        ...process.env,
        PORT: String(PORT),
        DB_PATH: dbPath,
        NODE_ENV: 'test',
      },
      stdio: 'pipe',
    });

    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString();
      if (process.env.DEBUG) {
        process.stderr.write(`[server] ${msg}`);
      }
    });

    // Poll for health
    let attempts = 0;
    const maxAttempts = 60;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          clearInterval(poll);
          resolve();
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          reject(new Error(`Server did not become healthy after ${maxAttempts * 500}ms`));
        }
      }
    }, 500);
  });
}

export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  if (dbDir) {
    try {
      rmSync(dbDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
    dbDir = null;
  }
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

let browser: Browser | null = null;

export async function launchBrowser(): Promise<Browser> {
  browser = await puppeteer.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    slowMo: SLOW_MO,
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function newPage(): Promise<Page> {
  if (!browser) {
    throw new Error('Browser not launched. Call launchBrowser() first.');
  }
  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await page.setViewport({ width: 1280, height: 800 });
  return page;
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export async function openDashboard(page: Page): Promise<void> {
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2' });
}

export async function waitForAutoLogin(page: Page): Promise<void> {
  // The dashboard auto-logs in; wait for user-handle to appear
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#user-handle');
      return el && el.textContent && el.textContent.trim().length > 0;
    },
    { timeout: TIMEOUT },
  );
}

export async function navigateTo(page: Page, route: string): Promise<void> {
  // Click the sidebar nav item for a route
  const selector = `.nav-item[data-route="${route}"]`;
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector);
  // Allow route transition
  await page.waitForFunction(
    (r: string) => window.location.hash === `#${r}`,
    { timeout: 5000 },
    route,
  );
  // Wait a tick for render
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------

export async function openModal(page: Page, triggerId: string, modalId: string): Promise<void> {
  await page.click(triggerId);
  await page.waitForSelector(modalId, { visible: true });
}

export async function closeModal(page: Page, modalId: string): Promise<void> {
  // Press Escape to close
  await page.keyboard.press('Escape');
  await page.waitForSelector(modalId, { hidden: true });
}

export async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector, { clickCount: 3 }); // select all
  await page.type(selector, value);
}

export async function selectOption(page: Page, selector: string, value: string): Promise<void> {
  await page.select(selector, value);
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export async function getText(page: Page, selector: string): Promise<string> {
  const el = await page.waitForSelector(selector);
  if (!el) return '';
  const text = await page.evaluate((e: Element) => e.textContent || '', el);
  return text.trim();
}

export async function isVisible(page: Page, selector: string): Promise<boolean> {
  try {
    const el = await page.$(selector);
    if (!el) return false;
    const box = await el.boundingBox();
    return box !== null;
  } catch {
    return false;
  }
}

export async function hasClass(page: Page, selector: string, className: string): Promise<boolean> {
  const el = await page.$(selector);
  if (!el) return false;
  return page.evaluate(
    (e: Element, cls: string) => e.classList.contains(cls),
    el,
    className,
  );
}

export async function getInputValue(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el as HTMLInputElement).value);
}

// ---------------------------------------------------------------------------
// API helpers (for seeding test data)
// ---------------------------------------------------------------------------

export async function apiLogin(
  handle = 'e2e-tester',
  team = 'e2e-team',
  agentType = 'team-lead',
): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, teamName: team, agentType }),
  });
  const data = await res.json() as { token: string };
  return data.token;
}

export async function apiPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForText(
  page: Page,
  selector: string,
  text: string,
  timeout = TIMEOUT,
): Promise<void> {
  await page.waitForFunction(
    (sel: string, txt: string) => {
      const el = document.querySelector(sel);
      return el && (el.textContent || '').includes(txt);
    },
    { timeout },
    selector,
    text,
  );
}

export async function waitForSelector(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { visible: true, timeout: TIMEOUT });
}

export async function getElementCount(page: Page, selector: string): Promise<number> {
  return page.$$eval(selector, (els) => els.length);
}

export async function screenshotOnFailure(page: Page, testName: string): Promise<void> {
  const dir = join(process.cwd(), 'test-screenshots');
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filename = testName.replace(/[^a-zA-Z0-9]/g, '-') + '.png';
    await page.screenshot({ path: join(dir, filename), fullPage: true });
  } catch {
    // Best effort
  }
}
