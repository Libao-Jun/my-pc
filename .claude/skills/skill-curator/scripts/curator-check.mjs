#!/usr/bin/env node
// skill-curator 检测脚本：扫描 SKILL_ROOT/*/SKILL.md，输出检测摘要并更新状态。
// 零依赖（Node 22 内置 fs/path）。作为 SessionStart Hook 挂载；亦可手动运行。
// 用法: node .claude/skills/skill-curator/scripts/curator-check.mjs [SKILL_ROOT]
'use strict'

import fs from 'node:fs'
import path from 'node:path'

const SKILL_ROOT = process.argv[2] ?? '.claude/skills'
const STATE_FILE = path.join(SKILL_ROOT, '.curator-state.json')
const MAX_SIZE_BYTES = 8 * 1024
const STALE_DAYS = 30

function readState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return {
      lastFullReorg: typeof data.lastFullReorg === 'string' ? data.lastFullReorg : null,
      lastCheck: typeof data.lastCheck === 'string' ? data.lastCheck : null
    }
  } catch {
    return { lastFullReorg: null, lastCheck: null }
  }
}

function writeState(state) {
  fs.mkdirSync(SKILL_ROOT, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!m) return { name: '', description: '' }
  let name = ''
  let description = ''
  for (const line of m[1].split('\n')) {
    const n = /^name:\s*["']?([^"'\n]+)["']?\s*$/.exec(line)
    if (n) name = n[1].trim()
    const d = /^description:\s*["']?([^"'\n]+)["']?\s*$/.exec(line)
    if (d) description = d[1].trim()
  }
  return { name, description }
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)])
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}

// 返回两 description 共享的核心短语（≥6 中文字符串 或 ≥12 字符英文词序列）；无则 null
function sharedPhrase(da, db) {
  const ca = da.replace(/[^\u4e00-\u9fff]/g, ' ')
  const cb = db.replace(/[^\u4e00-\u9fff]/g, ' ')
  for (const run of ca.split(' ').filter((s) => s.length >= 6)) {
    if (cb.includes(run)) return run
  }
  const ea = da.replace(/[^a-zA-Z0-9 -]/g, ' ')
  const eb = db.replace(/[^a-zA-Z0-9 -]/g, ' ')
  const toks = ea.split(' ').filter((t) => t.length > 0)
  for (let i = 0; i < toks.length; i++) {
    let seq = ''
    for (let j = i; j < toks.length; j++) {
      seq = seq ? `${seq} ${toks[j]}` : toks[j]
      if (seq.length >= 12 && eb.includes(seq)) return seq
    }
  }
  return null
}

// 返回重复候选描述；不重复则 null
function dupInfo(a, b) {
  if (levenshtein(a.name, b.name) <= 2) return 'name 近似'
  const phrase = sharedPhrase(a.description, b.description)
  if (phrase) return `desc 含 "${phrase}"`
  return null
}

function main() {
  if (!fs.existsSync(SKILL_ROOT) || !fs.statSync(SKILL_ROOT).isDirectory()) {
    console.error(`[skill-curator] SKILL_ROOT 不存在或不是目录: ${SKILL_ROOT}`)
    process.exit(1)
  }
  const state = readState()
  const dirs = fs
    .readdirSync(SKILL_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_archive' && d.name !== 'skill-curator')
    .map((d) => d.name)
    .sort()

  const skills = []
  let totalBytes = 0
  for (const dir of dirs) {
    const file = path.join(SKILL_ROOT, dir, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const { name, description } = parseFrontmatter(text)
    const bytes = Buffer.byteLength(text, 'utf8')
    totalBytes += bytes
    skills.push({ dir, name, description, bytes })
  }

  const now = Date.now()
  writeState({ lastFullReorg: state.lastFullReorg, lastCheck: new Date(now).toISOString() })

  const big = skills.filter((s) => s.bytes > MAX_SIZE_BYTES).sort((a, b) => b.bytes - a.bytes).slice(0, 3)
  const dups = []
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const info = dupInfo(skills[i], skills[j])
      if (info) dups.push(`${skills[i].dir}↔${skills[j].dir}（${info}）`)
    }
  }
  const missing = skills.filter((s) => s.description.length < 8).map((s) => s.dir)

  let lastReorgText = '从未'
  let staleNote = ''
  if (state.lastFullReorg) {
    const days = Math.floor((now - new Date(state.lastFullReorg).getTime()) / 86400000)
    lastReorgText = `${Math.max(0, days)} 天前`
    if (days > STALE_DAYS) staleNote = '已超 30 天未全盘重梳理'
  }

  const kb = (totalBytes / 1024).toFixed(1)
  const header = `【skill-curator 检测】${skills.length} 个 SKILL.md · 总大小 ${kb} KB · 距上次全盘重梳理 ${lastReorgText}`

  const advices = []
  for (const d of dups) advices.push(`建议合并 ${d.split('（')[0]}`)
  for (const mm of missing) advices.push(`建议补充 description: ${mm}`)
  if (staleNote) advices.push('建议全盘重梳理')

  if (advices.length === 0 && big.length === 0) {
    console.log(`${header} · 建议: 无需处理`)
    return
  }
  const parts = [header]
  if (big.length) parts.push(`- 最大: ${big.map((s) => `${s.dir} (${(s.bytes / 1024).toFixed(1)} KB)`).join('、')}`)
  if (dups.length) parts.push(`- 重复候选: ${dups.join('、')}`)
  if (missing.length) parts.push(`- 缺 description: ${missing.join('、')}`)
  parts.push(`- 建议: ${advices.join('；')}`)
  console.log(parts.join('\n'))
}

main()
