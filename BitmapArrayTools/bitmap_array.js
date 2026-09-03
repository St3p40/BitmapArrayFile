function readBits(view, bitOffset, count) {
    let value = 0;
    let done = 0;

    while (done < count) {
        const bitInByte = (bitOffset + done) & 7;
        const take = Math.min(8 - bitInByte, count - done);
        const byte = view.getUint8((bitOffset + done) >> 3);
        const chunk = (byte >> (8 - bitInByte - take)) & ((1 << take) - 1);

        value = (value * (1 << take)) + chunk;
        done += take;
    }
    return value;
}

function writeBits(bytes, bitOffset, count, value) {
    let done = 0;

    while (done < count) {
        const bitInByte = (bitOffset + done) & 7;
        const take = Math.min(8 - bitInByte, count - done);
        const idx = (bitOffset + done) >> 3;
        const shift = 8 - bitInByte - take;
        const left = count - done - take;
        const chunk = Math.floor(value / (2 ** left)) & ((1 << take) - 1);
        const mask = ((1 << take) - 1) << shift;

        bytes[idx] = (bytes[idx] & ~mask) | (chunk << shift);
        done += take;
    }
}

const BNA_TYPES = {
    bw: {
        bits: 8,
        name: "8-bit BW",
        toRGB(pixel) { return [pixel, pixel, pixel] },
        fromRGB: (r, g, b) => ( Math.max(r, g, b))
    },
    b0: {
        bits: 1,
        name: "1-bit BW",
        toRGB(pixel) { return pixel ? [255, 255, 255] : [0, 0, 0] },
        fromRGB: (r, g, b) => (Math.max(r, g, b) >= 128 ? 1 : 0)
    },
    b1: {
        bits: 8,
        name: "8-bit RGB332",
        toRGB(pixel) {
            let r = pixel & 0xe0;
            r |= (r >> 3);
            r |= (r >> 3);
            let g = pixel & 0x1c;
            g |= (g << 3) | (g >> 3);
            let b = pixel & 0x03;
            b |= b << 2;
            b |= b << 4;
            return [r, g, b];
        },
        fromRGB: (r, g, b) => (r & 0xE0) | ((g & 0xE0) >> 3) | ((b & 0xC0) >> 6)
    },
    b2: {
        bits: 16,
        name: "16-bit RGB565",
        toRGB(pixel) {
            let r = (pixel & 0xF800) >> 8;
            r |= r >> 5;
            let g = (pixel & 0x07E0) >> 3;
            g |= g >> 6;
            let b = (pixel & 0x001F) << 3;
            b |= b >> 5;
            return [r, g, b];
        },
        fromRGB: (r, g, b) => ((r & 0xf8) << 8) | ((g & 0xFC) << 3) | ((b & 0xF8) >> 3)
    },
    b3: {
        bits: 24,
        name: "24-bit RGB888",
        toRGB(pixel) { return [(pixel >> 16) & 0xff, (pixel >> 8) & 0xff, pixel & 0xff] },
        fromRGB: (r, g, b) => (r << 16) | (g << 8) | b
    }
};

function frameBytes(width, height, bits) {
    return Math.ceil((width * height * bits) / 8);
}

