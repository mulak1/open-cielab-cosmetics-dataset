import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Cosmetics & Palettes Datasets exist and are valid JSON', () => {
  const cosmeticsPath = path.join(__dirname, '..', 'data', 'cosmetics-cielab-d65.json');
  const palettesPath = path.join(__dirname, '..', 'data', 'seasonal-palettes-d65.json');

  const cosmetics = JSON.parse(fs.readFileSync(cosmeticsPath, 'utf8'));
  const palettes = JSON.parse(fs.readFileSync(palettesPath, 'utf8'));

  assert.equal(Array.isArray(cosmetics), true);
  assert.equal(cosmetics.length >= 100, true);
  assert.equal(Array.isArray(palettes), true);
  assert.equal(palettes.length, 12);

  const sample = cosmetics[0];
  assert.ok(sample.id);
  assert.ok(sample.brand);
  assert.ok(sample.hex);
  assert.ok(sample.cielabD65);
  assert.ok(typeof sample.cielabD65.L === 'number');
  assert.ok(typeof sample.cielabD65.a === 'number');
  assert.ok(typeof sample.cielabD65.b === 'number');
});
