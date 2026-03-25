#!/usr/bin/env node

// scripts/hooks/json-helper.cjs
// Provides jq-equivalent operations for hooks when jq is not installed.
// SECURITY: This is a local CLI helper invoked only by shell hooks with controlled arguments.
// File path arguments come from hook-owned variables, not from external/untrusted input.
// Usage: node json-helper.cjs <operation> [args...]
//
// Operations:
//   get-field <field> [default]           Read field from stdin JSON
//   get-field-file <file> <field> [def]   Read field from JSON file
//   validate                              Exit 0 if stdin is valid JSON, 1 otherwise
//   compact                               Compact stdin JSON to single line
//   construct <json-template> [--arg k v] Build JSON object with args
//   update-field <field> <value> [--json] Set field on stdin JSON (--json parses value)
//   update-fields <json-patches>          Apply multiple field updates from stdin JSON
//   extract-text-messages                 Extract text content from Claude message format
//   merge-evidence                        Flatten, dedupe, limit to 10 from stdin JSON
//   slurp-sort <file> <field> [limit]     Read JSONL, sort by field desc, limit results
//   slurp-cap <file> <field> <limit>      Read JSONL, sort by field desc, output limit lines
//   array-length <path>                   Get length of array at dotted path in stdin JSON
//   array-item <path> <index>             Get item at index from array at path in stdin JSON
//   session-output <context>              Build SessionStart output envelope
//   prompt-output <context>               Build UserPromptSubmit output envelope
//   backup-construct                      Build pre-compact backup JSON from --arg pairs
//   learning-created <file>               Extract created artifacts from learning log
//   learning-new <file> <since_epoch>     Find new artifacts since epoch
//   temporal-decay <file>                 Apply temporal decay to learning log entries
//   process-observations <resp> <log>     Merge model observations into learning log
//   create-artifacts <resp> <log> <dir>   Create command/skill files from ready observations
//   filter-observations <file> [sort] [n] Filter valid observations, sort desc, limit

'use strict';

const fs = require('fs');
const path = require('path');

const op = process.argv[2];
const args = process.argv.slice(3);

/**
 * Resolve a file path argument to an absolute path.
 * Note: path.resolve() normalizes away '..' segments, so the includes check
 * only catches the rare case of literal '..' in a directory name after resolution.
 * Primary value is ensuring all file operations use absolute paths.
 */
function safePath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.includes('..')) {
    throw new Error(`Refused path with traversal: ${filePath}`);
  }
  return resolved;
}

function readStdin() {
  try {
    return fs.readFileSync('/dev/stdin', 'utf8').trim();
  } catch {
    return '';
  }
}

