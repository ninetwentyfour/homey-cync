"use strict";
/**
 * Cync TCP binary framing.
 *
 * Outer frame:
 *   info_byte(1) | payload_length(4 BE) | payload
 *   info_byte = (message_type << 4) | (is_response ? 0x08 : 0) | version(3 bits)
 *
 * For PIPE messages the payload carries an inner frame delimited by 0x7e,
 * little-endian, with 0x7e escaped as 0x7d 0x5e. Checksum is a 1-byte sum
 * of the command-body bytes, mod 256.
 *
 * Ported from pycync 0.5.0 (tcp/packet_builder.py, tcp/inner_packet_builder.py).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipeCommand = exports.MessageType = exports.PROTOCOL_VERSION = void 0;
exports.tryParseOuterFrame = tryParseOuterFrame;
exports.buildLoginPacket = buildLoginPacket;
exports.buildPingPacket = buildPingPacket;
exports.buildPipePacket = buildPipePacket;
exports.buildProbePacket = buildProbePacket;
exports.buildQueryDeviceStatusInner = buildQueryDeviceStatusInner;
exports.buildSetPowerInner = buildSetPowerInner;
exports.buildSetBrightnessInner = buildSetBrightnessInner;
exports.buildSetColorTempInner = buildSetColorTempInner;
exports.buildSetRgbInner = buildSetRgbInner;
exports.buildSetEffectInner = buildSetEffectInner;
exports.buildComboInner = buildComboInner;
exports.parsePipeStatusPages = parsePipeStatusPages;
const effects_1 = require("./effects");
exports.PROTOCOL_VERSION = 3;
var MessageType;
(function (MessageType) {
    MessageType[MessageType["LOGIN"] = 1] = "LOGIN";
    MessageType[MessageType["HANDSHAKE"] = 2] = "HANDSHAKE";
    MessageType[MessageType["SYNC"] = 4] = "SYNC";
    MessageType[MessageType["PIPE"] = 7] = "PIPE";
    MessageType[MessageType["PIPE_SYNC"] = 8] = "PIPE_SYNC";
    MessageType[MessageType["PROBE"] = 10] = "PROBE";
    MessageType[MessageType["PING"] = 13] = "PING";
    MessageType[MessageType["DISCONNECT"] = 14] = "DISCONNECT";
})(MessageType || (exports.MessageType = MessageType = {}));
var PipeCommand;
(function (PipeCommand) {
    PipeCommand[PipeCommand["SET_POWER_STATE"] = 208] = "SET_POWER_STATE";
    PipeCommand[PipeCommand["SET_BRIGHTNESS"] = 210] = "SET_BRIGHTNESS";
    PipeCommand[PipeCommand["SET_COLOR"] = 226] = "SET_COLOR";
    PipeCommand[PipeCommand["DEVICE_STATUS"] = 219] = "DEVICE_STATUS";
    PipeCommand[PipeCommand["COMBO_CONTROL"] = 240] = "COMBO_CONTROL";
    PipeCommand[PipeCommand["QUERY_DEVICE_STATUS_PAGES"] = 82] = "QUERY_DEVICE_STATUS_PAGES";
})(PipeCommand || (exports.PipeCommand = PipeCommand = {}));
var PipeDirection;
(function (PipeDirection) {
    PipeDirection[PipeDirection["REQUEST"] = 248] = "REQUEST";
    PipeDirection[PipeDirection["RESPONSE"] = 249] = "RESPONSE";
    PipeDirection[PipeDirection["ANNOUNCE"] = 250] = "ANNOUNCE";
})(PipeDirection || (PipeDirection = {}));
/** Packet counters are shared process-wide. */
let outerCounter = 1;
let innerCounter = 257; // 0x0101
function nextOuterCounter() {
    const v = outerCounter;
    outerCounter = (outerCounter + 1) % 0x10000;
    return v;
}
function nextInnerCounter() {
    const v = innerCounter;
    innerCounter = innerCounter + 1 < 0xfffffffe ? innerCounter + 1 : 257;
    return v;
}
function tryParseOuterFrame(buf) {
    if (buf.length < 5)
        return null;
    const info = buf[0];
    const payloadLength = buf.readUInt32BE(1);
    const total = 5 + payloadLength;
    if (buf.length < total)
        return null;
    return {
        messageType: (info & 0xf0) >> 4,
        isResponse: Boolean((info & 0x08) >> 3),
        version: info & 0x07,
        payload: buf.subarray(5, total),
        consumed: total,
    };
}
function buildOuterHeader(messageType, isResponse, payloadLength) {
    let info = (messageType << 4) | exports.PROTOCOL_VERSION;
    if (isResponse)
        info |= 0x08;
    const header = Buffer.alloc(5);
    header.writeUInt8(info, 0);
    header.writeUInt32BE(payloadLength, 1);
    return header;
}
function buildLoginPacket(authorize, userId) {
    const versionByte = Buffer.from([exports.PROTOCOL_VERSION]);
    const userIdBytes = Buffer.alloc(4);
    userIdBytes.writeUInt32BE(userId, 0);
    const authBytes = Buffer.from(authorize, 'ascii');
    const authLen = Buffer.alloc(2);
    authLen.writeUInt16BE(authBytes.length, 0);
    const suffix = Buffer.from([0x00, 0x00, 0x1e]);
    const payload = Buffer.concat([versionByte, userIdBytes, authLen, authBytes, suffix]);
    return Buffer.concat([buildOuterHeader(MessageType.LOGIN, false, payload.length), payload]);
}
function buildPingPacket() {
    return Buffer.from([0xd3, 0x00, 0x00, 0x00, 0x00]);
}
/** Payload for PIPE messages: hub device id + counter + 1 zero + inner frame. */
function buildPipePayload(hubDeviceId, inner) {
    const idBytes = Buffer.alloc(4);
    idBytes.writeUInt32BE(hubDeviceId, 0);
    const counterBytes = Buffer.alloc(2);
    counterBytes.writeUInt16BE(nextOuterCounter(), 0);
    return Buffer.concat([idBytes, counterBytes, Buffer.from([0x00]), inner]);
}
function buildPipePacket(hubDeviceId, inner) {
    const payload = buildPipePayload(hubDeviceId, inner);
    return Buffer.concat([buildOuterHeader(MessageType.PIPE, false, payload.length), payload]);
}
function buildProbePacket(deviceId) {
    const idBytes = Buffer.alloc(4);
    idBytes.writeUInt32BE(deviceId, 0);
    const counter = Buffer.alloc(2);
    counter.writeUInt16BE(nextOuterCounter(), 0);
    const payload = Buffer.concat([idBytes, counter, Buffer.from([0x00, 0x02])]);
    return Buffer.concat([buildOuterHeader(MessageType.PROBE, false, payload.length), payload]);
}
function checksum(bytes) {
    let acc = 0;
    for (const b of bytes)
        acc = (acc + b) & 0xff;
    return acc;
}
function escape7e(body) {
    const out = [];
    for (const b of body) {
        if (b === 0x7e) {
            out.push(0x7d, 0x5e);
        }
        else {
            out.push(b);
        }
    }
    return Buffer.from(out);
}
function unescape7e(body) {
    const out = [];
    for (let i = 0; i < body.length; i++) {
        if (body[i] === 0x7d && body[i + 1] === 0x5e) {
            out.push(0x7e);
            i++;
        }
        else {
            out.push(body[i]);
        }
    }
    return Buffer.from(out);
}
/**
 * Inner frame assembler.
 *
 * SET_POWER_STATE, SET_COLOR, SET_BRIGHTNESS and COMBO_CONTROL require the
 * 4-byte sequence number to appear twice — once at the start of the inner
 * frame and once at the start of the command body.
 */
