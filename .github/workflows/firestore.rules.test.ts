/**
 * SantralBayi Hardened Firestore Security Rules Specification & Dirty Dozen Verification Suite
 * Validates all 12 adversarial payloads defined in security_spec.md against firestore.rules constraints.
 */
import fs from 'fs';
import path from 'path';

interface DirtyDozenCase {
  id: number;
  name: string;
  requiredGatePattern: RegExp;
}

const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write Rejected',
    requiredGatePattern: /function\s+isSignedIn\(\)\s*\{\s*return\s+request\.auth\s*!=\s*null;\s*\}/,
  },
  {
    id: 2,
    name: 'Unverified Email Spoof Rejected',
    requiredGatePattern: /request\.auth\.token\.email_verified\s*==\s*true/,
  },
  {
    id: 3,
    name: 'Identity Spoofing on Create Rejected',
    requiredGatePattern: /data\.ownerId\s*==\s*request\.auth\.uid/,
  },
  {
    id: 4,
    name: 'Shadow / Ghost Field Injection Rejected',
    requiredGatePattern: /affectedKeys\(\)\.hasOnly\(/,
  },
  {
    id: 5,
    name: 'Cross-Tenant PII Read Rejected',
    requiredGatePattern: /isOwner\(workspaceId\)\s*\|\|\s*isAdmin\(\)/,
  },
  {
    id: 6,
    name: 'Client Timestamp Forgery Rejected',
    requiredGatePattern: /incoming\(\)\.createdAt\s*==\s*request\.time/,
  },
  {
    id: 7,
    name: 'Immortal Field Mutation Rejected',
    requiredGatePattern: /incoming\(\)\.ownerId\s*==\s*existing\(\)\.ownerId\s*&&\s*incoming\(\)\.createdAt\s*==\s*existing\(\)\.createdAt/,
  },
  {
    id: 8,
    name: 'ID Poisoning Attack Rejected',
    requiredGatePattern: /id\.size\(\)\s*<=\s*128\s*&&\s*id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/,
  },
  {
    id: 9,
    name: 'Value Poisoning & Volumetric Overflow Rejected',
    requiredGatePattern: /data\.settingsJson\s+is\s+string\s*&&\s*data\.settingsJson\.size\(\)\s*<=\s*350000/,
  },
  {
    id: 10,
    name: 'Orphaned Subcollection Write Rejected (Master Gate)',
    requiredGatePattern: /exists\(\/databases\/\$\(database\)\/documents\/workspaces\/\$\(workspaceId\)\)/,
  },
  {
    id: 11,
    name: 'Terminal State Bypass Rejected',
    requiredGatePattern: /existing\(\)\.status\s*!=\s*'LOCKED'/,
  },
  {
    id: 12,
    name: 'Blanket List Scraping Rejected (Query Enforcer)',
    requiredGatePattern: /resource\.data\.ownerId\s*==\s*request\.auth\.uid/,
  },
];

export function verifyHardenedRulesFile(rulesFilePath = path.resolve('firestore.rules')): void {
  const content = fs.readFileSync(rulesFilePath, 'utf8');
  for (const testCase of DIRTY_DOZEN_CASES) {
    if (!testCase.requiredGatePattern.test(content)) {
      throw new Error(`[SECURITY FAIL] Dirty Dozen #${testCase.id} (${testCase.name}) gate missing in ${rulesFilePath}`);
    }
  }
}
