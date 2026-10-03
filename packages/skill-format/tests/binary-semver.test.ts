import { describe, expect, it } from 'vitest';
import {
  base64DecodedSize,
  binaryAssetMimeType,
  bumpSemver,
  compareSemver,
  decodeBase64,
  encodeBase64,
  isBinaryAssetPath,
  isValidBase64,
  MAX_BINARY_ASSET_BYTES,
  PREVIEWABLE_IMAGE_TYPES,
  resolveNextSemver,
} from '../src';

describe('binary assets', () => {
  it('recognises the harness extensions, case-insensitively', () => {
    expect(isBinaryAssetPath('assets/Logo.PNG')).toBe(true);
    expect(isBinaryAssetPath('assets/manual.pdf')).toBe(true);
    expect(isBinaryAssetPath('assets/data.json')).toBe(false);
    expect(isBinaryAssetPath('assets/icon.svg')).toBe(false);
  });

  it('maps known types and falls back for unknown ones', () => {
    expect(binaryAssetMimeType('assets/photo.JPG')).toBe('image/jpeg');
    expect(binaryAssetMimeType('assets/mystery.bin')).toBe('application/octet-stream');
  });

  it('never lists markup as previewable', () => {
    expect(PREVIEWABLE_IMAGE_TYPES.has('image/svg+xml')).toBe(false);
    expect(PREVIEWABLE_IMAGE_TYPES.has('text/html')).toBe(false);
    expect(PREVIEWABLE_IMAGE_TYPES.has('image/png')).toBe(true);
  });

  it('round-trips every byte value, and a large array without overflowing the stack', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    expect(decodeBase64(encodeBase64(new Uint8Array(2_000_000).fill(7))).length).toBe(2_000_000);
    expect(decodeBase64(encodeBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('measures decoded size across padding cases', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 100, 4095]) {
      expect(base64DecodedSize(encodeBase64(new Uint8Array(length)))).toBe(length);
    }
  });

  it('validates base64 shape', () => {
    expect(isValidBase64('not base64!!')).toBe(false);
    expect(isValidBase64('abc')).toBe(false);
    expect(isValidBase64('aGVsbG8=')).toBe(true);
    expect(MAX_BINARY_ASSET_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('semver', () => {
  it('bumps patch by default, and minor and major', () => {
    expect(bumpSemver('1.2.3')).toBe('1.2.4');
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });

  it('compares numerically, not as text', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0-rc1')).toBe(0);
    expect(compareSemver('0.1.0', '0.1.1')).toBe(-1);
  });

  it('resolves an explicit version, a bump from a parent, or the first version', () => {
    expect(resolveNextSemver('2.0.0', { bump: 'minor' })).toBe('2.1.0');
    expect(resolveNextSemver('2.0.0', { semver: '3.0.0' })).toBe('3.0.0');
    expect(resolveNextSemver(null, {})).toBe('0.1.0');
  });
});
