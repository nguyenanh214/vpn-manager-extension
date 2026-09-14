'use strict';
// Chrome Native Messaging framing: 4 byte length (native endian) + JSON UTF-8.
// stdin có thể chẻ message thành nhiều chunk nên phải buffer tích luỹ.

const MAX_MESSAGE_BYTES = 1024 * 1024; // giới hạn cứng của Chrome

/**
 * Đọc message từ stream, gọi onMessage cho mỗi message hoàn chỉnh.
 */
function createReader(stream, onMessage, onError) {
  let buf = Buffer.alloc(0);

  stream.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);

    for (;;) {
      if (buf.length < 4) return;

      const len = buf.readUInt32LE(0);
      if (len > MAX_MESSAGE_BYTES) {
        onError(new Error(`Message ${len} bytes vượt giới hạn ${MAX_MESSAGE_BYTES}`));
        buf = Buffer.alloc(0);
        return;
      }
      if (buf.length < 4 + len) return;

      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);

      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (err) {
        onError(new Error(`JSON không hợp lệ: ${err.message}`));
        continue;
      }
      onMessage(parsed);
    }
  });
}

/**
 * Ghi một message ra stream theo đúng framing.
 */
function writeMessage(stream, msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new Error(`Response ${body.length} bytes vượt giới hạn`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stream.write(Buffer.concat([header, body]));
}

module.exports = { createReader, writeMessage, MAX_MESSAGE_BYTES };
