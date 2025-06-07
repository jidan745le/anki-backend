export class UploadResponseDto {
  // wangEditor标准格式
  errno?: number;
  data?: {
    url?: string;
    alt?: string;
    href?: string;
    tempFileId?: string;
    originalName?: string;
    fileUrl?: string;
    path?: string;
  };

  // 自定义格式
  success?: boolean;
  message?: string;

  // 直接URL格式
  url?: string;
}
