import { create, fromBinary, toBinary, type DescMessage } from "@bufbuild/protobuf";

import {
  ControlMessageKind,
  FrameworkErrorCode,
  WireEnvelopeSchema,
  type TraceContext,
  type WireEnvelope,
} from "@balance/plugin-generated/generated/balance/runtime/v1/plugin_protocol_pb";

export const PROTOCOL_VERSION = 1;

export function encodeFrame(envelope: WireEnvelope): Uint8Array {
  const payload = toBinary(WireEnvelopeSchema, envelope);
  const frame = new Uint8Array(4 + payload.length);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, payload.length, false);
  frame.set(payload, 4);
  return frame;
}

export function tryDecodeFrames(
  buffer: Uint8Array,
): { frames: WireEnvelope[]; remainder: Uint8Array } {
  const frames: WireEnvelope[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  while (offset + 4 <= buffer.length) {
    const frameLength = view.getUint32(offset, false);
    if (offset + 4 + frameLength > buffer.length) {
      break;
    }

    const payload = buffer.subarray(offset + 4, offset + 4 + frameLength);
    frames.push(fromBinary(WireEnvelopeSchema, payload));
    offset += 4 + frameLength;
  }

  return {
    frames,
    remainder: buffer.subarray(offset),
  };
}

export function decodePayload<T>(
  schema: DescMessage,
  payload: Uint8Array,
): T {
  return fromBinary(schema, payload) as T;
}

export function encodePayload(schema: DescMessage, payload: unknown): Uint8Array {
  return toBinary(schema, create(schema, payload as never));
}

export function createFrameworkErrorEnvelope(input: {
  requestId: bigint;
  code: FrameworkErrorCode;
  message: string;
  traceContext?: TraceContext;
}): WireEnvelope {
  return create(WireEnvelopeSchema, {
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    traceContext: input.traceContext,
    body: {
      case: "frameworkError",
      value: {
        code: input.code,
        message: input.message,
      },
    },
  });
}

export function createRpcResponseEnvelope(input: {
  requestId: bigint;
  payload: Uint8Array;
  traceContext?: TraceContext;
}): WireEnvelope {
  return create(WireEnvelopeSchema, {
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    traceContext: input.traceContext,
    body: {
      case: "rpcResponse",
      value: {
        payload: input.payload,
      },
    },
  });
}

export function createControlEnvelope(input: {
  requestId: bigint;
  kind: ControlMessageKind;
  traceContext?: TraceContext;
}): WireEnvelope {
  return create(WireEnvelopeSchema, {
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    traceContext: input.traceContext,
    body: {
      case: "control",
      value: {
        kind: input.kind,
      },
    },
  });
}
