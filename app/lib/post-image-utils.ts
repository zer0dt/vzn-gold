import type { BSocialImagePayload } from "@/app/lib/bsocial-payload";

export const MAX_POST_IMAGE_BYTES = 1_048_576;

export const ACCEPTED_POST_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

export const POST_IMAGE_INPUT_ACCEPT = [
  ...ACCEPTED_POST_IMAGE_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
].join(",");

const HEIC_EXTENSIONS = [".heic", ".heif"];
const MAX_IMAGE_DIMENSION = 2048;
const MIN_JPEG_QUALITY = 0.62;

export type PreparedPostImage = BSocialImagePayload & {
  fileName: string;
  previewUrl: string;
  width: number;
  height: number;
};

export function getPostImageUrl(params: {
  txid: string;
  content?: string | null;
  hasImage?: boolean | null;
}): string | null {
  if (!params.hasImage) {
    return null;
  }

  const outputIndex = params.content?.trim() ? "_1" : "_0";
  return `https://ordinals.gorillapool.io/content/${params.txid}${outputIndex}`;
}

export function isAcceptedPostImageType(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return (
    ACCEPTED_POST_IMAGE_TYPES.includes(type) ||
    HEIC_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

export function formatImageSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function preparePostImage(file: File): Promise<PreparedPostImage> {
  if (!isAcceptedPostImageType(file)) {
    throw new Error("Choose a JPEG, PNG, WebP, GIF, HEIC, or HEIF image.");
  }

  const sourceType = getImageMimeType(file);

  if (sourceType === "image/gif") {
    if (file.size > MAX_POST_IMAGE_BYTES) {
      throw new Error("GIF images must be 1 MB or smaller.");
    }

    const dimensions = await getImageDimensions(file);

    return {
      dataBase64: await blobToBase64(file),
      mediaType: "image/gif",
      size: file.size,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  const browserReadableBlob = await toBrowserReadableImage(file, sourceType);
  const compressed = await compressImageToJpeg(browserReadableBlob);

  if (compressed.size > MAX_POST_IMAGE_BYTES) {
    throw new Error("This image could not be compressed under the 1 MB limit.");
  }

  const dimensions = await getImageDimensions(compressed);

  return {
    dataBase64: await blobToBase64(compressed),
    mediaType: "image/jpeg",
    size: compressed.size,
    fileName: file.name,
    previewUrl: URL.createObjectURL(compressed),
    width: dimensions.width,
    height: dimensions.height,
  };
}

function getImageMimeType(file: File): string {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type) {
    return type;
  }

  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function toBrowserReadableImage(
  file: File,
  sourceType: string,
): Promise<Blob> {
  if (sourceType === "image/heic" || sourceType === "image/heif") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9,
    });

    return Array.isArray(converted) ? converted[0] : converted;
  }

  return file;
}

async function compressImageToJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  let width = Math.max(1, Math.round(bitmap.width * scale));
  let height = Math.max(1, Math.round(bitmap.height * scale));

  try {
    for (let quality = 0.88; quality >= MIN_JPEG_QUALITY; quality -= 0.08) {
      const candidate = await drawToJpegBlob(bitmap, width, height, quality);
      if (candidate.size <= MAX_POST_IMAGE_BYTES) {
        return candidate;
      }
    }

    while (width > 640 && height > 640) {
      width = Math.max(1, Math.round(width * 0.85));
      height = Math.max(1, Math.round(height * 0.85));

      const candidate = await drawToJpegBlob(
        bitmap,
        width,
        height,
        MIN_JPEG_QUALITY,
      );
      if (candidate.size <= MAX_POST_IMAGE_BYTES) {
        return candidate;
      }
    }

    return drawToJpegBlob(bitmap, width, height, MIN_JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

async function drawToJpegBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare image for posting.");
  }

  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) {
    throw new Error("Could not compress image for posting.");
  }

  return blob;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const dimensions = {
    width: bitmap.width,
    height: bitmap.height,
  };
  bitmap.close();
  return dimensions;
}
