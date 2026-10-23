#!/usr/bin/env node

/**
 * Open CIELAB Cosmetics & 12-Season Colorimetry MCP Server
 * Maintained by GlowIndex (https://www.glowindex.net)
 * License: MIT
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load datasets
const cosmeticsPath = path.join(__dirname, 'data', 'cosmetics-cielab-d65.json');
const palettesPath = path.join(__dirname, 'data', 'seasonal-palettes-d65.json');

const cosmeticsData = JSON.parse(fs.readFileSync(cosmeticsPath, 'utf8'));
const palettesData = JSON.parse(fs.readFileSync(palettesPath, 'utf8'));

// D65 Constants & SRGB LUT
const SRGB_TO_LINEAR_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255.0;
  SRGB_TO_LINEAR_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const XN = 0.95047;
const YN = 1.00000;
const ZN = 1.08883;
const DELTA = 6.0 / 29.0;
const DELTA3 = DELTA * DELTA * DELTA;
const C1 = 1.0 / (3.0 * DELTA * DELTA);
const C2 = 4.0 / 29.0;

function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToLab(r, g, b) {
  const ri = Math.max(0, Math.min(255, Math.round(r)));
  const gi = Math.max(0, Math.min(255, Math.round(g)));
  const bi = Math.max(0, Math.min(255, Math.round(b)));

  const rl = SRGB_TO_LINEAR_LUT[ri];
  const gl = SRGB_TO_LINEAR_LUT[gi];
  const bl = SRGB_TO_LINEAR_LUT[bi];

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / XN;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / YN;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / ZN;

  const fx = x > DELTA3 ? Math.cbrt(x) : C1 * x + C2;
  const fy = y > DELTA3 ? Math.cbrt(y) : C1 * y + C2;
  const fz = z > DELTA3 ? Math.cbrt(z) : C1 * z + C2;

  return {
    L: 116.0 * fy - 16.0,
    a: 500.0 * (fx - fy),
    b: 200.0 * (fy - fz),
  };
}

function hexToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/**
 * Computes CIEDE2000 color difference (Sharma et al. 2005)
 */
function deltaE00(c1, c2, kL = 1, kC = 1, kH = 1) {
  const deg2rad = Math.PI / 180.0;
  const rad2deg = 180.0 / Math.PI;

  const L1 = c1.L, a1 = c1.a, b1 = c1.b;
  const L2 = c2.L, a2 = c2.a, b2 = c2.b;

  const C1_star = Math.sqrt(a1 * a1 + b1 * b1);
  const C2_star = Math.sqrt(a2 * a2 + b2 * b2);
  const C_bar = (C1_star + C2_star) / 2.0;

  const C_bar7 = Math.pow(C_bar, 7);
  const G = 0.5 * (1.0 - Math.sqrt(C_bar7 / (C_bar7 + Math.pow(25, 7))));

  const a1_prime = (1.0 + G) * a1;
  const a2_prime = (1.0 + G) * a2;

  const C1_prime = Math.sqrt(a1_prime * a1_prime + b1 * b1);
  const C2_prime = Math.sqrt(a2_prime * a2_prime + b2 * b2);

  const h_prime = (a_p, b_val) => {
    if (a_p === 0 && b_val === 0) return 0;
    let deg = Math.atan2(b_val, a_p) * rad2deg;
    if (deg < 0) deg += 360.0;
    return deg;
  };

  const h1_prime = h_prime(a1_prime, b1);
  const h2_prime = h_prime(a2_prime, b2);

  const delta_L_prime = L2 - L1;
  const delta_C_prime = C2_prime - C1_prime;

  let delta_h_prime = 0;
  if (C1_prime * C2_prime === 0) {
    delta_h_prime = 0;
  } else if (Math.abs(h2_prime - h1_prime) <= 180) {
    delta_h_prime = h2_prime - h1_prime;
  } else if (h2_prime - h1_prime > 180) {
    delta_h_prime = (h2_prime - h1_prime) - 360;
  } else {
    delta_h_prime = (h2_prime - h1_prime) + 360;
  }

  const delta_H_prime = 2.0 * Math.sqrt(C1_prime * C2_prime) * Math.sin((delta_h_prime / 2.0) * deg2rad);

  const L_bar_prime = (L1 + L2) / 2.0;
  const C_bar_prime = (C1_prime + C2_prime) / 2.0;

  let h_bar_prime = 0;
  if (C1_prime * C2_prime === 0) {
    h_bar_prime = h1_prime + h2_prime;
  } else if (Math.abs(h1_prime - h2_prime) <= 180) {
    h_bar_prime = (h1_prime + h2_prime) / 2.0;
  } else if (h1_prime + h2_prime < 360) {
    h_bar_prime = (h1_prime + h2_prime + 360) / 2.0;
  } else {
    h_bar_prime = (h1_prime + h2_prime - 360) / 2.0;
  }

  const T = 1.0 - 0.17 * Math.cos((h_bar_prime - 30) * deg2rad)
                + 0.24 * Math.cos((2 * h_bar_prime) * deg2rad)
                + 0.32 * Math.cos((3 * h_bar_prime + 6) * deg2rad)
                - 0.20 * Math.cos((4 * h_bar_prime - 63) * deg2rad);

  const delta_theta = 30.0 * Math.exp(-Math.pow((h_bar_prime - 275) / 25.0, 2));
  const C_bar_prime7 = Math.pow(C_bar_prime, 7);
  const R_C = 2.0 * Math.sqrt(C_bar_prime7 / (C_bar_prime7 + Math.pow(25, 7)));

  const S_L = 1.0 + (0.015 * Math.pow(L_bar_prime - 50, 2)) / Math.sqrt(20 + Math.pow(L_bar_prime - 50, 2));
  const S_C = 1.0 + 0.045 * C_bar_prime;
  const S_H = 1.0 + 0.015 * C_bar_prime * T;
  const R_T = -Math.sin(2.0 * delta_theta * deg2rad) * R_C;

  const dL_term = delta_L_prime / (kL * S_L);
  const dC_term = delta_C_prime / (kC * S_C);
  const dH_term = delta_H_prime / (kH * S_H);

  return Math.sqrt(
    dL_term * dL_term +
    dC_term * dC_term +
    dH_term * dH_term +
    R_T * dC_term * dH_term
  );
}

