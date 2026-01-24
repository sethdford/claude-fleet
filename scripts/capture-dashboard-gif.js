#!/usr/bin/env node
/**
 * Capture dashboard GIF using Puppeteer
 */

import puppeteer from 'puppeteer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DASHBOARD_URL = 'http://localhost:3847/dashboard.html';
const OUTPUT_DIR = '/tmp/dashboard-frames';
const GIF_OUTPUT = '/tmp/dashboard-demo.gif';

async function captureFrames() {
  // Clean up previous frames
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  console.log('Opening dashboard...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 10000 });

  // Wait for dashboard to load
  await page.waitForSelector('.card-value', { timeout: 5000 });

  // Give WebSocket time to connect and fetch data
  await new Promise(r => setTimeout(r, 2000));

  console.log('Capturing frames...');

  // Capture multiple frames to show activity
  for (let i = 0; i < 8; i++) {
    const framePath = path.join(OUTPUT_DIR, `frame-${String(i).padStart(3, '0')}.png`);
    await page.screenshot({ path: framePath, fullPage: false });
    console.log(`  Frame ${i + 1}/8`);
    await new Promise(r => setTimeout(r, 500));
  }

  await browser.close();
  console.log('Browser closed.');

  return OUTPUT_DIR;
}

async function createGif(framesDir) {
  console.log('Creating GIF with ffmpeg...');

  try {
    execSync(
      `ffmpeg -y -framerate 2 -i "${framesDir}/frame-%03d.png" -vf "scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${GIF_OUTPUT}"`,
      { stdio: 'pipe' }
    );
    console.log(`GIF created: ${GIF_OUTPUT}`);

    // Get file size
    const stats = fs.statSync(GIF_OUTPUT);
    console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);

    return GIF_OUTPUT;
  } catch (err) {
    console.error('FFmpeg error:', err.message);
    throw err;
  }
}

async function main() {
  try {
    const framesDir = await captureFrames();
    const gifPath = await createGif(framesDir);
    console.log('\n✓ Dashboard GIF ready:', gifPath);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
