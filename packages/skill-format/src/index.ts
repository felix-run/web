/**
 * The agentskills.io bundle rules the Felix harness enforces, in TypeScript, so
 * an editor can check a SKILL.md as it is typed.
 *
 * The harness is the authority: every save is re-validated, re-reviewed and
 * re-scanned server-side, and what it decides is what happens. Ported from an
 * MIT-licensed TypeScript implementation by this repo's author, then tightened
 * to the harness's `felix/skills/format.py` — its path allowlist, size caps,
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
  ALLOWED_ROOT_FILES,
  BUNDLE_DIRS,
  bundlePathIssue,
  codePoints,
  createSkillTemplate,
  extractDiscoveryMeta,
  isAllowedPath,
  isValidSkillName,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  MAX_FRONTMATTER_CHARS,
  MAX_FRONTMATTER_DEPTH,
  MAX_SKILL_MD_CHARS,
  parseSkillMd,
  SKILL_NAME_RE,
  type SkillBundle,
  type SkillFrontmatter,
  serializeSkillMd,
  splitFrontmatter,
  updateSkillMdFrontmatter,
  utf8Bytes,
  type ValidationIssue,
  type ValidationResult,
  validateSkillBundle,
  validateSkillName,
} from './format';
export {
  HOST_MESSAGE,
  isAllowedHostPattern,
  type PluginManifest,
  parsePluginManifest,
  pluginManifestProblem,
} from './plugin';
export {
  estimateImpactScore,
  type ReviewCheck,
  type ReviewRubricConfig,
  reviewSkillBundle,
  type SkillReviewResult,
} from './review';
export {
  MAX_FILE_CHARS,
  type ScanStatus,
  type SecurityIssue,
  type SecurityScanResult,
  type Severity,
  scanSkillSecurity,
} from './security';
export {
  bumpSemver,
  compareSemver,
  resolveNextSemver,
  type SemverBump,
  VERSION_RE,
} from './semver';