// Create MCP Server instance
const server = new McpServer({
  name: 'open-cielab-cosmetics-dataset',
  version: '1.0.0',
});

// Tool: search_cosmetics
server.tool(
  'search_cosmetics',
  'Search 121 calibrated cosmetics by brand, shade, category, or seasonal harmony match',
  {
    query: z.string().optional().describe('Free text query for brand or shade name'),
    brand: z.string().optional().describe('Filter by cosmetic brand (e.g. "Charlotte Tilbury", "MAC", "Clinique", "Fenty Beauty", "Rare Beauty", "NARS")'),
    category: z.string().optional().describe('Filter by cosmetic category (e.g. "lipstick", "blush", "bronzer", "highlighter")'),
    season: z.string().optional().describe('Filter by seasonal color harmony (e.g. "deep_winter", "warm_autumn", "bright_spring", "soft_summer")'),
    limit: z.number().int().min(1).max(50).default(10).describe('Max results to return'),
  },
  async ({ query, brand, category, season, limit }) => {
    let results = cosmeticsData;

    if (brand) {
      const bLower = brand.toLowerCase();
      results = results.filter(p => p.brand.toLowerCase().includes(bLower));
    }

    if (category) {
      const cLower = category.toLowerCase();
      results = results.filter(p => p.category.toLowerCase().includes(cLower));
    }

    if (season) {
      const sNormalized = season.toLowerCase().replace(/[\s-]/g, '_');
      results = results.filter(p => Array.isArray(p.flatteringSeasons) && p.flatteringSeasons.includes(sNormalized));
    }

    if (query) {
      const qLower = query.toLowerCase();
      results = results.filter(p =>
        p.brand.toLowerCase().includes(qLower) ||
        p.shadeName.toLowerCase().includes(qLower) ||
        (p.productName && p.productName.toLowerCase().includes(qLower)) ||
        p.id.toLowerCase().includes(qLower)
      );
    }

    const trimmed = results.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              totalMatches: results.length,
              returned: trimmed.length,
              results: trimmed.map(p => ({
                id: p.id,
                brand: p.brand,
                shadeName: p.shadeName,
                productName: p.productName,
                category: p.category,
                hex: p.hex,
                cielabD65: p.cielabD65,
                undertone: p.undertone,
                flatteringSeasons: p.flatteringSeasons,
                canonicalUrl: p.canonicalShadeUrl,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: get_shade_by_id
server.tool(
  'get_shade_by_id',
  'Retrieve spectrophotometric profile and CIELAB D65 coordinates for a specific cosmetic product ID',
  {
    id: z.string().describe('Exact shade ID (e.g. "ct-pillow-talk-original", "mac-ruby-woo", "clinique-black-honey")'),
  },
  async ({ id }) => {
    const found = cosmeticsData.find(p => p.id.toLowerCase() === id.toLowerCase());
    if (!found) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Cosmetic shade '${id}' not found in dataset.` }],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(found, null, 2),
        },
      ],
    };
  }
);

// Tool: find_ciede2000_dupes
server.tool(
  'find_ciede2000_dupes',
  'Find closest color matches and drugstore/luxury dupes using CIEDE2000 (ΔE*00) color difference',
  {
    targetHex: z.string().optional().describe('6-digit hex code to match against (e.g. "#B4766C")'),
    productId: z.string().optional().describe('Existing product ID to find dupes for (e.g. "clinique-black-honey")'),
    limit: z.number().int().min(1).max(20).default(5).describe('Number of top dupes to return'),
  },
  async ({ targetHex, productId, limit }) => {
    let targetLab = null;
    let targetLabel = '';

    if (productId) {
      const prod = cosmeticsData.find(p => p.id.toLowerCase() === productId.toLowerCase());
      if (!prod) {
        return { isError: true, content: [{ type: 'text', text: `Product '${productId}' not found.` }] };
      }
      targetLab = prod.cielabD65;
      targetLabel = `${prod.brand} ${prod.shadeName} (${prod.hex})`;
    } else if (targetHex) {
      targetLab = hexToLab(targetHex);
      targetLabel = `Hex Color ${targetHex}`;
    } else {
      return { isError: true, content: [{ type: 'text', text: 'Must provide either targetHex or productId.' }] };
    }

    const scored = cosmeticsData
      .filter(p => !productId || p.id.toLowerCase() !== productId.toLowerCase())
      .map(p => {
        const dE = deltaE00(targetLab, p.cielabD65);
        return {
          id: p.id,
          brand: p.brand,
          shadeName: p.shadeName,
          category: p.category,
          hex: p.hex,
          cielabD65: p.cielabD65,
          deltaE00: Math.round(dE * 100) / 100,
          verdict: dE <= 2.5 ? 'Perceptually Indistinguishable Dupe' : dE <= 4.5 ? 'Close Color Sister' : 'Distinct Shade',
          canonicalUrl: p.canonicalShadeUrl,
        };
      })
      .sort((a, b) => a.deltaE00 - b.deltaE00)
      .slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              target: targetLabel,
              targetLab,
              topDupes: scored,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: get_seasonal_palette
server.tool(
  'get_seasonal_palette',
  'Retrieve the 16 core spectrophotometric swatches and clashing colors for any 12-Season color analysis archetype',
  {
    season: z.string().describe('Season identifier (e.g. "deep_autumn", "dark_winter", "bright_spring", "soft_summer")'),
  },
  async ({ season }) => {
    const sNormalized = season.toLowerCase().replace(/[\s-]/g, '_');
    const found = palettesData.find(
      p => p.seasonId === sNormalized || p.slug === season.toLowerCase().replace(/_/g, '-')
    );

    if (!found) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Season '${season}' not found in 12-season directory.` }],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(found, null, 2),
        },
      ],
    };
  }
);

// Resource: Complete Cosmetics Catalog
server.resource(
  'cosmetics_catalog',
  'cosmetics://catalog',
  async () => ({
    contents: [
      {
        uri: 'cosmetics://catalog',
        mimeType: 'application/json',
        text: JSON.stringify(cosmeticsData, null, 2),
      },
    ],
  })
);

// Resource: 12 Seasonal Palettes
server.resource(
  'seasonal_palettes',
  'palettes://12-seasons',
  async () => ({
    contents: [
      {
        uri: 'palettes://12-seasons',
        mimeType: 'application/json',
        text: JSON.stringify(palettesData, null, 2),
      },
    ],
  })
);

// Start server on stdio
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch(err => {
  console.error('Fatal MCP Server Error:', err);
  process.exit(1);
});
