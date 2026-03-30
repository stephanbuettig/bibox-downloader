// ============================================================================
// BiBox Downloader — Icon Generator (256x256 ICO)
// ============================================================================
// Generates a simple but valid 256x256 ICO file with a blue "B" on dark bg.
// No external dependencies — uses raw BMP/ICO binary format.

const fs = require('fs');
const path = require('path');

const SIZE = 256;
const outputPath = path.join(__dirname, '..', 'assets', 'icons', 'icon.ico');

// Ensure output directory exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Create 256x256 RGBA pixel data
const pixels = Buffer.alloc(SIZE * SIZE * 4);

// Colors
const BG = [15, 23, 42, 255];       // #0f172a (dark slate)
const ACCENT = [59, 130, 246, 255];  // #3b82f6 (blue)
const WHITE = [241, 245, 249, 255];  // #f1f5f9

// Fill background
for (let i = 0; i < SIZE * SIZE; i++) {
  BG.forEach((v, c) => { pixels[i * 4 + c] = v; });
}

// Helper: set pixel (x, y) with color
function setPixel(x, y, color) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  color.forEach((v, c) => { pixels[idx + c] = v; });
}

// Helper: fill a rounded rect
function fillRoundedRect(x1, y1, x2, y2, r, color) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      // Check corners
      let inside = true;
      if (x < x1 + r && y < y1 + r) {
        inside = ((x - (x1 + r)) ** 2 + (y - (y1 + r)) ** 2) <= r * r;
      } else if (x > x2 - r && y < y1 + r) {
        inside = ((x - (x2 - r)) ** 2 + (y - (y1 + r)) ** 2) <= r * r;
      } else if (x < x1 + r && y > y2 - r) {
        inside = ((x - (x1 + r)) ** 2 + (y - (y2 - r)) ** 2) <= r * r;
      } else if (x > x2 - r && y > y2 - r) {
        inside = ((x - (x2 - r)) ** 2 + (y - (y2 - r)) ** 2) <= r * r;
      }
      if (inside) setPixel(x, y, color);
    }
  }
}

// Helper: fill rect
function fillRect(x1, y1, x2, y2, color) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      setPixel(x, y, color);
    }
  }
}

// Helper: fill circle
function fillCircle(cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        setPixel(x, y, color);
      }
    }
  }
}

// --- Draw the icon ---

// Background: rounded blue rect (app icon style)
fillRoundedRect(16, 16, 239, 239, 40, ACCENT);

// Inner dark rounded rect
fillRoundedRect(28, 28, 227, 227, 32, BG);

// Draw a stylized "B" letter in white
// Vertical bar of B
fillRect(80, 60, 104, 195, WHITE);

// Top horizontal bar
fillRect(80, 60, 155, 80, WHITE);
// Middle horizontal bar
fillRect(80, 118, 155, 138, WHITE);
// Bottom horizontal bar
fillRect(80, 175, 155, 195, WHITE);

// Top arc (right side of B top half)
fillCircle(150, 99, 40, WHITE);
fillCircle(150, 99, 20, BG);
// Clean up the arc: remove left overflow
fillRect(80, 58, 149, 140, [0, 0, 0, 0]); // clear
// Redraw the bars and vertical
fillRect(80, 60, 104, 195, WHITE);
fillRect(80, 60, 148, 80, WHITE);
fillRect(80, 118, 148, 138, WHITE);
fillRect(80, 175, 160, 195, WHITE);

// Top bump of B
for (let y = 60; y <= 138; y++) {
  for (let x = 130; x <= 185; x++) {
    const cy = 99;
    const cx = 140;
    const outerR = 42;
    const innerR = 20;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist <= outerR && dist >= innerR && x >= cx - 5) {
      setPixel(x, y, WHITE);
    }
  }
}

