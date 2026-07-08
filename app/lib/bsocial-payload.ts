export const B_PROTOCOL_ADDRESS = "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut";
export const MAP_PROTOCOL_ADDRESS = "1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5";
export const AIP_PROTOCOL_ADDRESS = "15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva";
export const DEFAULT_APP_NAME = "VZN.gold";

export type BSocialPostType = "post" | "reply";

export type BSocialImagePayload = {
  dataBase64: string;
  mediaType: string;
  size: number;
};

export type BSocialBuildParams = {
  content: string;
  appName: string;
  type: BSocialPostType;
  replyToTxid?: string;
  image?: BSocialImagePayload;
};

export type BSocialChunk = {
  data: string | Uint8Array;
  encoding: "utf8" | "binary";
};

export type BSocialOutput = BSocialChunk[];

const textChunk = (data: string): BSocialChunk => ({
  data,
  encoding: "utf8",
});

const binaryChunk = (data: Uint8Array): BSocialChunk => ({
  data,
  encoding: "binary",
});

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.includes(",") ? value.split(",").pop() || "" : value;

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(normalized, "base64"));
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function chunkToBytes(chunk: BSocialChunk): Uint8Array {
  if (chunk.data instanceof Uint8Array) {
    return chunk.data;
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(chunk.data, "utf8"));
  }

  return new TextEncoder().encode(chunk.data);
}

export function buildUnsignedBSocialOutputs({
  content,
  appName,
  type,
  replyToTxid,
  image,
}: BSocialBuildParams): BSocialOutput[] {
  const finalContent = content.trim();
  const outputs: BSocialOutput[] = [];

  if (finalContent) {
    const textOutput: BSocialOutput = [
      textChunk(B_PROTOCOL_ADDRESS),
      textChunk(finalContent),
      textChunk("text/markdown"),
      textChunk("UTF-8"),
      textChunk("|"),
      textChunk(MAP_PROTOCOL_ADDRESS),
      textChunk("SET"),
      textChunk("app"),
      textChunk(appName),
      textChunk("type"),
      textChunk("post"),
    ];

    if (type === "reply" && replyToTxid) {
      textOutput.push(
        textChunk("context"),
        textChunk("tx"),
        textChunk("tx"),
        textChunk(replyToTxid),
      );
    }

    outputs.push(textOutput);
  }

  if (image) {
    const imageOutput: BSocialOutput = [
      textChunk(B_PROTOCOL_ADDRESS),
      binaryChunk(base64ToBytes(image.dataBase64)),
      textChunk(image.mediaType),
      textChunk("binary"),
    ];

    if (!finalContent) {
      imageOutput.push(
        textChunk("|"),
        textChunk(MAP_PROTOCOL_ADDRESS),
        textChunk("SET"),
        textChunk("app"),
        textChunk(appName),
        textChunk("type"),
        textChunk("post"),
      );

      if (type === "reply" && replyToTxid) {
        imageOutput.push(
          textChunk("context"),
          textChunk("tx"),
          textChunk("tx"),
          textChunk(replyToTxid),
        );
      }
    }

    outputs.push(imageOutput);
  }

  return outputs;
}

export function appendAIPToOutputs(
  outputs: BSocialOutput[],
  signerAddress: string,
  signature: string,
): BSocialOutput[] {
  return outputs.map((output) => [
    ...output,
    textChunk("|"),
    textChunk(AIP_PROTOCOL_ADDRESS),
    textChunk("BITCOIN_ECDSA"),
    textChunk(signerAddress),
    textChunk(signature),
  ]);
}

export function buildAIPMessageBytes(outputs: BSocialOutput[]): number[] {
  // Collect all byte segments first, then flatten with index assignment.
  // NOTE: do NOT use `array.push(...bytes)` here. Image chunks can be ~1MB,
  // and spreading that many elements as function arguments throws a
  // RangeError (especially on iOS Safari, which has a low argument limit).
  const segments: Uint8Array[] = [];
  let totalLength = 0;

  for (const output of outputs) {
    const prefix = new Uint8Array([0x00, 0x6a]);
    segments.push(prefix);
    totalLength += prefix.length;

    for (const chunk of output) {
      const bytes = chunkToBytes(chunk);
      segments.push(bytes);
      totalLength += bytes.length;
    }
  }

  const messageBytes = new Array<number>(totalLength);
  let offset = 0;
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index += 1) {
      messageBytes[offset] = segment[index];
      offset += 1;
    }
  }

  return messageBytes;
}
