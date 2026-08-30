#!/usr/bin/env node
// skill-curator 检测脚本：扫描 SKILL_ROOT/*/SKILL.md，输出检测摘要并更新状态。
// 零依赖（Node 22 内置 fs/path）。作为 SessionStart Hook 挂载；亦可手动运行。
// 用法: node docs/skills/skill-curator/scripts/curator-check.mjs [SKILL_ROOT]
'use strict'

import fs from 'node:fs'
import path from 'node:path'

const SKILL_ROOT = process.argv[2] ?? 'docs/skills'
const STATE_FILE = path.join(SKILL_ROOT, '.curator-state.json')
const MAX_SIZE_BYTES = 8 * 1024
const STALE_DAYS = 30
const MAX_DUPS = 5 // 重复候选最多展示条数（防样板噪音刷屏）
const BOILERPLATE_FREQ = 3 // 共享短语出现在 ≥3 个 skill 视为样板，忽略
const FUNCTION_WORDS = new Set(
  'the a an this that these those when whenever should use uses used using user wants want wanted need needs needed ask asks asked for of to from with by or and in on at as is are was were be been it you your their we they if then also can could will would shall may might must not no nor all any each every into over under than so about which who whom what where how why both either neither until while because'.split(' ')
)

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
  // 兼容 CRLF 行尾（部分 skill 文件为 Windows 换行），统一为 \n 再解析
  const m = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r/g, ''))
  if (!m) return { name: '', description: '' }
  let name = ''
  let description = ''
  let descPending = false
  for (const line of m[1].split('\n')) {
    const n = /^name:\s*["']?([^"'\n]+)["']?\s*$/.exec(line)
    if (n) name = n[1].trim()
    if (descPending) {
      if (/^\s/.test(line)) {
        description = description ? `${description} ${line.trim()}` : line.trim()
        continue
      }
      descPending = false
    }
    const d = /^description:\s*(.*)$/.exec(line)
    if (d) {
      description = d[1].trim().replace(/^["']|["']$/g, '')
      // YAML 块标量（description: 后跟 | / |- / > 等或空值）：后续缩进行均为描述内容
      if (description === '' || /^[|>][-+]?$/.test(description)) {
        description = ''
        descPending = true
      }
    }
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

// 提取 description 的全部候选短语：≥6 中文字符串 + ≥12 字符英文词序列（小写归一）
function extractPhrases(desc) {
  const text = desc.toLowerCase()
  const out = []
  for (const run of text.replace(/[^\u4e00-\u9fff]/g, ' ').split(' ').filter((s) => s.length >= 6)) {
    out.push(run)
  }
  const toks = text.replace(/[^a-z0-9 -]/g, ' ').split(' ').filter((t) => t.length > 0)
  for (let i = 0; i < toks.length; i++) {
    let seq = ''
    for (let j = i; j < toks.length; j++) {
      seq = seq ? `${seq} ${toks[j]}` : toks[j]
      if (seq.length >= 12) out.push(seq)
    }
  }
  return out
}

// 全局短语频率：某短语被几个 skill 的 description 共享（跨库样板检测）
function phraseFrequency(skills) {
  const freq = new Map()
  for (const s of skills) {
    const seen = new Set(extractPhrases(s.description))
    for (const p of seen) freq.set(p, (freq.get(p) ?? 0) + 1)
  }
  return freq
}

// 样板判定：全局出现 ≥3 个 skill，或短语内无内容词（全为功能词）。纯中文短语仅凭频率判样板。
function isBoilerplate(phrase, freq) {
  if ((freq.get(phrase) ?? 0) >= BOILERPLATE_FREQ) return true
  const words = phrase.split(/[^a-z0-9]+/).filter(Boolean)
  if (words.length === 0) return false
  return !words.some((w) => w.length >= 4 && !FUNCTION_WORDS.has(w))
}

// 返回重复候选描述；不重复则 null。共享短语取最长匹配（优先特指核心，而非功能词前缀）
function dupInfo(a, b, freq) {
  if (a.name && b.name && levenshtein(a.name, b.name) <= 2) return 'name 近似'
  const pa = new Set(extractPhrases(a.description))
  const pb = [...new Set(extractPhrases(b.description))]
  let best = null
  for (const p of pb) {
    if (pa.has(p) && !isBoilerplate(p, freq)) {
      if (!best || p.length > best.length) best = p
    }
  }
  if (best) return `desc 含 "${best}"`
  return null
}

function main() {
  if (!fs.existsSync(SKILL_ROOT) || !fs.statSync(SKILL_ROOT).isDirectory()) {
    console.error(`[skill-curator] SKILL_ROOT 不存在或不是目录: ${SKILL_ROOT}`)
    process.exit(1)
  }
  const state = readState()
  const dirs = fs.readdirSync(SKILL_ROOT, { withFileTypes: true })
    .filter((d) => d.name !== '_archive')
    .map((d) => d.name)
    .filter((name) => {
      // 悬空符号链接/无权限：try/catch 跳过，不让 SessionStart Hook 崩
      try {
        return fs.statSync(path.join(SKILL_ROOT, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()

  const skills = []
  let totalBytes = 0
  for (const dir of dirs) {
    const file = path.join(SKILL_ROOT, dir, 'SKILL.md')
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue // 不可读（权限/悬空链接）：跳过
    }
    const { name, description } = parseFrontmatter(text)
    const bytes = Buffer.byteLength(text, 'utf8')
    totalBytes += bytes
    skills.push({ dir, name, description, bytes })
  }

  const now = Date.now()
  try {
    writeState({ lastFullReorg: state.lastFullReorg, lastCheck: new Date(now).toISOString() })
  } catch {
    // 状态写入失败不阻塞检测摘要
  }

  const big = skills.filter((s) => s.bytes > MAX_SIZE_BYTES).sort((a, b) => b.bytes - a.bytes).slice(0, 3)
  const freq = phraseFrequency(skills)
  const dups = []
  outer:
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const info = dupInfo(skills[i], skills[j], freq)
      if (info) {
        dups.push(`${skills[i].dir}↔${skills[j].dir}（${info}）`)
        if (dups.length >= MAX_DUPS) break outer
      }
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