function getNestedField(obj, field) {
  const parts = field.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function parseJsonl(file) {
  const lines = fs.readFileSync(safePath(file), 'utf8').trim().split('\n').filter(Boolean);
  return lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// --- Learning system constants ---
const DECAY_FACTORS = [1.0, 0.90, 0.81, 0.73, 0.66, 0.59, 0.53];
const CONFIDENCE_FLOOR = 0.10;
const DECAY_PERIOD_DAYS = 30;
const REQUIRED_OBSERVATIONS = 3;
const TEMPORAL_SPREAD_SECS = 86400;

function learningLog(msg) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  process.stderr.write(`[${ts}] ${msg}\n`);
}

function writeJsonlAtomic(file, entries) {
  const tmp = file + '.tmp';
  const content = entries.length > 0
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function calculateConfidence(count) {
  const raw = Math.floor(count * 100 / REQUIRED_OBSERVATIONS);
  return Math.min(raw, 95) / 100;
}

function mergeEvidence(oldEvidence, newEvidence) {
  const flat = [...(oldEvidence || []), ...(newEvidence || [])];
  const unique = [...new Set(flat)];
  return unique.slice(0, 10);
}

/** Extract artifact display name from its file path. */
function artifactName(obs) {
  const parts = (obs.artifact_path || '').split('/');
  if (obs.type === 'workflow') {
    return (parts.pop() || '').replace(/\.md$/, '');
  }
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

function parseArgs(argList) {
  const result = {};
  const jsonArgs = {};
  for (let i = 0; i < argList.length; i++) {
    if (argList[i] === '--arg' && i + 2 < argList.length) {
      result[argList[i + 1]] = argList[i + 2];
      i += 2;
    } else if (argList[i] === '--argjson' && i + 2 < argList.length) {
      try {
        jsonArgs[argList[i + 1]] = JSON.parse(argList[i + 2]);
      } catch {
        jsonArgs[argList[i + 1]] = argList[i + 2];
      }
      i += 2;
    }
  }
  return { ...result, ...jsonArgs };
}

try {
  switch (op) {
    case 'get-field': {
      const input = JSON.parse(readStdin());
      const field = args[0];
      const def = args[1] || '';
      const val = getNestedField(input, field);
      console.log(val != null ? String(val) : def);
      break;
    }

    case 'get-field-file': {
      const file = safePath(args[0]);
      const field = args[1];
      const def = args[2] || '';
      const content = fs.readFileSync(file, 'utf8').trim();
      const input = JSON.parse(content);
      const val = getNestedField(input, field);
      console.log(val != null ? String(val) : def);
      break;
    }

    case 'validate': {
      try {
        const text = readStdin();
        if (!text) process.exit(1);
        JSON.parse(text);
        process.exit(0);
      } catch {
        process.exit(1);
      }
      break;
    }

    case 'compact': {
      const input = JSON.parse(readStdin());
      console.log(JSON.stringify(input));
      break;
    }

    case 'construct': {
      // Build JSON from --arg/--argjson pairs
      const template = parseArgs(args);
      console.log(JSON.stringify(template));
      break;
    }

    case 'update-field': {
      const input = JSON.parse(readStdin());
      const field = args[0];
      const value = args[1];
      const isJson = args[2] === '--json';
      input[field] = isJson ? JSON.parse(value) : value;
      console.log(JSON.stringify(input));
      break;
    }

    case 'update-fields': {
      // Read stdin JSON, apply field updates from args: field1=val1 field2=val2
      const input = JSON.parse(readStdin());
      for (const arg of args) {
        const eqIdx = arg.indexOf('=');
        if (eqIdx > 0) {
          const key = arg.slice(0, eqIdx);
          const val = arg.slice(eqIdx + 1);
          // Try to parse as JSON, fall back to string
          try { input[key] = JSON.parse(val); } catch { input[key] = val; }
        }
      }
      console.log(JSON.stringify(input));
      break;
    }

    case 'extract-text-messages': {
      const input = JSON.parse(readStdin());
      const content = input?.message?.content;
      if (typeof content === 'string') {
        console.log(content);
        break;
      }
      if (!Array.isArray(content)) {
        console.log('');
        break;
      }
      const texts = content
        .filter(c => c.type === 'text')
        .map(c => c.text);
      console.log(texts.join('\n'));
      break;
    }

    case 'merge-evidence': {
      const input = JSON.parse(readStdin());
      // input is [[old_evidence], [new_evidence]] — flatten, dedupe, limit
      const flat = input.flat();
      const unique = [...new Set(flat)];
      console.log(JSON.stringify(unique.slice(0, 10)));
      break;
    }

    case 'slurp-sort': {
      const file = args[0];
      const field = args[1];
      const limit = parseInt(args[2]) || 30;
      const parsed = parseJsonl(file);
      parsed.sort((a, b) => (b[field] || 0) - (a[field] || 0));
      console.log(JSON.stringify(parsed.slice(0, limit)));
      break;
    }

    case 'slurp-cap': {
      // Read JSONL, sort by field desc, output top N as JSONL (one per line)
      const file = args[0];
      const field = args[1];
      const limit = parseInt(args[2]) || 100;
      const parsed = parseJsonl(file);
      parsed.sort((a, b) => (b[field] || 0) - (a[field] || 0));
      for (const item of parsed.slice(0, limit)) {
        console.log(JSON.stringify(item));
      }
      break;
    }

    case 'array-length': {
      const input = JSON.parse(readStdin());
      const path = args[0];
      const arr = getNestedField(input, path);
      console.log(Array.isArray(arr) ? arr.length : 0);
      break;
    }

    case 'array-item': {
      const input = JSON.parse(readStdin());
      const path = args[0];
      const index = parseInt(args[1]);
      const arr = getNestedField(input, path);
      if (Array.isArray(arr) && index >= 0 && index < arr.length) {
        console.log(JSON.stringify(arr[index]));
      } else {
        console.log('null');
      }
      break;
    }

    case 'session-output': {
      const ctx = args[0];
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: ctx,
        },
      }));
      break;
    }

    case 'prompt-output': {
      const ctx = args[0];
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: ctx,
        },
      }));
      break;
    }

    case 'backup-construct': {
      const data = parseArgs(args);
      console.log(JSON.stringify({
        timestamp: data.ts || '',
        trigger: 'pre-compact',
        memory_snapshot: data.memory || '',
        git: {
          branch: data.branch || '',
          status: data.status || '',
          log: data.log || '',
          diff_stat: data.diff || '',
        },
      }, null, 2));
      break;
    }

    case 'learning-created': {
      // Extract created artifacts from learning log JSONL
      const file = args[0];
      const parsed = parseJsonl(file);

      const created = parsed.filter(o => o.status === 'created' && o.artifact_path);

      const formatEntry = o => ({
        name: artifactName(o),
        conf: (Math.floor(o.confidence * 10) / 10).toString(),
      });

      const commands = created.filter(o => o.type === 'workflow').slice(0, 5).map(formatEntry);
      const skills = created.filter(o => o.type === 'procedural').slice(0, 5).map(formatEntry);

      console.log(JSON.stringify({ commands, skills }));
      break;
    }

    case 'learning-new': {
      const file = args[0];
      const parsed = parseJsonl(file);

      const created = parsed.filter(o => o.status === 'created' && o.last_seen);
      const messages = created.map(o => {
        const name = artifactName(o);
        return o.type === 'workflow'
          ? `NEW: /self-learning/${name} command created from repeated workflow`
          : `NEW: ${name} skill created from procedural knowledge`;
      });

      console.log(messages.join('\n'));
      break;
    }

    case 'temporal-decay': {
      const file = safePath(args[0]);
      if (!fs.existsSync(file)) {
        console.log(JSON.stringify({ removed: 0, decayed: 0 }));
        break;
      }
      const entries = parseJsonl(file);
      const now = Date.now() / 1000;
      let removed = 0;
      let decayed = 0;
      const results = [];
      for (const entry of entries) {
        if (entry.last_seen) {
          const lastDate = new Date(entry.last_seen);
          if (isNaN(lastDate.getTime())) {
            learningLog(`Warning: invalid date in ${entry.id || 'unknown'}: ${entry.last_seen}`);
            results.push(entry);
            continue;
          }
          const lastEpoch = lastDate.getTime() / 1000;
          const days = Math.floor((now - lastEpoch) / 86400);
          const periods = Math.floor(days / DECAY_PERIOD_DAYS);
          if (periods > 0) {
            const factor = periods < DECAY_FACTORS.length
              ? DECAY_FACTORS[periods] : DECAY_FACTORS[DECAY_FACTORS.length - 1];
            const newConf = Math.round(entry.confidence * factor * 100) / 100;
            if (newConf < CONFIDENCE_FLOOR) {
              removed++;
              learningLog(`Removed ${entry.id || 'unknown'}: confidence ${newConf} below threshold`);
              continue;
            }
            entry.confidence = newConf;
            decayed++;
          }
        }
        results.push(entry);
      }
      writeJsonlAtomic(file, results);
      learningLog(`Temporal decay: removed=${removed}, decayed=${decayed}`);
      console.log(JSON.stringify({ removed, decayed }));
      break;
    }

    case 'process-observations': {
      const responseFile = safePath(args[0]);
      const logFile = safePath(args[1]);
      const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      const observations = response.observations || [];

      let logEntries = [];
      if (fs.existsSync(logFile)) {
        logEntries = parseJsonl(logFile);
      }
      const logMap = new Map(logEntries.map(e => [e.id, e]));
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      let updated = 0, created = 0, skipped = 0;

      for (let i = 0; i < observations.length; i++) {
        const obs = observations[i];
        if (!obs.id || !obs.type || !obs.pattern) {
          learningLog(`Skipping observation ${i}: missing required field (id='${obs.id || ''}' type='${obs.type || ''}')`);
          skipped++;
          continue;
        }
        if (obs.type !== 'workflow' && obs.type !== 'procedural') {
          learningLog(`Skipping observation ${i}: invalid type '${obs.type}'`);
          skipped++;
          continue;
        }
        if (!obs.id.startsWith('obs_')) {
          learningLog(`Skipping observation ${i}: invalid id format '${obs.id}'`);
          skipped++;
          continue;
        }

        const existing = logMap.get(obs.id);
        if (existing) {
          const newCount = (existing.observations || 0) + 1;
          existing.observations = newCount;
          existing.evidence = mergeEvidence(existing.evidence || [], obs.evidence || []);
          existing.confidence = calculateConfidence(newCount);
          existing.last_seen = nowIso;
          if (obs.pattern) existing.pattern = obs.pattern;
          if (obs.details) existing.details = obs.details;

          if (existing.status !== 'created') {
            if (existing.confidence >= 0.70 && existing.first_seen) {
              const firstDate = new Date(existing.first_seen);
              if (!isNaN(firstDate.getTime())) {
                const spread = Date.now() / 1000 - firstDate.getTime() / 1000;
                existing.status = spread >= TEMPORAL_SPREAD_SECS ? 'ready' : 'observing';
              }
            }
          }

          learningLog(`Updated ${obs.id}: confidence ${existing.confidence}, status ${existing.status}`);
          updated++;
        } else {
          const newEntry = {
            id: obs.id,
            type: obs.type,
            pattern: obs.pattern,
            confidence: 0.33,
            observations: 1,
            first_seen: nowIso,
            last_seen: nowIso,
            status: 'observing',
            evidence: obs.evidence || [],
            details: obs.details || '',
          };
          logMap.set(obs.id, newEntry);
          learningLog(`New observation ${obs.id}: type=${obs.type} confidence=0.33`);
          created++;
        }
      }

      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      writeJsonlAtomic(logFile, Array.from(logMap.values()));
      console.log(JSON.stringify({ updated, created, skipped }));
      break;
    }

    case 'create-artifacts': {
      const responseFile = safePath(args[0]);
      const logFile = safePath(args[1]);
      const baseDir = safePath(args[2]);
      const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      const artifacts = response.artifacts || [];

      if (artifacts.length === 0) {
        console.log(JSON.stringify({ created: [], skipped: 0 }));
        break;
      }

      let logEntries = [];
      if (fs.existsSync(logFile)) {
        logEntries = parseJsonl(logFile);
      }
      const logMap = new Map(logEntries.map(e => [e.id, e]));
      const createdPaths = [];
      let skippedCount = 0;
      const artDate = new Date().toISOString().slice(0, 10);

      for (const art of artifacts) {
        let name = (art.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
        if (!name) {
          learningLog('Skipping artifact with empty/invalid name');
          skippedCount++;
          continue;
        }

        const obs = logMap.get(art.observation_id);
        if (!obs || obs.status !== 'ready') {
          learningLog(`Skipping artifact for ${art.observation_id} (status: ${obs ? obs.status : 'not found'}, need: ready)`);
          skippedCount++;
          continue;
        }

        let artDir, artPath;
        if (art.type === 'command') {
          artDir = path.join(baseDir, '.claude', 'commands', 'self-learning');
          artPath = path.join(artDir, `${name}.md`);
        } else {
          artDir = path.join(baseDir, '.claude', 'skills', name);
          artPath = path.join(artDir, 'SKILL.md');
        }

        if (fs.existsSync(artPath)) {
          learningLog(`Artifact already exists at ${artPath} — skipping`);
          skippedCount++;
          continue;
        }

        const desc = (art.description || '').replace(/"/g, '\\"');
        const conf = obs.confidence || 0;
        const obsN = obs.observations || 0;

        fs.mkdirSync(artDir, { recursive: true });

        let content;
        if (art.type === 'command') {
          content = [
            '---',
            `description: "${desc}"`,
            `# devflow-learning: auto-generated (${artDate}, confidence: ${conf}, obs: ${obsN})`,
            '---',
            '',
            art.content || '',
            '',
          ].join('\n');
        } else {
          content = [
            '---',
            `name: self-learning:${name}`,
            `description: "${desc}"`,
            'user-invocable: false',
            'allowed-tools: Read, Grep, Glob',
            `# devflow-learning: auto-generated (${artDate}, confidence: ${conf}, obs: ${obsN})`,
            '---',
            '',
            art.content || '',
            '',
          ].join('\n');
        }

        fs.writeFileSync(artPath, content);
        obs.status = 'created';
        obs.artifact_path = artPath;
        learningLog(`Created artifact: ${artPath}`);
        createdPaths.push(artPath);
      }

      if (createdPaths.length > 0) {
        writeJsonlAtomic(logFile, Array.from(logMap.values()));
      }

      console.log(JSON.stringify({ created: createdPaths, skipped: skippedCount }));
      break;
    }

    case 'filter-observations': {
      const file = args[0];
      const sortField = args[1] || 'confidence';
      const limit = parseInt(args[2]) || 30;
      if (!fs.existsSync(safePath(file))) {
        console.log('[]');
        break;
      }
      const entries = parseJsonl(file);
      const valid = entries.filter(e =>
        e.id && e.id.startsWith('obs_') &&
        (e.type === 'workflow' || e.type === 'procedural') &&
        e.pattern
      );
      valid.sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0));
      console.log(JSON.stringify(valid.slice(0, limit)));
      break;
    }

    default:
      process.stderr.write(`json-helper: unknown operation "${op}"\n`);
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`json-helper error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
}
