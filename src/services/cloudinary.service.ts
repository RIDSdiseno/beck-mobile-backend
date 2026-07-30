import { UploadApiResponse, v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import { env } from "../config/env";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

export function uploadBufferToCloudinary(
  buffer: Buffer,
  options?: {
    folder?: string;
    publicId?: string;
  }
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        type: "authenticated",
        folder: options?.folder,
        public_id: options?.publicId,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("Cloudinary no devolvió resultado"));
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

export function uploadRawBufferToCloudinary(
  buffer: Buffer,
  options?: {
    folder?: string;
    publicId?: string;
  }
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        type: "authenticated",
        folder: options?.folder,
        public_id: options?.publicId,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("Cloudinary no devolvió resultado"));
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

export function deleteImageFromCloudinary(publicId: string) {
  return cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "authenticated",
  });
}

export function deleteRawFromCloudinary(publicId: string) {
  return cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
    type: "authenticated",
  });
}

export function getPrivateDownloadUrl(
  publicId: string,
  format: string,
  resourceType: "image" | "raw" = "image",
  expiresInSeconds = 5 * 60,
) {
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    attachment: resourceType === "raw",
  });
}

export function withPrivateImageUrl<T extends {
  public_id: string;
  formato?: string | null;
  url?: string;
}>(photo: T, expiresInSeconds = 30 * 60) {
  return {
    ...photo,
    url: getPrivateDownloadUrl(
      photo.public_id,
      photo.formato || "jpg",
      "image",
      expiresInSeconds,
    ),
  };
}
