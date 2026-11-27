import AppKit

// Draws the OpenCode mark of the dashboard's sidebar (public/index.html .rail-tile:
// viewBox 0 0 20 24, outer rect 2.3,2.3 15.4×19.4 stroked 2.6, inner rect 6.3,12 7.4×5.8)
// on the tile colors of public/style.css (--tile #1b1b1b, --tile-ink #f2f2f2), into
// the PNGs of an .iconset, which app.sh turns into AppIcon.icns with iconutil. No image is
// kept in the repository. Usage: MakeIcon <out.iconset>
guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("Uso: MakeIcon <cartella.iconset>\n".utf8))
    exit(2)
}
let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let tile = NSColor(srgbRed: 0x1b / 255.0, green: 0x1b / 255.0, blue: 0x1b / 255.0, alpha: 1)
let ink = NSColor(srgbRed: 0xf2 / 255.0, green: 0xf2 / 255.0, blue: 0xf2 / 255.0, alpha: 1)

func png(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    // macOS icon grid: the rounded square is 824/1024 of the canvas, corner ~185/1024
    let inset = s * 100 / 1024
    let body = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    tile.setFill()
    NSBezierPath(roundedRect: body, xRadius: s * 185 / 1024, yRadius: s * 185 / 1024).fill()
    // the mark, 20×24 units, scaled to 55% of the body's height and centered
    let unit = body.height * 0.55 / 24
    let ox = body.midX - 10 * unit
    let oy = body.midY - 12 * unit
    func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
        NSRect(x: ox + x * unit, y: oy + (24 - y - h) * unit, width: w * unit, height: h * unit) // SVG y goes down
    }
    ink.set()
    let outer = NSBezierPath(rect: r(2.3, 2.3, 15.4, 19.4))
    outer.lineWidth = 2.6 * unit
    outer.stroke()
    NSBezierPath(rect: r(6.3, 12, 7.4, 5.8)).fill()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
    try png(base).write(to: out.appending(path: "icon_\(base)x\(base).png"))
    try png(base * 2).write(to: out.appending(path: "icon_\(base)x\(base)@2x.png"))
}
