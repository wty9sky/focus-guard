#!/usr/bin/env node
/**
 * 出包脚本：一次产出两个压缩包
 *   release/focus-guard-<version>-chrome.zip   封装后的插件包（zip 根目录即 manifest.json）
 *   release/focus-guard-<version>-code.zip     纯代码包（只有 src / public / 构建配置 + 依赖清单）
 *
 * 代码包不含 docs/ 与 scripts/，因此在打包前会临时改写包内的 package.json：
 * 去掉依赖 scripts/ 的 npm 脚本，build 只跑 vite build（图标已在 public/icons 里备好）。
 *
 * 用法：
 *   npm run pack                  # 先构建再打包
 *   npm run pack -- --skip-build  # 跳过构建，直接用现有 dist
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const skipBuild = process.argv.includes('--skip-build')

const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
/** 发布到 GitHub Packages 后 name 会变成 @owner/focus-guard，产物名仍用裸名 */
const slug = String(name).split('/').pop()
const outDir = path.join(root, 'release')

/** 代码包只收这些：源码 + 清单 + 构建配置 + 依赖锁 */
const CODE_ENTRIES = ['src', 'public', 'vite.config.js', 'package.json', 'package-lock.json']

const log = (msg) => console.log(msg)
const fail = (msg) => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (res.error) fail(`${cmd} 执行失败：${res.error.message}`)
  if (res.status !== 0) fail(`${cmd} 退出码 ${res.status}`)
}

function needZip() {
  const res = spawnSync('zip', ['-v'], { stdio: 'ignore' })
  if (res.error || res.status !== 0) {
    fail('未找到 zip 命令。macOS / Linux 自带，Windows 请用 WSL 或 7-Zip 手动打包。')
  }
}

function pack(cwd, zipPath, excludes = []) {
  const args = ['-r', '-X', '-q', zipPath, '.']
  if (excludes.length) args.push('-x', ...excludes)
  const res = spawnSync('zip', args, { cwd, stdio: 'inherit' })
  if (res.error) fail(`打包失败：${res.error.message}`)
  if (res.status !== 0) fail(`打包失败，退出码 ${res.status}`)
  return fs.statSync(zipPath).size
}

/** 把代码文件复制到临时目录，并改写 package.json 去掉对 scripts/ 的依赖 */
function buildCodeStaging() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-code-'))
  for (const entry of CODE_ENTRIES) {
    const from = path.join(root, entry)
    if (!fs.existsSync(from)) fail(`缺少 ${entry}，无法生成代码包`)
    fs.cpSync(from, path.join(dir, entry), {
      recursive: true,
      filter: (src) => !src.endsWith('.DS_Store')
    })
  }

  const pkgPath = path.join(dir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.scripts = {
    build: 'vite build',
    dev: 'vite build --watch'
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return dir
}

/* ---------------- 1. 构建 ---------------- */
if (skipBuild) {
  log('· 跳过构建（--skip-build）')
  if (!fs.existsSync(path.join(root, 'dist', 'manifest.json'))) {
    fail('dist/manifest.json 不存在，请先执行 npm run build')
  }
} else {
  log('· 构建产物…')
  run('npm', ['run', 'build'], { cwd: root })
}

/* ---------------- 2. 准备目录 ---------------- */
needZip()
fs.mkdirSync(outDir, { recursive: true })

const chromeZip = path.join(outDir, `${slug}-${version}-chrome.zip`)
const codeZip = path.join(outDir, `${slug}-${version}-code.zip`)
for (const file of [chromeZip, codeZip]) {
  if (fs.existsSync(file)) fs.rmSync(file)
}

/* ---------------- 3. 打包 ---------------- */
log('· 打包插件包…')
const chromeSize = pack(path.join(root, 'dist'), chromeZip, ['*.DS_Store'])

log('· 打包代码包…')
const staging = buildCodeStaging()
let codeSize = 0
try {
  codeSize = pack(staging, codeZip, ['*.DS_Store'])
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}

/* ---------------- 4. 校验 ---------------- */
const manifest = spawnSync('unzip', ['-p', chromeZip, 'manifest.json'], { encoding: 'utf8' })
if (manifest.status !== 0 || !manifest.stdout.includes('"manifest_version"')) {
  fail('插件包校验失败：zip 根目录下没有可用的 manifest.json')
}
const packedVersion = (manifest.stdout.match(/"version":\s*"([^"]+)"/) || [])[1]
if (packedVersion !== version) {
  fail(`插件包内版本号 ${packedVersion} 与 package.json（${version}）不一致`)
}

const codeList = spawnSync('unzip', ['-Z1', codeZip], { encoding: 'utf8' }).stdout || ''
const leaked = codeList.split('\n').filter((f) => /^(docs|scripts|dist|release|node_modules)\//.test(f))
if (leaked.length) fail(`代码包里混入了不该有的目录：${leaked.slice(0, 3).join(', ')}`)
if (!codeList.includes('src/') || !codeList.includes('package.json')) {
  fail('代码包校验失败：缺少 src/ 或 package.json')
}

log(`\n✓ 出包完成（v${version}）`)
log(`  ${path.relative(root, chromeZip)}   ${kb(chromeSize)}   解压后可直接「加载已解压的扩展程序」`)
log(`  ${path.relative(root, codeZip)}     ${kb(codeSize)}   仅源码与构建配置，解压后 npm ci && npm run build`)
