// 生成扩展图标（纯 Node 实现，无第三方依赖，构建时不需要浏览器）
// 设计：红色渐变圆角方底 + 白色盾牌 + 盾上「暂停」镂空（拦下 = 暂停）
// 采用 4×4 超采样抗锯齿，16px 单独加粗笔画，保证工具栏小尺寸可辨认。
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/icons')
const SIZES = [16, 48, 128]
const SS = 4 // 每边采样数

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- 几何：统一在 0..1 归一化坐标里判断 ---------- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 圆角矩形：圆角半径 r（归一化） */
function inRoundRect(x, y, r) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r + 1e-9
}

/** 圆角矩形（任意中心/尺寸，用于暂停双竖条） */
function inRoundBar(x, y, cx, cy, w, h, r) {
  const dx = Math.abs(x - cx) - (w / 2 - r)
  const dy = Math.abs(y - cy) - (h / 2 - r)
  if (dx <= 0 && dy <= 0) return true
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return ox * ox + oy * oy <= r * r
}

/** 二次贝塞尔采样 */
function quad(p0, c, p1, n, out) {
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    out.push([
      mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0],
      mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1]
    ])
  }
}

/** 盾牌多边形（局部 0..1，y 向下），已换算到画布坐标 */
function shieldPolygon(sx, sy, sw, sh) {
  const pts = [
    [0, 0.07],
    [0.5, 0],
    [1, 0.07],
    [1, 0.42]
  ]
  quad([1, 0.42], [0.97, 0.76], [0.5, 1], 20, pts)
  quad([0.5, 1], [0.03, 0.76], [0, 0.42], 20, pts)
  pts.push([0, 0.07])
  return pts.map(([x, y]) => [sx + x * sw, sy + y * sh])
}

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/* ---------- 配色 ---------- */
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16)
]
const BASE_TOP = hex('#FF7A6B')
const BASE_BOTTOM = hex('#DC3A28')
const SHIELD = [255, 255, 255]
// 暂停条：比底色更深的红，视觉上像盾牌上刻出来的两道槽
const SLOT = hex("#C02E1C")

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

/* ---------- 渲染 ---------- */
function render(size) {
  const rgba = Buffer.alloc(size * size * 4)

  // 小尺寸整体放大关键笔画，避免 16px 糊成一团
  const small = size <= 24
  const shieldW = small ? 0.70 : 0.60
  const shieldH = small ? 0.76 : 0.68
  const sx = 0.5 - shieldW / 2
  const sy = 0.5 - shieldH / 2 - 0.01
  const poly = shieldPolygon(sx, sy, shieldW, shieldH)

  const barW = small ? 0.118 : 0.085
  const barH = small ? 0.26 : 0.22
  const gap = small ? 0.175 : 0.105
  const barCY = 0.475

  const cornerR = 0.225

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy2 = 0; sy2 < SS; sy2++) {
        for (let sx2 = 0; sx2 < SS; sx2++) {
          const x = (px + (sx2 + 0.5) / SS) / size
          const y = (py + (sy2 + 0.5) / SS) / size

          if (!inRoundRect(x, y, cornerR)) continue

          // 底色：自上而下的红色渐变 + 轻微左上高光
          let base = mix(BASE_TOP, BASE_BOTTOM, clamp01((y - 0.12) / 0.86))
          const glow = Math.max(0, 0.16 - Math.hypot(x - 0.12, y - 0.08) * 0.9)
          base = mix(base, [255, 255, 255], glow)

          let color = base

          if (inPolygon(x, y, poly)) {
            const inBar =
              inRoundBar(x, y, 0.5 - gap / 2, barCY, barW, barH, barW / 2) ||
              inRoundBar(x, y, 0.5 + gap / 2, barCY, barW, barH, barW / 2)
            // 暂停符号：盾牌上的两道深色槽
            color = inBar ? SLOT : SHIELD
          }

          r += color[0]
          g += color[1]
          b += color[2]
          a += 255
        }
      }

      const total = SS * SS
      const idx = (py * size + px) * 4
      const alpha = a / total
      if (alpha <= 0) continue
      // 预乘还原：颜色按已覆盖采样点平均
      const cover = a / 255
      rgba[idx] = Math.round(r / cover)
      rgba[idx + 1] = Math.round(g / cover)
      rgba[idx + 2] = Math.round(b / cover)
      rgba[idx + 3] = Math.round(alpha)
    }
  }

  return encodePng(size, rgba)
}

/* ---------- 输出 ---------- */
mkdirSync(outDir, { recursive: true })
for (const size of SIZES) {
  const file = resolve(outDir, `icon${size}.png`)
  writeFileSync(file, render(size))
  console.log(`generated ${file}`)
}
