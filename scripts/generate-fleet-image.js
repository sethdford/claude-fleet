#!/usr/bin/env node
/**
 * Fleet Marketing Image Generator
 *
 * Generates branded images for Claude Fleet using SVG + Sharp.
 *
 * Usage:
 *   node generate-fleet-image.js --type logo
 *   node generate-fleet-image.js --type social --title "Multi-Agent Orchestration"
 *   node generate-fleet-image.js --type feature --title "Workflow Engine" --category workflows
 *   node generate-fleet-image.js --type hero
 *   node generate-fleet-image.js --type architecture
 *   node generate-fleet-image.js --all    # Generate all standard assets
 *
 * Output formats:
 *   --format png (default)
 *   --format svg
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load Sharp
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('⚠️  Sharp not installed. SVG output only. Install with: npm add -D sharp');
}

const DEFAULT_OUTPUT = path.join(__dirname, '../docs/images');

// ============================================================================
// DESIGN TOKENS
// ============================================================================

const TOKENS = {
  bg: {
    navy: '#0f172a',
    deepBlue: '#1e3a5f',
    card: '#1e293b',
  },
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    muted: '#64748b',
  },
  accent: {
    cyan: '#38bdf8',
    emerald: '#10b981',
    violet: '#8b5cf6',
    amber: '#f59e0b',
    pink: '#ec4899',
    blue: '#3b82f6',
  },
  gradient: {
    primary: ['#0f172a', '#1e3a5f'],
    accent: ['#38bdf8', '#8b5cf6'],
  },
};

// Category configurations
const CATEGORIES = {
  workflows: { label: 'WORKFLOWS', accent: TOKENS.accent.violet, icon: 'flow' },
  agents: { label: 'AGENTS', accent: TOKENS.accent.cyan, icon: 'users' },
  storage: { label: 'STORAGE', accent: TOKENS.accent.emerald, icon: 'database' },
  api: { label: 'API', accent: TOKENS.accent.amber, icon: 'code' },
  security: { label: 'SECURITY', accent: TOKENS.accent.pink, icon: 'shield' },
  performance: { label: 'PERFORMANCE', accent: TOKENS.accent.blue, icon: 'zap' },
  default: { label: 'FLEET', accent: TOKENS.accent.cyan, icon: 'fleet' },
};

function getCategory(name) {
  return CATEGORIES[name?.toLowerCase()] || CATEGORIES.default;
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxChars) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ============================================================================
// SVG GENERATORS
// ============================================================================

/**
 * Generate the Fleet logo SVG
 */
