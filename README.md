# Bitmap Array file

This is a file format made for embedded devices such as Arduino Nano or ESP8266 to save images, fonts or animations made by me and [@sutaburosu](http://github.com/sutaburosu)

## Specifications

| Offset | Size (Bytes) | Description |
|---|---|---|
| 0x00 | 2 | File signature ("bA") |
| 0x02 | 2 | Type of stored image data |
| 0x04 | 2 | Width: Image width in pixels (uint16_t). |
| 0x06 | 2 | Height: Image height in pixels (uint16_t). |
| 0x08 | - | Data (Size depends on Width, Height and Type) |

## Types

| Type | bytes per pixel | addition | description |
|---|---|---|---|
| b1/b2/b3 | 1/2/3 | - | raw bitmap with set color depth |

> [!NOTE]
> B&W, monochrome, palette and other types will be implemented
