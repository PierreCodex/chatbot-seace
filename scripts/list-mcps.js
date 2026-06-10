#!/usr/bin/env node
/**
 * Lista los MCP servers visibles para este proyecto.
 *
 *   - Globales:   ~/.claude.json → mcpServers
 *   - De proyecto (vía UI/CLI):  ~/.claude.json → projects[cwd].mcpServers
 *   - De proyecto (committed):   ./.mcp.json
 *
 * Uso:  node scripts/list-mcps.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = process.cwd();
const GLOBAL_CONFIG = path.join(os.homedir(), '.claude.json');
const PROJECT_MCP_FILE = path.join(PROJECT_ROOT, '.mcp.json');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`No pude leer ${file}: ${err.message}`);
    return null;
  }
}

function describeServer(name, def) {
  if (!def) return `  - ${name}`;
  const type = def.type ?? (def.command ? 'stdio' : def.url ? 'http' : 'unknown');
  const target = def.command ? `${def.command} ${(def.args || []).join(' ')}`.trim() : def.url || '';
  return `  - ${name}  [${type}]  ${target}`.trimEnd();
}

function findProjectKey(claudeJson, root) {
  const projects = claudeJson?.projects || {};
  const candidates = [
    root,
    root.replace(/\\/g, '/'),
    root.replace(/\//g, '\\'),
  ];
  for (const k of candidates) {
    if (projects[k]) return k;
  }
  // Fallback: case-insensitive
  const lower = root.toLowerCase().replace(/\\/g, '/');
  return Object.keys(projects).find((k) => k.toLowerCase().replace(/\\/g, '/') === lower);
}

function main() {
  const global = readJsonSafe(GLOBAL_CONFIG) || {};
  const projectMcp = readJsonSafe(PROJECT_MCP_FILE);

  console.log(`Proyecto: ${PROJECT_ROOT}\n`);

  // 1) Globales
  const globalServers = global.mcpServers || {};
  console.log(`Globales (${Object.keys(globalServers).length}):`);
  if (Object.keys(globalServers).length === 0) {
    console.log('  (ninguno)');
  } else {
    for (const [name, def] of Object.entries(globalServers)) {
      console.log(describeServer(name, def));
    }
  }

  // 2) De proyecto vía claude.json (registrados por UI/CLI con scope=project)
  const projKey = findProjectKey(global, PROJECT_ROOT);
  const projEntry = projKey ? global.projects[projKey] : null;
  const projScoped = projEntry?.mcpServers || {};
  console.log(`\nDe proyecto en ~/.claude.json (${Object.keys(projScoped).length}):`);
  if (Object.keys(projScoped).length === 0) {
    console.log('  (ninguno)');
  } else {
    for (const [name, def] of Object.entries(projScoped)) {
      console.log(describeServer(name, def));
    }
  }

  // 3) De proyecto vía .mcp.json (committed al repo, compartido entre devs)
  const fileServers = projectMcp?.mcpServers || {};
  console.log(`\nDe proyecto en .mcp.json (${Object.keys(fileServers).length}):`);
  if (!projectMcp) {
    console.log('  (no existe el archivo .mcp.json)');
  } else if (Object.keys(fileServers).length === 0) {
    console.log('  (vacío)');
  } else {
    const enabled = new Set(projEntry?.enabledMcpjsonServers || []);
    const disabled = new Set(projEntry?.disabledMcpjsonServers || []);
    const enableAll = projEntry?.enableAllProjectMcpServers === true;
    for (const [name, def] of Object.entries(fileServers)) {
      const state = enableAll || enabled.has(name)
        ? 'ENABLED'
        : disabled.has(name)
        ? 'DISABLED'
        : 'PENDING-APPROVAL';
      console.log(`${describeServer(name, def)}  → ${state}`);
    }
  }
}

main();