function generateLogo({ size = 512, variant = 'full' } = {}) {
  const nodeRadius = size * 0.06;
  const centerX = size / 2;
  const centerY = size / 2;

  // Node positions (lead in center, workers around)
  const nodes = [
    { x: centerX, y: centerY, type: 'lead' },
    { x: centerX - size * 0.25, y: centerY - size * 0.15, type: 'worker' },
    { x: centerX + size * 0.25, y: centerY - size * 0.15, type: 'worker' },
    { x: centerX - size * 0.2, y: centerY + size * 0.2, type: 'worker' },
    { x: centerX + size * 0.2, y: centerY + size * 0.2, type: 'worker' },
  ];

  // Connection lines
  const connections = nodes.slice(1).map((node) => ({
    x1: centerX,
    y1: centerY,
    x2: node.x,
    y2: node.y,
  }));

  const connectionLines = connections
    .map(
      (c) => `
    <line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}"
          stroke="${TOKENS.accent.cyan}" stroke-width="${size * 0.008}"
          stroke-opacity="0.6" stroke-linecap="round"/>
  `
    )
    .join('');

  const nodeCircles = nodes
    .map((node) => {
      const isLead = node.type === 'lead';
      const r = isLead ? nodeRadius * 1.4 : nodeRadius;
      const fill = isLead ? TOKENS.accent.cyan : TOKENS.accent.violet;
      const glow = isLead
        ? `<circle cx="${node.x}" cy="${node.y}" r="${r * 1.5}" fill="${fill}" opacity="0.2"/>`
        : '';

      return `
      ${glow}
      <circle cx="${node.x}" cy="${node.y}" r="${r}" fill="${fill}"/>
      <circle cx="${node.x}" cy="${node.y}" r="${r * 0.4}" fill="${TOKENS.bg.navy}"/>
    `;
    })
    .join('');

  const wordmark =
    variant === 'full'
      ? `
    <text x="${centerX}" y="${size * 0.85}"
          font-family="Inter, -apple-system, sans-serif"
          font-size="${size * 0.1}" font-weight="700"
          fill="${TOKENS.text.primary}" text-anchor="middle">
      CLAUDE FLEET
    </text>
  `
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${TOKENS.bg.navy}"/>
      <stop offset="100%" style="stop-color:${TOKENS.bg.deepBlue}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${size * 0.1}" fill="url(#bg-gradient)"/>

  <!-- Connections -->
  ${connectionLines}

  <!-- Nodes -->
  ${nodeCircles}

  <!-- Wordmark -->
  ${wordmark}
</svg>`;
}

/**
 * Generate social preview image (1200x630)
 */
function generateSocialPreview({ title = 'Multi-Agent Orchestration', subtitle = '' } = {}) {
  const width = 1200;
  const height = 630;

  const titleLines = wrapText(title, 30);
  const titleY = 260;
  const lineHeight = 65;

  const titleSvg = titleLines
    .map(
      (line, i) => `
    <text x="100" y="${titleY + i * lineHeight}"
          font-family="Inter, -apple-system, sans-serif"
          font-size="56" font-weight="700" fill="${TOKENS.text.primary}">
      ${escapeXml(line)}
    </text>
  `
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${TOKENS.bg.navy}"/>
      <stop offset="100%" style="stop-color:${TOKENS.bg.deepBlue}"/>
    </linearGradient>
    <pattern id="dot-grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1.5" fill="white" opacity="0.06"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg-gradient)"/>
  <rect width="${width}" height="${height}" fill="url(#dot-grid)"/>

  <!-- Accent bar -->
  <rect x="80" y="100" width="6" height="80" rx="3" fill="${TOKENS.accent.cyan}"/>

  <!-- Badge -->
  <rect x="110" y="100" width="180" height="36" rx="18" fill="${TOKENS.accent.cyan}" opacity="0.15"/>
  <text x="130" y="125"
        font-family="Inter, -apple-system, sans-serif"
        font-size="14" font-weight="600" letter-spacing="0.1em"
        fill="${TOKENS.accent.cyan}">
    CLAUDE FLEET
  </text>

  <!-- Title -->
  ${titleSvg}

  <!-- Subtitle -->
  ${
    subtitle
      ? `
    <text x="100" y="${titleY + titleLines.length * lineHeight + 30}"
          font-family="Inter, -apple-system, sans-serif"
          font-size="24" fill="${TOKENS.text.secondary}">
      ${escapeXml(subtitle)}
    </text>
  `
      : `
    <text x="100" y="${titleY + titleLines.length * lineHeight + 30}"
          font-family="Inter, -apple-system, sans-serif"
          font-size="24" fill="${TOKENS.text.secondary}">
      Multi-Agent Orchestration for Claude Code
    </text>
  `
  }

  <!-- Fleet nodes decoration (right side) -->
  <g transform="translate(950, 315)">
    <!-- Central node -->
    <circle cx="0" cy="0" r="50" fill="${TOKENS.accent.cyan}" opacity="0.15"/>
    <circle cx="0" cy="0" r="35" fill="${TOKENS.accent.cyan}"/>
    <circle cx="0" cy="0" r="15" fill="${TOKENS.bg.navy}"/>

    <!-- Worker nodes -->
    <line x1="0" y1="0" x2="-80" y2="-60" stroke="${TOKENS.accent.cyan}" stroke-width="2" opacity="0.5"/>
    <circle cx="-80" cy="-60" r="20" fill="${TOKENS.accent.violet}"/>
    <circle cx="-80" cy="-60" r="8" fill="${TOKENS.bg.navy}"/>

    <line x1="0" y1="0" x2="80" y2="-60" stroke="${TOKENS.accent.cyan}" stroke-width="2" opacity="0.5"/>
    <circle cx="80" cy="-60" r="20" fill="${TOKENS.accent.violet}"/>
    <circle cx="80" cy="-60" r="8" fill="${TOKENS.bg.navy}"/>

    <line x1="0" y1="0" x2="-60" y2="80" stroke="${TOKENS.accent.cyan}" stroke-width="2" opacity="0.5"/>
    <circle cx="-60" cy="80" r="20" fill="${TOKENS.accent.violet}"/>
    <circle cx="-60" cy="80" r="8" fill="${TOKENS.bg.navy}"/>

    <line x1="0" y1="0" x2="60" y2="80" stroke="${TOKENS.accent.cyan}" stroke-width="2" opacity="0.5"/>
    <circle cx="60" cy="80" r="20" fill="${TOKENS.accent.violet}"/>
    <circle cx="60" cy="80" r="8" fill="${TOKENS.bg.navy}"/>
  </g>

  <!-- Footer -->
  <text x="100" y="580"
        font-family="Inter, -apple-system, sans-serif"
        font-size="18" fill="${TOKENS.text.muted}">
    github.com/anthropics/claude-fleet
  </text>

  <text x="1100" y="580"
        font-family="Inter, -apple-system, sans-serif"
        font-size="18" fill="${TOKENS.text.muted}" text-anchor="end">
    v2.0.0
  </text>
</svg>`;
}