// Bottom bump of B (slightly larger)
for (let y = 118; y <= 195; y++) {
  for (let x = 130; x <= 190; x++) {
    const cy = 157;
    const cx = 142;
    const outerR = 42;
    const innerR = 20;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist <= outerR && dist >= innerR && x >= cx - 5) {
      setPixel(x, y, WHITE);
    }
  }
}

// Small download arrow below B
const arrowCx = 128;
const arrowY = 215;
// Arrow shaft
fillRect(arrowCx - 3, 205, arrowCx + 3, arrowY + 5, ACCENT);
// Arrow head
for (let row = 0; row < 8; row++) {
  fillRect(arrowCx - 3 - row, arrowY + row, arrowCx + 3 + row, arrowY + row, ACCENT);
}
// Base line
fillRect(arrowCx - 14, arrowY + 10, arrowCx + 14, arrowY + 13, ACCENT);

// --- Encode as ICO ---

// ICO uses BMP format (bottom-up rows, BGRA)
const bmpPixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const srcIdx = (y * SIZE + x) * 4;
    // BMP is bottom-up
    const dstIdx = ((SIZE - 1 - y) * SIZE + x) * 4;
    bmpPixels[dstIdx + 0] = pixels[srcIdx + 2]; // B
    bmpPixels[dstIdx + 1] = pixels[srcIdx + 1]; // G
    bmpPixels[dstIdx + 2] = pixels[srcIdx + 0]; // R
    bmpPixels[dstIdx + 3] = pixels[srcIdx + 3]; // A
  }
}

// AND mask (1 bit per pixel, all opaque = all zeros)
const andMaskRowBytes = Math.ceil(SIZE / 8);
const andMaskRowPadded = Math.ceil(andMaskRowBytes / 4) * 4;
const andMask = Buffer.alloc(andMaskRowPadded * SIZE);

// BMP Info Header (BITMAPINFOHEADER = 40 bytes)
const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);           // biSize
bmpHeader.writeInt32LE(SIZE, 4);           // biWidth
bmpHeader.writeInt32LE(SIZE * 2, 8);       // biHeight (double for ICO: XOR + AND)
bmpHeader.writeUInt16LE(1, 12);            // biPlanes
bmpHeader.writeUInt16LE(32, 14);           // biBitCount (32-bit BGRA)
bmpHeader.writeUInt32LE(0, 16);            // biCompression (BI_RGB)
bmpHeader.writeUInt32LE(bmpPixels.length + andMask.length, 20); // biSizeImage
bmpHeader.writeInt32LE(0, 24);             // biXPelsPerMeter
bmpHeader.writeInt32LE(0, 28);             // biYPelsPerMeter
bmpHeader.writeUInt32LE(0, 32);            // biClrUsed
bmpHeader.writeUInt32LE(0, 36);            // biClrImportant

const imageData = Buffer.concat([bmpHeader, bmpPixels, andMask]);

// ICO Header (6 bytes)
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);     // Reserved
icoHeader.writeUInt16LE(1, 2);     // Type (1 = ICO)
icoHeader.writeUInt16LE(1, 4);     // Count (1 image)

// ICO Directory Entry (16 bytes)
const icoEntry = Buffer.alloc(16);
icoEntry.writeUInt8(0, 0);         // Width (0 = 256)
icoEntry.writeUInt8(0, 1);         // Height (0 = 256)
icoEntry.writeUInt8(0, 2);         // Color palette
icoEntry.writeUInt8(0, 3);         // Reserved
icoEntry.writeUInt16LE(1, 4);      // Color planes
icoEntry.writeUInt16LE(32, 6);     // Bits per pixel
icoEntry.writeUInt32LE(imageData.length, 8);   // Image size
icoEntry.writeUInt32LE(6 + 16, 12);             // Offset to image data

const ico = Buffer.concat([icoHeader, icoEntry, imageData]);
fs.writeFileSync(outputPath, ico);

console.log(`Icon generated: ${outputPath} (${ico.length} bytes, ${SIZE}x${SIZE})`);
