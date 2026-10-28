// Listing photos are shrunk in the browser before upload: at most 1280 px on the long side, WebP (JPEG where the
// browser cannot export WebP), squeezed to roughly 200 KB so the request stays under the server's 256 KB body
// limit. The server re-encodes it anyway (and drops EXIF such as GPS).
const MAX_SIDE = 1280
const MAX_CHARS = 240 * 1024 // the data URL, ~180 KB of image

async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('decode')
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

/** `file` as a data URL no larger than MAX_SIDE px and about 200 KB. Throws on unreadable images. */
export async function shrinkPhoto(file: File): Promise<string> {
  const { img, w, h, done } = await decode(file)
  try {
    if (!w || !h) throw new Error('decode')
    let side = Math.min(MAX_SIDE, Math.max(w, h))
    for (let attempt = 0; attempt < 4; attempt++) {
      const k = side / Math.max(w, h)
      const cw = Math.max(1, Math.round(w * k))
      const ch = Math.max(1, Math.round(h * k))
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.fillStyle = '#fff' // transparent PNGs get a white backdrop
      ctx.fillRect(0, 0, cw, ch)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h, 0, 0, cw, ch)
      let q = 0.82
      let type = 'image/webp'
      let url = canvas.toDataURL(type, q)
      if (!url.startsWith('data:image/webp')) {
        type = 'image/jpeg'
        url = canvas.toDataURL(type, q)
      }
      while (url.length > MAX_CHARS && q > 0.4) {
        q -= 0.1
        url = canvas.toDataURL(type, q)
      }
      if (url.length <= MAX_CHARS) return url
      side = Math.round(side * 0.75) // still too heavy: try a smaller image
    }
    throw new Error('size')
  } finally {
    done()
  }
}
