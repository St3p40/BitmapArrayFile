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
        const buffer = fileOrBuffer instanceof ArrayBuffer
            ? fileOrBuffer
            : await fileOrBuffer.arrayBuffer();
        const view = new DataView(buffer);
        const signature = String.fromCharCode(view.getUint8(0), view.getUint8(1));
        const type = String.fromCharCode(view.getUint8(2), view.getUint8(3));

        if (signature !== 'bA') throw new Error("Invalid file signature");

        const bpp = type === 'b3' ? 3 : type === 'b2' ? 2 : type === 'b1' ? 1 : -1;
        const w = view.getUint16(4, true);
        const h = view.getUint16(6, true);
        const frames = Math.floor((buffer.byteLength - 8) / (w * h * bpp));

        this.meta = { buffer, view, w, h, bpp, frames, headerSize: 8 };
        this.canvas.width = w;
        this.canvas.height = h;
        this.frameIdx = 0;
        this.renderFrame(0);
        return this.meta;
    }

    renderFrame(idx) {
        if (!this.meta) return;
        const { headerSize, w, h, bpp, view, frames } = this.meta;
        const imageData = this.ctx.createImageData(w, h);
        const pixelsPerFrame = w * h;
        const frameOffset = headerSize + ((idx % frames) * pixelsPerFrame * bpp);

        for (let i = 0; i < pixelsPerFrame; i++) {
            let r, g, b;
            const pxIdx = i * 4;

            if (bpp === 1) { // RGB332
                const byte = view.getUint8(frameOffset + i);
                r = byte & 0xe0; // mask out the 3 bits of red at the start of the byte
                r |= (r >> 3); // extend limited 0-224 range to 0-252
                r |= (r >> 3); // extend limited 0-252 range to 0-255
                g = byte & 0x1c; // mask out the 3 bits of green in the middle of the byte
                g |= (g << 3) | (r >> 3); // extend limited 0-34 range to 0-255
                b = byte & 0x03; // mask out the 2 bits of blue at the end of the byte
                b |= b << 2; // extend 0-3 range to 0-15
                b |= b << 4;
            } else if (bpp === 2) { // RGB565
                const word = view.getUint8(frameOffset + (i * 2)) << 8
                | view.getUint8(frameOffset + (i * 2) + 1);
                r = (word & 0xF800) >> 8;
                g = (word & 0x07E0) >> 3;
                b = (word & 0x001F) << 3;
            } else { // RGB888
                r = view.getUint8(frameOffset + (i * 3));
                g = view.getUint8(frameOffset + (i * 3) + 1);
                b = view.getUint8(frameOffset + (i * 3) + 2);
            }

            imageData.data[pxIdx] = r;
            imageData.data[pxIdx + 1] = g;
            imageData.data[pxIdx + 2] = b;
            imageData.data[pxIdx + 3] = 255;
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    play(fps = this.fps) {
        this.stop();
        this.fps = fps;
        this.timer = setInterval(() => {
            this.renderFrame(this.frameIdx);
            this.frameIdx = (this.frameIdx + 1) % this.meta.frames;
        }, 1000 / this.fps);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
    }
}

class BnaEncoder {
    /**
     * Converts a GIF file to a BNA Blob
     * @param {File} file - The GIF file
     * @param {number} width - Target width
     * @param {number} height - Target height
     * @param {string} type - type: 'b1' (RGB332), 'b2' (RGB565), 'b3' (RGB888)
     */
    static async fromGif(file, width, height, type) {
        const decoder = new ImageDecoder({ data: file.stream(), type: "image/gif" });
        await decoder.completed;
        const totalFrames = decoder.tracks.selectedTrack.frameCount;

        const bpp = (type === 'b1') ? 1 : (type === 'b2') ? 2 : (type === 'b3') ? 3 : -1;
        const bytesPerFrame = width * height * bpp;
        const totalSize = 8 + (bytesPerFrame * totalFrames);
        const buffer = new ArrayBuffer(totalSize);
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

        for (let i = 0; i < totalFrames; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const frameOffset = 8 + (i * bytesPerFrame);

            for (let j = 0; j < width * height; j++) {
                const r = rgba[j * 4];
                const g = rgba[j * 4 + 1];
                const b = rgba[j * 4 + 2];
                const pixelPos = frameOffset + (j * bpp);

                if (bpp === 1) {
                    // RGB332
                    uint8[pixelPos] = (r & 0xE0) | ((g & 0xE0) >> 3) | ((b & 0xC0) >> 6);
                } else if (bpp === 2) {
                    // RGB565
                    uint8[pixelPos] = (r & 0xf8) | ((g & 0xE0) >> 5);
                    uint8[pixelPos + 1] = ((g & 0x1C) << 5) | ((b & 0xF8) >> 3);
                } else {
                    // RGB888
                    uint8[pixelPos] = r;
                    uint8[pixelPos + 1] = g;
                    uint8[pixelPos + 2] = b;
                }
            }
            image.close();
        }

        return new Blob([buffer], { type: 'application/octet-stream' });
    }
}