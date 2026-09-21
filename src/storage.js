'use strict';

/**
 * 分析记录的简单文件持久化：每条记录存为 data/analyses/<id>.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data', 'analyses');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function metaOf(r) {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    conflictCount: (r.result && r.result.conflicts && r.result.conflicts.length) || 0,
    zoneCount: (r.result && r.result.summary && r.result.summary.zoneCount) || 0,
  };
}

function fileOf(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  return path.join(DATA_DIR, `${id}.json`);
}

function save(record) {
  ensureDir();
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const full = { id, createdAt: new Date().toISOString(), ...record };
  fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(full));
  return metaOf(full);
}

function list() {
  ensureDir();
  return fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return metaOf(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function get(id) {
  const file = fileOf(id);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function remove(id) {
  const file = fileOf(id);
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

module.exports = { save, list, get, remove };
