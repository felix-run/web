/**
 * The agentskills.io bundle rules the Felix harness enforces, in TypeScript, so
 * an editor can check a SKILL.md as it is typed.
 *
 * The harness is the authority: every save is re-validated, re-reviewed and
 * re-scanned server-side, and what it decides is what happens. The rules are
 * the harness's `felix/skills/format.py` — its path allowlist, size caps,
 * anchor refusal and name rule — so the two agree message for message.
 */

export {
  BINARY_ASSET_EXTENSIONS,
  base64DecodedSize,
  binaryAssetMimeType,
  decodeBase64,
  encodeBase64,
  isBinaryAssetPath,
  isValidBase64,
  MAX_BINARY_ASSET_BYTES,
  PREVIEWABLE_IMAGE_TYPES,
} from './binary';
export {
  BUNDLE_DIRS,
  bundlePathIssue,
  codePoints,
  createSkillTemplate,
  extractDiscoveryMeta,
  isAllowedPath,
  isValidSkillName,
  MAX_BUNDLE_FILES,
  MAX_SKILL_MD_CHARS,
  parseSkillMd,
  serializeSkillMd,
  updateSkillMdFrontmatter,
  utf8Bytes,
  type ValidationIssue,
  validateSkillBundle,
  validateSkillName,
} from './format';
export {
  isAllowedHostPattern,
  parsePluginManifest,
  pluginManifestProblem,
} from './plugin';
export {
  estimateImpactScore,
  type ReviewCheck,
  reviewSkillBundle,
} from './review';
export {
  MAX_FILE_CHARS,
  scanSkillSecurity,
} from './security';
export {
  bumpSemver,
  compareSemver,
  resolveNextSemver,
} from './semver';