function buildInnerFrame(commandCode, commandBody) {
    const seq = Buffer.alloc(4);
    seq.writeUInt32LE(nextInnerCounter(), 0);
    const direction = Buffer.from([PipeDirection.REQUEST]);
    const doubleSeq = commandCode === PipeCommand.SET_POWER_STATE ||
        commandCode === PipeCommand.SET_COLOR ||
        commandCode === PipeCommand.SET_BRIGHTNESS ||
        commandCode === PipeCommand.COMBO_CONTROL;
    const adjusted = doubleSeq ? Buffer.concat([seq, commandBody]) : commandBody;
    const lenLe = Buffer.alloc(2);
    lenLe.writeUInt16LE(adjusted.length, 0);
    const packetCommandBody = Buffer.concat([Buffer.from([commandCode]), lenLe, adjusted]);
    const cksum = Buffer.from([checksum(packetCommandBody)]);
    const body = Buffer.concat([seq, direction, packetCommandBody, cksum]);
    const escaped = escape7e(body);
    return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}
function meshIdLe(meshId) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(meshId, 0);
    return b;
}
// ── inner-frame builders ──
function buildQueryDeviceStatusInner() {
    const seq = Buffer.alloc(4);
    seq.writeUInt32LE(nextInnerCounter(), 0);
    const direction = Buffer.from([PipeDirection.REQUEST]);
    // 2 zeros + limit ffff + offset 0000
    const body = Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
    const lenLe = Buffer.alloc(2);
    lenLe.writeUInt16LE(body.length, 0);
    const packetBody = Buffer.concat([
        Buffer.from([PipeCommand.QUERY_DEVICE_STATUS_PAGES]),
        lenLe,
        body,
    ]);
    const cksum = Buffer.from([checksum(packetBody)]);
    const assembled = Buffer.concat([seq, direction, packetBody, cksum]);
    const escaped = escape7e(assembled);
    return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}