/**
 * Generate feature card image (1200x630)
 */
function generateFeatureCard({ title, category, description = '' } = {}) {
  const width = 1200;
  const height = 630;
  const cat = getCategory(category);

  const titleLines = wrapText(title, 28);
  const titleY = 220;
  const lineHeight = 65;

  const titleSvg = titleLines
    .slice(0, 2)
    .map(
      (line, i) => `
    <text x="100" y="${titleY + i * lineHeight}"
          font-family="Inter, -apple-system, sans-serif"
          font-size="52" font-weight="700" fill="${TOKENS.text.primary}">
      ${escapeXml(line)}
    </text>
  `
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${TOKENS.bg.navy}"/>
      <stop offset="100%" style="stop-color:${TOKENS.bg.deepBlue}"/>
    </linearGradient>
    <pattern id="dot-grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1.5" fill="white" opacity="0.06"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg-gradient)"/>
  <rect width="${width}" height="${height}" fill="url(#dot-grid)"/>

  <!-- Category accent bar -->
  <rect x="80" y="100" width="6" height="80" rx="3" fill="${cat.accent}"/>

  <!-- Category badge -->
  <rect x="110" y="100" width="${cat.label.length * 12 + 40}" height="36" rx="18"
        fill="${cat.accent}" opacity="0.15"/>
  <text x="130" y="125"
        font-family="Inter, -apple-system, sans-serif"
        font-size="14" font-weight="600" letter-spacing="0.1em"
        fill="${cat.accent}">
    ${cat.label}
  </text>

  <!-- Title -->
  ${titleSvg}

  <!-- Description -->
  ${
    description
      ? `
    <text x="100" y="${titleY + titleLines.slice(0, 2).length * lineHeight + 40}"
          font-family="Inter, -apple-system, sans-serif"
          font-size="24" fill="${TOKENS.text.secondary}">
      ${escapeXml(description.slice(0, 80))}${description.length > 80 ? '...' : ''}
    </text>
  `
      : ''
  }

  <!-- Code block decoration -->
  <rect x="700" y="150" width="420" height="330" rx="12"
        fill="${TOKENS.bg.card}" stroke="${cat.accent}" stroke-opacity="0.3"/>

  <text x="730" y="195"
        font-family="JetBrains Mono, monospace"
        font-size="14" fill="${TOKENS.text.muted}">
    // ${cat.label.toLowerCase()}.ts
  </text>

  <text x="730" y="240"
        font-family="JetBrains Mono, monospace"
        font-size="16" fill="${TOKENS.accent.violet}">
    export class ${escapeXml(title.replace(/\s+/g, ''))} {
  </text>

  <text x="730" y="280"
        font-family="JetBrains Mono, monospace"
        font-size="16" fill="${TOKENS.text.secondary}">
      // Orchestrate intelligence
  </text>

  <text x="730" y="320"
        font-family="JetBrains Mono, monospace"
        font-size="16" fill="${TOKENS.accent.cyan}">
      async execute() {
  </text>

  <text x="730" y="360"
        font-family="JetBrains Mono, monospace"
        font-size="16" fill="${TOKENS.text.primary}">
        return await this.fleet.run();
  </text>

  <text x="730" y="400"
        font-family="JetBrains Mono, monospace"
        font-size="16" fill="${TOKENS.accent.cyan}">
      }
  </text>

  <text x="730" y="440"
        font-family="JetBrains Mono, monospace"
        font-size="16" fill="${TOKENS.accent.violet}">
    }
  </text>

  <!-- Footer -->
  <text x="100" y="580"
        font-family="Inter, -apple-system, sans-serif"
        font-size="18" fill="${TOKENS.text.muted}">
    CLAUDE FLEET
  </text>
</svg>`;
}

/**
 * Generate hero banner (1920x600)
 */
function generateHeroBanner() {
  const width = 1920;
  const height = 600;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${TOKENS.bg.navy}"/>
      <stop offset="100%" style="stop-color:${TOKENS.bg.deepBlue}"/>
    </linearGradient>
    <linearGradient id="accent-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${TOKENS.accent.cyan}"/>
      <stop offset="100%" style="stop-color:${TOKENS.accent.violet}"/>
    </linearGradient>
    <pattern id="dot-grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <circle cx="25" cy="25" r="1.5" fill="white" opacity="0.05"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg-gradient)"/>
  <rect width="${width}" height="${height}" fill="url(#dot-grid)"/>

  <!-- Central content -->
  <text x="${width / 2}" y="200"
        font-family="Inter, -apple-system, sans-serif"
        font-size="80" font-weight="700" fill="${TOKENS.text.primary}"
        text-anchor="middle">
    Claude Fleet
  </text>

  <text x="${width / 2}" y="280"
        font-family="Inter, -apple-system, sans-serif"
        font-size="32" fill="${TOKENS.text.secondary}"
        text-anchor="middle">
    Multi-Agent Orchestration for Claude Code
  </text>

  <!-- Tagline with gradient -->
  <text x="${width / 2}" y="380"
        font-family="Inter, -apple-system, sans-serif"
        font-size="28" font-weight="600" fill="url(#accent-gradient)"
        text-anchor="middle">
    One Lead. Multiple Workers. Unlimited Potential.
  </text>

  <!-- Fleet visualization -->
  <g transform="translate(${width / 2}, 500)">
    <!-- Lead node -->
    <circle cx="0" cy="0" r="30" fill="${TOKENS.accent.cyan}"/>
    <circle cx="0" cy="0" r="12" fill="${TOKENS.bg.navy}"/>

    <!-- Worker nodes spread across -->
    ${[-300, -150, 150, 300]
      .map(
        (x) => `
      <line x1="0" y1="0" x2="${x}" y2="0" stroke="${TOKENS.accent.cyan}" stroke-width="2" opacity="0.4"/>
      <circle cx="${x}" cy="0" r="18" fill="${TOKENS.accent.violet}"/>
      <circle cx="${x}" cy="0" r="7" fill="${TOKENS.bg.navy}"/>
    `
      )
      .join('')}
  </g>
</svg>`;
}

