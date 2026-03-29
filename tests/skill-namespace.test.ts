import { describe, it, expect } from 'vitest';
import {
  SKILL_NAMESPACE,
  prefixSkillName,
  unprefixSkillName,
  getAllSkillNames,
  LEGACY_SKILL_NAMES,
} from '../src/cli/plugins.js';

describe('SKILL_NAMESPACE', () => {
  it('is devflow:', () => {
    expect(SKILL_NAMESPACE).toBe('devflow:');
  });
});

describe('prefixSkillName', () => {
  it('adds devflow: prefix to bare name', () => {
    expect(prefixSkillName('core-patterns')).toBe('devflow:core-patterns');
    expect(prefixSkillName('typescript')).toBe('devflow:typescript');
    expect(prefixSkillName('go')).toBe('devflow:go');
  });

  it('is a no-op for already-prefixed names', () => {
    expect(prefixSkillName('devflow:core-patterns')).toBe('devflow:core-patterns');
    expect(prefixSkillName('devflow:go')).toBe('devflow:go');
  });
});

describe('unprefixSkillName', () => {
  it('strips devflow: prefix', () => {
    expect(unprefixSkillName('devflow:core-patterns')).toBe('core-patterns');
    expect(unprefixSkillName('devflow:typescript')).toBe('typescript');
  });

  it('is a no-op for bare names', () => {
    expect(unprefixSkillName('core-patterns')).toBe('core-patterns');
    expect(unprefixSkillName('go')).toBe('go');
  });

  it('roundtrips with prefixSkillName', () => {
    const names = ['core-patterns', 'security-patterns', 'go', 'react'];
    for (const name of names) {
      expect(unprefixSkillName(prefixSkillName(name))).toBe(name);
    }
  });
});

describe('LEGACY_SKILL_NAMES includes all current bare names for migration', () => {
  it('every current skill name has a legacy entry for cleanup', () => {
    const currentSkills = getAllSkillNames();
    for (const skill of currentSkills) {
      expect(LEGACY_SKILL_NAMES, `LEGACY_SKILL_NAMES should include '${skill}' for migration cleanup`).toContain(skill);
    }
  });
});