class BnaPlayer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.meta = null;
        this.frameIdx = 0;
        this.timer = null;
        this.fps = 30;
    }

    async load(fileOrBuffer) {
        this.stop();
        this.meta = null;

        const buffer = fileOrBuffer instanceof ArrayBuffer
            ? fileOrBuffer
            : await fileOrBuffer.arrayBuffer();

        if (buffer.byteLength < 8) throw new Error("File is too small to hold a header");

        const view = new DataView(buffer);
        const signature = String.fromCharCode(view.getUint8(0), view.getUint8(1));
        const type = String.fromCharCode(view.getUint8(2), view.getUint8(3));

        if (signature !== 'bA') throw new Error("Invalid file signature");

        const codec = BNA_TYPES[type];
        if (!codec) throw new Error(`Unsupported type "${type}"`);

        const w = view.getUint16(4, true);
        const h = view.getUint16(6, true);
        if (w === 0 || h === 0) throw new Error("Width and height must be non-zero");

        const frameSize = frameBytes(w, h, codec.bits);
        const frames = Math.floor((buffer.byteLength - 8) / frameSize);
        if (frames < 1) throw new Error(`File holds no complete ${w}x${h} frame`);

        this.meta = { buffer, view, w, h, type, codec, frameSize, frames, headerSize: 8 };
        this.canvas.width = w;
        this.canvas.height = h;
        this.frameIdx = 0;
        this.renderFrame(0);
        return this.meta;
    }

    renderFrame(idx) {
        if (!this.meta) return;
        const { headerSize, w, h, codec, view, frames, frameSize } = this.meta;
        const imageData = this.ctx.createImageData(w, h);
        const pixelsPerFrame = w * h;
        const frameBit = (headerSize + ((idx % frames) * frameSize)) * 8;

        for (let i = 0; i < pixelsPerFrame; i++) {
            const [r, g, b] = codec.toRGB(readBits(view, frameBit + (i * codec.bits), codec.bits));
            const pxIdx = i * 4;

            imageData.data[pxIdx] = r;
            imageData.data[pxIdx + 1] = g;
            imageData.data[pxIdx + 2] = b;
            imageData.data[pxIdx + 3] = 255;
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    play(fps = this.fps) {
        this.stop();
        if (!this.meta) return;

        const rate = Number(fps);
        if (rate > 0) this.fps = rate;

        this.timer = setInterval(() => {
            this.renderFrame(this.frameIdx);
            this.frameIdx = (this.frameIdx + 1) % this.meta.frames;
        }, 1000 / this.fps);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

function ditherFrame(rgba, width, height, codec) {
    const buf = new Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        buf[i * 3] = rgba[i * 4];
        buf[i * 3 + 1] = rgba[i * 4 + 1];
        buf[i * 3 + 2] = rgba[i * 4 + 2];
    }

    const pixels = new Array(width * height);
    const spread = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 3;
            const r = Math.min(255, Math.max(0, Math.round(buf[at])));
            const g = Math.min(255, Math.max(0, Math.round(buf[at + 1])));
            const b = Math.min(255, Math.max(0, Math.round(buf[at + 2])));

            const pixel = codec.fromRGB(r, g, b);
            const [qr, qg, qb] = codec.toRGB(pixel);
            pixels[y * width + x] = pixel;

            for (const [dx, dy, part] of spread) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= width || ny >= height) continue;
                const to = (ny * width + nx) * 3;
                buf[to] += (r - qr) * part;
                buf[to + 1] += (g - qg) * part;
                buf[to + 2] += (b - qb) * part;
            }
        }
    }
    return pixels;
}

async function decoderHandles(type) {
    if (typeof ImageDecoder === 'undefined' || !type) return false;
    try {
        return await ImageDecoder.isTypeSupported(type);
    } catch {
        return false;
    }
}

async function openImage(file) {
    const type = file.type;

    if (await decoderHandles(type)) {
        const decoder = new ImageDecoder({ data: file.stream(), type });
        try {
            await decoder.completed;
        } catch {
            decoder.close();
            throw new Error(`Cannot decode this ${type} file`);
        }
        return {
            frames: decoder.tracks.selectedTrack.frameCount,
            frame: async (i) => (await decoder.decode({ frameIndex: i })).image,
            release: (image) => image.close(),
            close: () => decoder.close()
        };
    }

    const bitmap = await createImageBitmap(file);
    return {
        frames: 1,
        frame: async () => bitmap,
        release: () => {},
        close: () => bitmap.close()
    };
}

class BnaEncoder {
    /**
     * Converts an image file to a BNA Blob, animated ones keep all their frames
     * @param {File} file - GIF, PNG, WEBP, JPEG or anything else the browser decodes
     * @param {number} width - Target width
     * @param {number} height - Target height
     * @param {string} type - type code from BNA_TYPES, for example 'b1' (RGB332)
     * @param {boolean} dither - spread the rounding error over the neighbours
     */
    static async fromImage(file, width, height, type, dither = false) {
        const codec = BNA_TYPES[type];
        if (!codec) throw new Error(`Unsupported type "${type}"`);
        if (!Number.isInteger(width) || !Number.isInteger(height)
            || width < 1 || height < 1 || width > 65535 || height > 65535) {
            throw new Error("Width and height must be 1-65535");
        }

        const source = await openImage(file);
        try {
            const frameSize = frameBytes(width, height, codec.bits);
            const buffer = new ArrayBuffer(8 + (frameSize * source.frames));
            const view = new DataView(buffer);
            const uint8 = new Uint8Array(buffer);

            // Header: "bA" + type + width + height
            uint8[0] = 0x62; // b
            uint8[1] = 0x41; // A
            uint8[2] = type.charCodeAt(0);
            uint8[3] = type.charCodeAt(1);

            view.setUint16(4, width, true);
            view.setUint16(6, height, true);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = width;
            canvas.height = height;

            for (let i = 0; i < source.frames; i++) {
                const image = await source.frame(i);
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(image, 0, 0, width, height);
                source.release(image);
                const rgba = ctx.getImageData(0, 0, width, height).data;
                const frameBit = (8 + (i * frameSize)) * 8;

                const dithered = dither ? ditherFrame(rgba, width, height, codec) : null;

                for (let j = 0; j < width * height; j++) {
                    const pixel = dithered ? dithered[j]
                        : codec.fromRGB(rgba[j * 4], rgba[j * 4 + 1], rgba[j * 4 + 2]);
                    writeBits(uint8, frameBit + (j * codec.bits), codec.bits, pixel);
                }
            }

            return new Blob([buffer], { type: 'application/octet-stream' });
        } finally {
            source.close();
        }
    }
}