function buildSetPowerInner(meshId, isOn) {
    const body = Buffer.concat([
        Buffer.from([0x00]),
        meshIdLe(meshId),
        Buffer.from([PipeCommand.SET_POWER_STATE, 0x11, 0x02, isOn ? 1 : 0, 0x00, 0x00]),
    ]);
    return buildInnerFrame(PipeCommand.SET_POWER_STATE, body);
}
function buildSetBrightnessInner(meshId, brightness) {
    const b = Math.max(0, Math.min(100, Math.round(brightness))) & 0xff;
    const body = Buffer.concat([
        Buffer.from([0x00]),
        meshIdLe(meshId),
        Buffer.from([PipeCommand.SET_BRIGHTNESS, 0x11, 0x02, b]),
    ]);
    return buildInnerFrame(PipeCommand.SET_BRIGHTNESS, body);
}
function buildSetColorTempInner(meshId, tempPct) {
    const t = Math.max(0, Math.min(100, Math.round(tempPct))) & 0xff;
    const body = Buffer.concat([
        Buffer.from([0x00]),
        meshIdLe(meshId),
        Buffer.from([PipeCommand.SET_COLOR, 0x11, 0x02, 0x05, t]),
    ]);
    return buildInnerFrame(PipeCommand.SET_COLOR, body);
}
function buildSetRgbInner(meshId, r, g, b) {
    const body = Buffer.concat([
        Buffer.from([0x00]),
        meshIdLe(meshId),
        Buffer.from([PipeCommand.SET_COLOR, 0x11, 0x02, 0x04, r & 0xff, g & 0xff, b & 0xff]),
    ]);
    return buildInnerFrame(PipeCommand.SET_COLOR, body);
}
function buildSetEffectInner(meshId, effect) {
    const [b1, b2] = effects_1.FACTORY_EFFECTS[effect];
    const body = Buffer.concat([
        Buffer.from([0x00]),
        meshIdLe(meshId),
        Buffer.from([PipeCommand.SET_COLOR, 0x11, 0x02, 0x07, 0x01, b1, b2]),
    ]);
    return buildInnerFrame(PipeCommand.SET_COLOR, body);
}
function buildComboInner(meshId, isOn, brightness, colorTempPct, rgb) {
    const b = Math.max(0, Math.min(100, Math.round(brightness))) & 0xff;
    let colorModeAndRgb;
    if (colorTempPct !== null) {
        colorModeAndRgb = Buffer.from([colorTempPct & 0xff, 0x00, 0x00, 0x00]);
    }
    else if (rgb !== null) {
        colorModeAndRgb = Buffer.from([0xfe, rgb[0] & 0xff, rgb[1] & 0xff, rgb[2] & 0xff]);
    }
    else {
        colorModeAndRgb = Buffer.from([0xff, 0x00, 0x00, 0x00]);
    }
    const body = Buffer.concat([
        Buffer.from([0x00]),
        meshIdLe(meshId),
        Buffer.from([PipeCommand.COMBO_CONTROL, 0x11, 0x02, isOn ? 1 : 0, b]),
        colorModeAndRgb,
    ]);
    return buildInnerFrame(PipeCommand.COMBO_CONTROL, body);
}
/**
 * Parse a PIPE payload carrying a QUERY_DEVICE_STATUS_PAGES response.
 * Returns per-device state deltas, or null if the packet isn't a status page.
 */
function parsePipeStatusPages(payload) {
    if (payload.length <= 7 || payload[7] !== 0x7e)
        return null;
    let inner = payload.subarray(7);
    if (inner[0] !== 0x7e || inner[inner.length - 1] !== 0x7e)
        return null;
    inner = inner.subarray(1, inner.length - 1);
    inner = unescape7e(inner);
    inner = inner.subarray(4); // drop seq
    // skip direction byte at [0], command at [1]
    if (inner[1] !== PipeCommand.QUERY_DEVICE_STATUS_PAGES)
        return null;
    const dataLength = inner.readUInt16LE(2);
    const frameBody = inner.subarray(1, 1 + 2 + dataLength); // command + len + data
    const data = frameBody.subarray(3);
    if (data.length < 6)
        return [];
    const deviceCount = data.readUInt16LE(4);
    let cursor = data.subarray(6);
    const out = [];
    for (let i = 0; i < deviceCount; i++) {
        if (cursor.length < 24)
            break;
        const slice = cursor.subarray(0, 24);
        out.push({
            meshId: slice.readUInt16LE(0),
            isOnline: slice[3] === 1,
            isOn: slice[8] === 1,
            brightness: slice[12],
            colorMode: slice[16],
            rgb: [slice[20], slice[21], slice[22]],
        });
        cursor = cursor.subarray(24);
    }
    return out;
}
