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
  });
}