/**
 * Generate favicon (32x32 and 512x512)
 */
function generateFavicon({ size = 512 } = {}) {
  const nodeRadius = size * 0.12;
  const centerX = size / 2;
  const centerY = size / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${TOKENS.bg.navy}"/>
      <stop offset="100%" style="stop-color:${TOKENS.bg.deepBlue}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#bg-gradient)"/>

  <!-- Central node (lead) with glow -->
  <circle cx="${centerX}" cy="${centerY}" r="${nodeRadius * 1.8}" fill="${TOKENS.accent.cyan}" opacity="0.2"/>
  <circle cx="${centerX}" cy="${centerY}" r="${nodeRadius}" fill="${TOKENS.accent.cyan}"/>
  <circle cx="${centerX}" cy="${centerY}" r="${nodeRadius * 0.4}" fill="${TOKENS.bg.navy}"/>

  <!-- Connection dots -->
  <circle cx="${centerX - size * 0.25}" cy="${centerY - size * 0.2}" r="${nodeRadius * 0.4}" fill="${TOKENS.accent.violet}"/>
  <circle cx="${centerX + size * 0.25}" cy="${centerY - size * 0.2}" r="${nodeRadius * 0.4}" fill="${TOKENS.accent.violet}"/>
  <circle cx="${centerX - size * 0.2}" cy="${centerY + size * 0.25}" r="${nodeRadius * 0.4}" fill="${TOKENS.accent.violet}"/>
  <circle cx="${centerX + size * 0.2}" cy="${centerY + size * 0.25}" r="${nodeRadius * 0.4}" fill="${TOKENS.accent.violet}"/>
</svg>`;
}

// ============================================================================
// OUTPUT FUNCTIONS
// ============================================================================

async function saveImage(svg, outputPath, format = 'png') {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (format === 'svg' || !sharp) {
    const svgPath = outputPath.replace(/\.png$/, '.svg');
    await fs.writeFile(svgPath, svg);
    console.log(`✅ Generated: ${path.basename(svgPath)}`);
    return svgPath;
  }

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`✅ Generated: ${path.basename(outputPath)}`);
  return outputPath;
}

// ============================================================================
// CLI
// ============================================================================

async function generateAll(output) {
  console.log('🎨 Generating all Fleet brand assets...\n');

  const assets = [
    { name: 'fleet-logo.png', svg: generateLogo({ size: 512, variant: 'full' }) },
    { name: 'fleet-icon.png', svg: generateLogo({ size: 512, variant: 'icon' }) },
    { name: 'fleet-favicon-512.png', svg: generateFavicon({ size: 512 }) },
    { name: 'fleet-favicon-32.png', svg: generateFavicon({ size: 32 }) },
    { name: 'fleet-social.png', svg: generateSocialPreview({}) },
    { name: 'fleet-hero.png', svg: generateHeroBanner() },
    {
      name: 'feature-workflows.png',
      svg: generateFeatureCard({ title: 'Workflow Engine', category: 'workflows' }),
    },
    {
      name: 'feature-agents.png',
      svg: generateFeatureCard({ title: 'Multi-Agent Teams', category: 'agents' }),
    },
    {
      name: 'feature-storage.png',
      svg: generateFeatureCard({ title: 'Persistent Storage', category: 'storage' }),
    },
    {
      name: 'feature-api.png',
      svg: generateFeatureCard({ title: 'REST API', category: 'api' }),
    },
  ];

  for (const asset of assets) {
    await saveImage(asset.svg, path.join(output, asset.name));
  }

  console.log(`\n✨ Generated ${assets.length} assets in ${output}`);
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const typeIndex = args.indexOf('--type');
  const titleIndex = args.indexOf('--title');
  const categoryIndex = args.indexOf('--category');
  const outputIndex = args.indexOf('--output');
  const formatIndex = args.indexOf('--format');

  const type = typeIndex !== -1 ? args[typeIndex + 1] : null;
  const title = titleIndex !== -1 ? args[titleIndex + 1] : '';
  const category = categoryIndex !== -1 ? args[categoryIndex + 1] : 'default';
  const output = outputIndex !== -1 ? args[outputIndex + 1] : DEFAULT_OUTPUT;
  const format = formatIndex !== -1 ? args[formatIndex + 1] : 'png';

  // Generate all
  if (args.includes('--all')) {
    return generateAll(output);
  }

  // Show help
  if (!type || args.includes('--help') || args.includes('-h')) {
    console.log(`
Fleet Marketing Image Generator

Usage:
  node generate-fleet-image.js --type <type> [options]
  node generate-fleet-image.js --all

Types:
  logo          Logo with wordmark (512x512)
  icon          Icon only (512x512)
  favicon       Favicon (32x32 and 512x512)
  social        Social preview card (1200x630)
  feature       Feature card with code preview (1200x630)
  hero          Hero banner (1920x600)

Options:
  --title       Title text (for social/feature types)
  --category    Category: workflows, agents, storage, api, security, performance
  --output      Output directory (default: docs/images/)
  --format      Output format: png, svg (default: png)
  --all         Generate all standard assets

Examples:
  node generate-fleet-image.js --type logo
  node generate-fleet-image.js --type social --title "Orchestrate Intelligence"
  node generate-fleet-image.js --type feature --title "Workflow Engine" --category workflows
  node generate-fleet-image.js --all
`);
    return;
  }

  // Generate single asset
  let svg;
  let filename;

  switch (type) {
    case 'logo':
      svg = generateLogo({ size: 512, variant: 'full' });
      filename = 'fleet-logo.png';
      break;
    case 'icon':
      svg = generateLogo({ size: 512, variant: 'icon' });
      filename = 'fleet-icon.png';
      break;
    case 'favicon':
      await saveImage(generateFavicon({ size: 512 }), path.join(output, 'fleet-favicon-512.png'), format);
      await saveImage(generateFavicon({ size: 32 }), path.join(output, 'fleet-favicon-32.png'), format);
      return;
    case 'social':
      svg = generateSocialPreview({ title });
      filename = `fleet-social${title ? '-' + title.toLowerCase().replace(/\s+/g, '-') : ''}.png`;
      break;
    case 'feature':
      svg = generateFeatureCard({ title, category });
      filename = `feature-${category || title.toLowerCase().replace(/\s+/g, '-')}.png`;
      break;
    case 'hero':
      svg = generateHeroBanner();
      filename = 'fleet-hero.png';
      break;
    default:
      console.error(`Unknown type: ${type}`);
      process.exit(1);
  }

  await saveImage(svg, path.join(output, filename), format);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
