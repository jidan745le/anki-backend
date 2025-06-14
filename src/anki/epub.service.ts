import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fsPromises } from 'fs';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { marked } from 'marked';
import * as path from 'path';
import { Repository } from 'typeorm';
import { FileService } from '../file/file.service';
import { AnkiService } from './anki.service';
import { CreateEpubDeckDto } from './dto/create-epub-deck.dto';
import { Card, ContentType } from './entities/card.entity';
import { Deck } from './entities/deck.entity';
import { UserDeckService } from './user-deck.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseEpub } = require('epub2md');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const xml2js = require('xml2js');

// HeadingTextSplitter class
class HeadingTextSplitter {
  private headingLevel: string | number;
  private includePath: boolean;

  constructor(
    options: { headingLevel?: string | number; includePath?: boolean } = {},
  ) {
    this.headingLevel = options.headingLevel || 'all'; // 1 表示仅一级标题，'all' 表示所有级别
    this.includePath =
      options.includePath !== undefined ? options.includePath : true;
  }

  splitText(text: string): Array<{
    content: string;
    metadata: { path: string[]; level: number; title: string };
  }> {
    // 解析文档结构，生成标题层级树
    const docStructure = this.parseDocumentStructure(text);

    // 根据选择的标题级别过滤
    const chunks = this.generateChunks(docStructure, text);

    return chunks;
  }

  private parseDocumentStructure(text: string) {
    // 匹配所有标题行
    const headingPattern = /^(#{1,6})\s+(.*?)$/gm;
    const matches = [...text.matchAll(headingPattern)];

    // 根结点
    const root = {
      level: 0,
      title: 'root',
      children: [] as any[],
      startIndex: 0,
      endIndex: text.length,
      path: [] as string[],
    };

    // 当前的节点栈，初始只有根节点
    const stack = [root];

    // 处理每个标题
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const level = match[1].length; // 标题级别（# 的数量）
      const title = match[2]; // 标题文本
      const startIndex = match.index!; // 标题开始位置

      // 计算结束位置（下一个标题的开始或文档结束）
      const endIndex =
        i < matches.length - 1 ? matches[i + 1].index! : text.length;

      // 弹出栈中级别大于等于当前标题的节点
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      // 父节点是栈顶节点
      const parent = stack[stack.length - 1];

      // 创建当前标题节点
      const node = {
        level,
        title,
        children: [] as any[],
        startIndex,
        endIndex,
        path: [...parent.path, title],
      };

      // 添加到父节点的子节点中
      parent.children.push(node);

      // 将当前节点压入栈中
      stack.push(node);
    }

    return root;
  }

  private generateChunks(docStructure: any, text: string) {
    const chunks: Array<{
      content: string;
      metadata: { path: string[]; level: number; title: string };
    }> = [];

    // 如果文档开头有内容（在第一个标题之前）
    if (
      docStructure.children.length > 0 &&
      docStructure.children[0].startIndex > 0
    ) {
      const leadingContent = text.substring(
        0,
        docStructure.children[0].startIndex,
      );
      if (leadingContent.trim()) {
        chunks.push({
          content: leadingContent,
          metadata: {
            path: [],
            level: 0,
            title: 'Introduction',
          },
        });
      }
    }

    // 递归处理文档结构生成块
    this.processNode(docStructure, text, chunks);

    // 如果没有生成任何块，返回整个文档
    if (chunks.length === 0 && text.trim()) {
      chunks.push({
        content: text,
        metadata: {
          path: [],
          level: 0,
          title: 'Document',
        },
      });
    }

    return chunks;
  }

  private processNode(
    node: any,
    text: string,
    chunks: Array<{
      content: string;
      metadata: { path: string[]; level: number; title: string };
    }>,
  ) {
    // 处理子节点
    for (const child of node.children) {
      // 如果是需要包含的标题级别
      if (
        this.headingLevel === 'all' ||
        (this.headingLevel === 1 && child.level === 1)
      ) {
        // 提取该节点的内容
        const content = text.substring(child.startIndex, child.endIndex);

        chunks.push({
          content,
          metadata: {
            path: child.path,
            level: child.level,
            title: child.title,
          },
        });
      }

      // 递归处理子节点
      this.processNode(child, text, chunks);
    }
  }
}

interface EpubChapter {
  title: string;
  content: string;
  level: number;
  index: number;
}

interface ProcessedChunk {
  front: string;
  back: string;
  chapter: string;
  section: string;
  chunkIndex: number;
}

@Injectable()
export class EpubService {
  private readonly logger = new Logger(EpubService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp', 'epub');

  constructor(
    @InjectRepository(Deck)
    private deckRepository: Repository<Deck>,
    @InjectRepository(Card)
    private cardRepository: Repository<Card>,
    private fileService: FileService,
    private ankiService: AnkiService,
    private userDeckService: UserDeckService,
  ) {
    this.initializeTempDir();
  }

  private async initializeTempDir() {
    await this.ensureTempDir();
  }

  private async ensureTempDir() {
    try {
      await fsPromises.access(this.tempDir);
    } catch {
      await fsPromises.mkdir(this.tempDir, { recursive: true });
      this.logger.log(`Created temp directory: ${this.tempDir}`);
    }
  }

  // Helper function to check if file/directory exists
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async processEpubToDeck(
    file: Express.Multer.File,
    dto: CreateEpubDeckDto,
    userId: number,
  ): Promise<{ deck: Deck; cards: Card[] }> {
    const processingId = `epub_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const epubPath = path.join(this.tempDir, `${processingId}.epub`);
    const outputDir = path.join(this.tempDir, processingId);

    try {
      // 验证文件数据
      if (!file.buffer) {
        throw new Error(
          'File buffer is undefined. Please ensure the file was uploaded correctly.',
        );
      }

      // 保存EPUB文件
      await fsPromises.writeFile(epubPath, file.buffer);
      this.logger.log(`Saved EPUB file: ${epubPath}`);

      // 转换EPUB为Markdown
      this.logger.log('Converting EPUB to Markdown...');
      await this.convertEpubToMarkdown(epubPath, outputDir);

      // // 读取和处理章节
      const chapters = await this.readChapters(outputDir);

      // // 处理图片并替换链接（在分割之前）
      // this.logger.log(
      //   `🖼️ About to process images for ${chapters.length} chapters`,
      // );
      await this.processImagesInChapters(outputDir, chapters, userId);
      this.logger.log(`🖼️ Image processing completed`);

      // console.log(chapters);

      // // 分割文本并生成卡片数据
      const chunks = await this.processChapters(chapters, dto);

      // 创建Deck
      const deck = await this.createDeck(dto, userId);

      // 创建Cards
      const cards = await this.createCards(chunks, deck, userId);

      // 清理临时文件
      await this.cleanup(epubPath, outputDir);

      return { deck, cards };
      // return { deck: null, cards: null };
    } catch (error) {
      this.logger.error(`EPUB processing failed: ${error.message}`);
      await this.cleanup(epubPath, outputDir);
      throw error;
    }
  }

  private async convertEpubToMarkdown(
    epubPath: string,
    outputDir: string,
  ): Promise<void> {
    try {
      // Parse the EPUB file with error handling
      this.logger.log(`Attempting to parse EPUB file: ${epubPath}`);
      let epubObj;

      try {
        epubObj = await parseEpub(epubPath);
        this.logger.log(`Successfully parsed EPUB file`);

        // Validate the parsed object
        if (!epubObj || !epubObj.sections || epubObj.sections.length === 0) {
          this.logger.warn(
            `EPUB parsed but no sections found, trying fallback...`,
          );
          throw new Error('No sections found in parsed EPUB');
        }
      } catch (parseError) {
        this.logger.error(`Failed to parse EPUB file: ${parseError.message}`);
        this.logger.error(`Error details: ${parseError.stack}`);

        // Log more details about the error
        if (parseError.message.includes('#text')) {
          this.logger.error(
            `This appears to be a metadata parsing issue. The EPUB file may have malformed or missing metadata.`,
          );
        }

        // Try alternative parsing approach
        this.logger.log(`Attempting alternative parsing approach...`);
        try {
          epubObj = await this.parseEpubWithFallback(epubPath);
          this.logger.log(`Successfully parsed EPUB with fallback method`);
        } catch (fallbackError) {
          this.logger.error(
            `Fallback parsing also failed: ${fallbackError.message}`,
          );
          throw new Error(
            `Unable to parse EPUB file. The file may be corrupted or use an unsupported format. Original error: ${parseError.message}. Fallback error: ${fallbackError.message}`,
          );
        }
      }

      // Create output directory
      if (!(await this.fileExists(outputDir))) {
        await fsPromises.mkdir(outputDir, { recursive: true });
      }

      // Create images directory
      const imagesDir = path.join(outputDir, 'Images');
      if (!(await this.fileExists(imagesDir))) {
        await fsPromises.mkdir(imagesDir, { recursive: true });
      }

      this.logger.log(`📁 Created Images directory: ${imagesDir}`);

      // Extract images using EPUB manifest and zip access
      const imageCounter = 0;
      let totalExtractedImages = 0;

      this.logger.log(`🔍 Trying to extract images from EPUB object...`);

      // Print structure for debugging
      if (epubObj.structure) {
        // console.log(
        //   'EPUB Structure:',
        //   JSON.stringify(epubObj.structure, null, 2),
        // );
      }

      // Build section ID to title mapping from structure
      const sectionTitleMap = this.buildSectionTitleMap(epubObj.structure);

      this.logger.log(
        `📚 EPUB object keys: ${Object.keys(epubObj).join(', ')}`,
      );

      // Method 1: Try to access manifest for image resources
      if (epubObj._manifest) {
        this.logger.log(`📋 Found _manifest, checking for image resources...`);
        const manifestKeys = Object.keys(epubObj._manifest);
        // console.log(manifestKeys);
        this.logger.log(`📋 Manifest entries: ${manifestKeys.length}`);

        const imageEntries = manifestKeys.filter((key) => {
          const entry = epubObj._manifest[key];
          // console.log(key, entry);
          return (
            entry && entry.mediaType && entry.mediaType.startsWith('image/')
          );
        });

        this.logger.log(
          `🖼️ Found ${imageEntries.length} image entries in manifest`,
        );

        this.logger.log(Object.entries(epubObj._zip.files)[10][0]);

        for (const key of imageEntries) {
          const entry = epubObj._manifest[key];
          this.logger.log(
            `📷 Processing manifest image: ${key}, href: ${entry.href}, mediaType: ${entry.mediaType}`,
          );

          try {
            // Try to get the image data from zip
            if (
              epubObj._zip &&
              epubObj._zip.files &&
              epubObj._zip.files[entry.href]
            ) {
              const zipEntry = epubObj._zip.files[entry.href];
              this.logger.log(`📦 Found zip entry for ${entry.href}`);

              // Get the image data - handle both JSZip 2.x and 3.x
              let imageData;
              try {
                // Try JSZip 3.x method first
                if (zipEntry.async) {
                  imageData = await zipEntry.async('uint8array');
                } else if (zipEntry.asUint8Array) {
                  // Fallback to JSZip 2.x method
                  imageData = await zipEntry.asUint8Array();
                } else {
                  this.logger.warn(
                    `❌ Unknown JSZip version for ${entry.href}`,
                  );
                  continue;
                }
              } catch (methodError) {
                this.logger.error(
                  `❌ Error with JSZip method for ${entry.href}: ${methodError.message}`,
                );
                continue;
              }
              if (imageData && imageData.length > 0) {
                // Use the original filename from href, but clean it up
                const originalName = path.basename(entry.href);
                const imagePath = path.join(imagesDir, originalName);

                // Write image data with original filename
                await fsPromises.writeFile(imagePath, imageData);

                if (await this.fileExists(imagePath)) {
                  const stats = await fsPromises.stat(imagePath);
                  totalExtractedImages++;
                  this.logger.log(
                    `💾 Extracted image: ${originalName} (${entry.mediaType}, ${stats.size} bytes)`,
                  );
                }
              } else {
                this.logger.warn(`❌ Empty image data for ${entry.href}`);
              }
            } else {
              this.logger.warn(`❌ No zip entry found for ${entry.href}`);
            }
          } catch (error) {
            this.logger.error(
              `❌ Error extracting image ${entry.href}: ${error.message}`,
            );
          }
        }
      } else {
        this.logger.log(`📷 No _manifest property found in epubObj`);
      }

      // Method 2: Alternative - check _zip directly for image files
      if (totalExtractedImages === 0 && epubObj._zip && epubObj._zip.files) {
        this.logger.log(`🔍 Checking zip files directly for images...`);
        const zipFiles = Object.keys(epubObj._zip.files);
        this.logger.log(`📦 Total zip files: ${zipFiles.length}`);

        const imageFiles = zipFiles.filter((fileName) => {
          const lowerName = fileName.toLowerCase();
          return (
            lowerName.includes('image') ||
            lowerName.endsWith('.jpg') ||
            lowerName.endsWith('.jpeg') ||
            lowerName.endsWith('.png') ||
            lowerName.endsWith('.gif') ||
            lowerName.endsWith('.webp') ||
            lowerName.endsWith('.svg')
          );
        });

        // console.log(imageFiles);

        this.logger.log(
          `🖼️ Found ${imageFiles.length} potential image files in zip`,
        );

        for (const fileName of imageFiles) {
          try {
            const zipEntry = epubObj._zip.files[fileName];

            // Get the image data - handle both JSZip 2.x and 3.x
            let imageData;
            try {
              // Try JSZip 3.x method first
              if (zipEntry.async) {
                imageData = await zipEntry.async('uint8array');
              } else if (zipEntry.asUint8Array) {
                // Fallback to JSZip 2.x method
                imageData = await zipEntry.asUint8Array();
              } else {
                this.logger.warn(`❌ Unknown JSZip version for ${fileName}`);
                continue;
              }
            } catch (methodError) {
              this.logger.error(
                `❌ Error with JSZip method for ${fileName}: ${methodError.message}`,
              );
              continue;
            }

            if (imageData && imageData.length > 0) {
              // Use the original filename from zip
              const originalName = path.basename(fileName);
              const imagePath = path.join(imagesDir, originalName);

              await fsPromises.writeFile(imagePath, imageData);

              if (await this.fileExists(imagePath)) {
                // const stats = fs.statSync(imagePath);
                totalExtractedImages++;
                // this.logger.log(
                //   `💾 Extracted image from zip: ${originalName} (${fileName}, ${stats.size} bytes)`,
                // );
              }
            }
          } catch (error) {
            this.logger.error(
              `❌ Error extracting zip image ${fileName}: ${error.message}`,
            );
          }
        }
      }

      // Final verification
      this.logger.log(`🔍 Total images extraction attempted: ${imageCounter}`);
      this.logger.log(
        `✅ Total images successfully extracted: ${totalExtractedImages}`,
      );

      // List actual files in the Images directory
      if (await this.fileExists(imagesDir)) {
        const actualFiles = await fsPromises.readdir(imagesDir);
        this.logger.log(
          `📂 Actual files in Images directory: ${actualFiles.length} files`,
        );
        if (actualFiles.length > 0) {
          this.logger.log(
            `📂 Files: ${actualFiles.slice(0, 10).join(', ')}${
              actualFiles.length > 10 ? '...' : ''
            }`,
          );
        }
      } else {
        this.logger.error(`❌ Images directory does not exist: ${imagesDir}`);
      }

      // Convert each section to markdown and save
      if (epubObj.sections && epubObj.sections.length > 0) {
        let j = 0;
        for (let i = 0; i < epubObj.sections.length; i++) {
          const section = epubObj.sections[i];

          // Handle both sync and async toMarkdown methods
          let markdownResult;
          try {
            markdownResult = section.toMarkdown();
            // If it's a promise, await it
            if (markdownResult && typeof markdownResult.then === 'function') {
              markdownResult = await markdownResult;
            }
          } catch (error) {
            this.logger.error(
              `Error calling toMarkdown for section ${section.id}: ${error.message}`,
            );
            continue;
          }

          let title = sectionTitleMap.get(section.id) || '';
          if (!title) {
            continue;
          }

          // console.log('markdownResult', markdownResult);

          let markdownContent = '';
          if (typeof markdownResult === 'string') {
            markdownContent = markdownResult;
          } else if (markdownResult && typeof markdownResult === 'object') {
            markdownContent =
              markdownResult.markdown ||
              markdownResult.content ||
              markdownResult.text ||
              markdownResult.data ||
              '';
          }

          // Clean up XML declarations and unwanted content
          markdownContent = this.cleanMarkdownContent(markdownContent);

          // Get title from structure map, fallback to extracting from content
          if (!title || title.trim() === '') {
            title = this.extractTitleFromMarkdown(markdownContent, j + 1);
          } else {
            title = this.sanitizeFilename(title);
          }

          // Ensure title is not empty
          if (!title || title.trim() === '') {
            title = `Section_${j + 1}`;
          }

          // Generate filename with title: 001-章节标题.md
          const filename = `${String(j++).padStart(3, '0')}-${title}.md`;
          const filePath = path.join(outputDir, filename);

          // console.log(
          //   `Processing section ${i + 1}: ${
          //     section.id
          //   } -> ${title} -> ${filename}`,
          // );

          // Write markdown content to file
          await fsPromises.writeFile(filePath, markdownContent, 'utf8');
        }
      } else {
        throw new Error('No sections found in EPUB file');
      }
    } catch (error) {
      this.logger.error(`EPUB conversion error: ${error.message}`);
      throw error;
    }
  }

  private cleanMarkdownContent(content: string): string {
    return (
      content
        // Remove XML declaration
        .replace(/<\?xml[^>]*\?>/gi, '')
        // Remove DOCTYPE declaration
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, '')
        // Remove remaining HTML tags that might not have been converted
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<\/?head[^>]*>/gi, '')
        .replace(/<\/?body[^>]*>/gi, '')
        .replace(/<\/?title[^>]*>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<meta[^>]*>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        // Remove div with page-break style (common in EPUB)
        .replace(/<div[^>]*page-break[^>]*>[\s\S]*?<\/div>/gi, '')
        // Clean up multiple consecutive newlines
        .replace(/\n{3,}/g, '\n\n')
        // Trim whitespace at the beginning and end
        .trim()
    );
  }

  private extractTitleFromMarkdown(
    markdownContent: string,
    sectionIndex: number,
  ): string {
    // Split content into lines
    const lines = markdownContent.split('\n');

    // Find the first heading line (starts with #)
    const headingLine = lines.find((line) => line.trim().match(/^#+\s+.+/));

    let title = '';
    if (headingLine) {
      // Remove # symbols and trim
      title = headingLine.replace(/^#+\s*/, '').trim();
    } else {
      // If no heading found, try to find meaningful text from first few lines
      const meaningfulLines = lines
        .filter((line) => line.trim().length > 0 && !line.includes('<'))
        .slice(0, 3);

      if (meaningfulLines.length > 0) {
        title = meaningfulLines[0].trim();
      } else {
        title = `Section ${sectionIndex}`;
      }
    }

    // Clean the title to make it safe for filename
    title = this.sanitizeFilename(title);

    // Limit length to avoid too long filenames
    if (title.length > 50) {
      title = title.substring(0, 50) + '...';
    }

    return title || `Section${sectionIndex}`;
  }

  private sanitizeFilename(text: string): string {
    if (!text || text.trim() === '') {
      return 'untitled';
    }

    // Remove or replace characters that are not safe for filenames
    let sanitized = text
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove forbidden chars and control chars
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^\w\u4e00-\u9fa5._-]/g, '') // Keep only word chars, Chinese chars, dots, underscores, hyphens
      .replace(/^\.+|\.+$/g, '') // Remove leading/trailing dots
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .trim();

    // Ensure filename is not empty after sanitization
    if (sanitized === '') {
      sanitized = 'untitled';
    }

    // Limit length to avoid filesystem issues (Windows has 255 char limit for paths)
    if (sanitized.length > 100) {
      sanitized = sanitized.substring(0, 100);
    }

    return sanitized;
  }

  private buildSectionTitleMap(structure: any[]): Map<string, string> {
    const titleMap = new Map<string, string>();

    if (!structure || !Array.isArray(structure)) {
      return titleMap;
    }

    const processStructureNode = (node: any) => {
      if (!node) return;

      // Determine if this is a main section (no # in path) or subsection (has # in path)
      const isMainSection = node.path && !node.path.includes('#');

      // Map sectionId to title, but prioritize main sections over subsections
      if (node.sectionId) {
        // Only set if not already exists (prioritize main sections) OR if this is a main section
        if (!titleMap.has(node.sectionId) || isMainSection) {
          titleMap.set(node.sectionId, node.name || '');
          // console.log(
          //   `Mapping: ${node.sectionId} -> ${node.name} ${
          //     isMainSection ? '(main section)' : '(subsection)'
          //   } [path: ${node.path}]`,
          // );
        } else {
          console.log(
            `Skipping subsection mapping: ${node.sectionId} -> ${node.name} (main section already mapped) [path: ${node.path}]`,
          );
        }
      }

      // Process children recursively
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          processStructureNode(child);
        }
      }
    };

    // Process all nodes
    for (const node of structure) {
      processStructureNode(node);
    }

    console.log(`Built section title map with ${titleMap.size} entries`);
    return titleMap;
  }

  private getImageExtension(mediaType: string): string {
    const typeMap = {
      'image/jpeg': 'jpeg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    return typeMap[mediaType] || 'jpeg';
  }

  private async readChapters(outputDir: string): Promise<EpubChapter[]> {
    const chapters: EpubChapter[] = [];

    if (!(await this.fileExists(outputDir))) {
      throw new NotFoundException(`Output directory not found: ${outputDir}`);
    }

    const files = await fsPromises.readdir(outputDir);
    const markdownFiles = files.filter((file) => file.endsWith('.md')).sort();

    for (let i = 0; i < markdownFiles.length; i++) {
      const filePath = path.join(outputDir, markdownFiles[i]);
      const content = await fsPromises.readFile(filePath, 'utf8');

      // 提取标题（假设第一行是标题）
      const lines = content.split('\n');
      const titleLine =
        lines.find((line) => line.startsWith('#')) || markdownFiles[i];

      chapters.push({
        title: markdownFiles[i],
        content,
        level: this.getTitleLevel(titleLine),
        index: i + 1,
      });
    }

    return chapters;
  }

  private getTitleLevel(titleLine: string): number {
    const match = titleLine.match(/^(#+)/);
    return match ? match[1].length : 1;
  }

  private async processChapters(
    chapters: EpubChapter[],
    dto: CreateEpubDeckDto,
  ): Promise<ProcessedChunk[]> {
    const chunks: ProcessedChunk[] = [];

    // Validate and set chunk parameters - ensure they are numbers
    const chunkSize = Number(dto.chunkSize) || 500;
    const chunkOverlap = Number(dto.chunkOverlap) || 50;

    // Ensure chunkOverlap is less than chunkSize
    const validatedChunkOverlap = Math.min(
      chunkOverlap,
      Math.floor(chunkSize * 0.8),
    );

    if (chunkOverlap >= chunkSize) {
      this.logger.warn(
        `Invalid chunk configuration: chunkOverlap (${chunkOverlap}) >= chunkSize (${chunkSize}). Adjusting chunkOverlap to ${validatedChunkOverlap}`,
      );
    }

    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const chapter = chapters[chapterIndex];

      // ============== 第一步：使用 HeadingTextSplitter 按标题拆分 ==============
      const headingSplitter = new HeadingTextSplitter({
        headingLevel: 'all', // 分割所有级别的标题
        includePath: true,
      });

      const headingChunks = headingSplitter.splitText(chapter.content);
      // this.logger.log(
      //   `Chapter "${chapter.title}" split into ${headingChunks.length} heading sections`,
      // );

      for (
        let sectionIndex = 0;
        sectionIndex < headingChunks.length;
        sectionIndex++
      ) {
        const headingChunk = headingChunks[sectionIndex];
        const content = headingChunk.content;

        // ============== 第二步：保护图片+标题组合，防止被截断 ==============
        // const { protectedContent, placeholders } =
        //   this.protectImageCaptionCombinations(content);

        // ============== 第三步：使用 RecursiveCharacterTextSplitter 进一步拆分 ==============
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: chunkSize,
          chunkOverlap: validatedChunkOverlap,
          keepSeparator: true,
          separators: ['\n\n', '\n', '。', '.'],
        });

        const textChunks = await splitter.splitText(content);

        for (let i = 0; i < textChunks.length; i++) {
          const chunk = textChunks[i].trim();

          if (chunk.length < 20) {
            continue;
          }

          // ============== 第四步：还原 placeholder ==============
          // chunk = this.restorePlaceholders(chunk, placeholders);

          // ============== 第五步：生成正反面卡片 ==============
          // 生成正面（包含章节、小节和分段信息）
          const front = await this.generateEnhancedCardFront(
            chapter,
            headingChunk.metadata,
            i + 1,
            textChunks.length,
          );

          // 生成背面（HTML内容）
          const back = await this.convertMarkdownToHtml(chunk);

          chunks.push({
            front,
            back,
            chapter: chapter.title,
            section: headingChunk.metadata.title || `第${sectionIndex + 1}节`,
            chunkIndex: i + 1,
          });
        }
      }
    }

    return chunks;
  }

  // 保护图片+标题组合的方法
  private protectImageCaptionCombinations(content: string): {
    protectedContent: string;
    placeholders: Map<string, string>;
  } {
    const placeholders = new Map<string, string>();
    let protectedContent = content;
    let placeholderIndex = 0;

    // 匹配图片+标题组合的正则表达式
    // 匹配：![图片](路径) + 换行符 + 图X-X. 描述文字（支持多行描述）
    // 也匹配多个连续的图片+标题组合
    const imageCaptionPattern =
      /(\n*!\[[^\]]*\]\([^)]+\)\s*\n+图\d+-\d+\\?\.\s[^\n]+(?:\n+[^\n#]+)*(?:\n+!\[[^\]]*\]\([^)]+\)\s*\n+图\d+-\d+\\?\.\s[^\n]+(?:\n+[^\n#]+)*)*)/g;

    const matches = content.match(imageCaptionPattern);
    if (matches) {
      // this.logger.log(
      //   `Found ${matches.length} image-caption combinations to protect`,
      // );

      for (const match of matches) {
        const placeholder = `__IMAGE_CAPTION_PLACEHOLDER_${placeholderIndex++}__`;
        placeholders.set(placeholder, match);
        protectedContent = protectedContent.replace(match, placeholder);
      }
    }

    // 单独保护图片引用（如果没有被上面的模式匹配）
    const singleImagePattern = /(\n*!\[[^\]]*\]\([^)]+\)(?!\s*\n+图\d+-\d+))/g;
    const singleMatches = protectedContent.match(singleImagePattern);
    if (singleMatches) {
      this.logger.log(
        `Found ${singleMatches.length} standalone images to protect`,
      );
      for (const match of singleMatches) {
        // 跳过已经被保护的内容
        if (match.includes('__IMAGE_CAPTION_PLACEHOLDER_')) {
          continue;
        }
        const placeholder = `__SINGLE_IMAGE_PLACEHOLDER_${placeholderIndex++}__`;
        placeholders.set(placeholder, match);
        protectedContent = protectedContent.replace(match, placeholder);
      }
    }

    this.logger.log(
      `Protected ${placeholders.size} image/caption combinations`,
    );
    return { protectedContent, placeholders };
  }

  // 还原 placeholder 的方法
  private restorePlaceholders(
    content: string,
    placeholders: Map<string, string>,
  ): string {
    let restoredContent = content;

    for (const [placeholder, originalContent] of placeholders.entries()) {
      restoredContent = restoredContent.replace(placeholder, originalContent);
    }

    return restoredContent;
  }

  // 增强的卡片正面生成方法
  private async generateEnhancedCardFront(
    chapter: EpubChapter,
    sectionMetadata: { path: string[]; level: number; title: string },
    chunkIndex: number,
    totalChunks: number,
  ): Promise<string> {
    // 处理章节标题的 markdown
    const processedChapterTitle = await this.convertMarkdownToHtml(
      chapter.title,
    );

    // 处理小节标题的 markdown
    const processedSectionTitle = sectionMetadata.title
      ? await this.convertMarkdownToHtml(sectionMetadata.title)
      : '';

    // 处理路径中每个元素的 markdown
    const processedPath =
      sectionMetadata.path && sectionMetadata.path.length > 0
        ? await Promise.all(
            sectionMetadata.path.map((pathItem) =>
              this.convertMarkdownToHtml(pathItem),
            ),
          )
        : [];

    // 生成面包屑导航
    const breadcrumbHtml = this.generateBreadcrumbHtml(processedPath);

    // 生成进度条
    const progressHtml = this.generateProgressHtml(chunkIndex, totalChunks);

    // 生成简洁的 HTML 结构
    const html = `
      <div class="card-front-container">
        <!-- 章节标题 -->
        <div class="chapter-title">
          ${processedChapterTitle}
        </div>
        
        ${
          sectionMetadata.title &&
          sectionMetadata.title !== 'Introduction' &&
          sectionMetadata.title !== 'Document'
            ? `
        <!-- 小节标题 -->
        <div class="section-title">
          ${processedSectionTitle}
        </div>
        `
            : ''
        }
        
        ${
          breadcrumbHtml
            ? `
        <!-- 面包屑导航 -->
        <div class="breadcrumb-container">
          ${breadcrumbHtml}
        </div>
        `
            : ''
        }
        
        <!-- 分段进度 -->
        <div class="progress-container">
          ${progressHtml}
        </div>
      </div>

      <style>
        .card-front-container {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          padding: 12px;
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 6px;
          color: #333;
          font-size: 0.85em;
          line-height: 1.4;
        }
        
        .chapter-title {
          font-size: 1em;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 8px;
        }
        
        .section-title {
          font-size: 0.9em;
          font-weight: 500;
          color: #5a6c7d;
          margin-bottom: 8px;
        }
        
        .breadcrumb-container {
          margin-bottom: 10px;
        }
        
        .breadcrumb {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px;
          font-size: 0.75em;
          color: #6c757d;
        }
        
        .breadcrumb-item {
          background: #e9ecef;
          padding: 2px 6px;
          border-radius: 3px;
          font-weight: 500;
        }
        
        .breadcrumb-separator {
          color: #adb5bd;
          margin: 0 2px;
        }
        
        .progress-container {
          border-top: 1px solid #e9ecef;
          padding-top: 8px;
        }
        
        .progress-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
          font-size: 0.75em;
          color: #6c757d;
        }
        
        .progress-bar {
          width: 100%;
          height: 3px;
          background: #e9ecef;
          border-radius: 2px;
          overflow: hidden;
        }
        
        .progress-fill {
          height: 100%;
          background: #007bff;
          border-radius: 2px;
          transition: width 0.2s ease;
        }
      </style>
    `;

    return html;
  }

  private generateBreadcrumbHtml(processedPath: string[]): string {
    if (!processedPath || processedPath.length === 0) {
      return '';
    }

    const breadcrumbItems = processedPath
      .map((pathItem, index) => {
        const isLast = index === processedPath.length - 1;
        return `
          <span class="breadcrumb-item">${pathItem}</span>
          ${!isLast ? '<span class="breadcrumb-separator">/</span>' : ''}
        `;
      })
      .join('');

    return `<div class="breadcrumb">${breadcrumbItems}</div>`;
  }

  private generateProgressHtml(
    chunkIndex: number,
    totalChunks: number,
  ): string {
    const percentage = Math.round((chunkIndex / totalChunks) * 100);

    return `
      <div class="progress-info">
        <span class="progress-text">${chunkIndex}/${totalChunks}</span>
        <span class="progress-percentage">${percentage}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percentage}%"></div>
      </div>
    `;
  }

  private async convertMarkdownToHtml(markdown: string): Promise<string> {
    return marked(markdown, {
      breaks: true,
      gfm: true,
    });
  }

  private async processImagesInChapters(
    outputDir: string,
    chapters: EpubChapter[],
    userId: number,
  ): Promise<void> {
    this.logger.log(`\n=== Starting image processing ===`);
    this.logger.log(`Output directory: ${outputDir}`);

    // 检查输出目录是否存在
    if (!(await this.fileExists(outputDir))) {
      this.logger.warn(`Output directory does not exist: ${outputDir}`);
      return;
    }

    // 列出输出目录的所有内容
    const outputDirContents = await fsPromises.readdir(outputDir);
    this.logger.log(
      `Output directory contents: ${outputDirContents.join(', ')}`,
    );

    const imagesDir = path.join(outputDir, 'images');
    const imagesDirUpper = path.join(outputDir, 'Images'); // 大写的Images

    // this.logger.log(`Checking for images directory: ${imagesDir}`);
    // this.logger.log(`Checking for Images directory: ${imagesDirUpper}`);

    let actualImagesDir = '';
    if (await this.fileExists(imagesDir)) {
      actualImagesDir = imagesDir;
      this.logger.log('Found images directory (lowercase)');
    } else if (await this.fileExists(imagesDirUpper)) {
      actualImagesDir = imagesDirUpper;
      this.logger.log('Found Images directory (uppercase)');
    } else {
      this.logger.warn(
        'No images or Images directory found, skipping image processing',
      );
      return;
    }

    this.logger.log('Processing images in chapters...');

    let imageFiles: string[] = [];
    try {
      imageFiles = await fsPromises.readdir(actualImagesDir);
      this.logger.log(`✅ Successfully read directory ${actualImagesDir}`);
      this.logger.log(
        `📂 Found ${imageFiles.length} files: ${imageFiles
          .slice(0, 10)
          .join(', ')}${imageFiles.length > 10 ? '...' : ''}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to read Images directory ${actualImagesDir}: ${error.message}`,
      );
      return;
    }

    // 建立图片名称到URL的映射
    const imageUrlMap = new Map<string, string>();
    let successfulUploads = 0;
    let failedUploads = 0;

    // 先上传所有图片到永久文件存储
    for (const imageFile of imageFiles) {
      const fullImagePath = path.join(actualImagesDir, imageFile);

      try {
        // 检查文件是否存在
        if (!(await this.fileExists(fullImagePath))) {
          this.logger.error(`❌ Image file does not exist: ${fullImagePath}`);
          failedUploads++;
          continue;
        }

        // 读取图片文件
        const imageBuffer = await fsPromises.readFile(fullImagePath);
        // this.logger.log(
        //   `📖 Read image file: ${imageFile} (${imageBuffer.length} bytes)`,
        // );

        const multerFile: Express.Multer.File = {
          fieldname: 'file',
          originalname: imageFile,
          encoding: '7bit',
          mimetype: this.getMimeType(imageFile),
          size: imageBuffer.length,
          buffer: imageBuffer,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        // 上传到永久文件存储
        // this.logger.log(`🚀 Uploading image: ${imageFile}...`);
        const tempFile = await this.fileService.uploadPermanentFile(
          multerFile,
          userId,
        );
        imageUrlMap.set(imageFile, tempFile.url);
        successfulUploads++;

        // this.logger.log(`✅ Uploaded image: ${imageFile} -> ${tempFile.url}`);
      } catch (error) {
        failedUploads++;
        this.logger.error(
          `❌ Failed to upload image ${imageFile}: ${error.message}`,
        );
        this.logger.error(`❌ Error stack: ${error.stack}`);
      }
    }

    this.logger.log(
      `📊 Upload summary: ${successfulUploads} successful, ${failedUploads} failed`,
    );
    this.logger.log(`🗺️  Image URL map size: ${imageUrlMap.size}`);
    this.logger.log(
      `🗺️  Image URL map keys: ${Array.from(imageUrlMap.keys()).join(', ')}`,
    );

    if (imageUrlMap.size === 0) {
      this.logger.warn(
        `⚠️  No images were successfully uploaded, skipping image processing`,
      );
      return;
    }

    // 替换章节内容中的图片链接
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      let updatedContent = chapter.content;

      // this.logger.log(
      //   `\n=== Processing images for chapter ${i + 1}: "${chapter.title}" ===`,
      // );
      // this.logger.log(`Original content length: ${updatedContent.length}`);

      // 显示内容的前500个字符来检查是否有图片引用
      if (updatedContent.length > 0) {
        const contentSample = updatedContent.substring(0, 1000);
        // this.logger.log(`Content sample: ${contentSample}...`);
      }

      // 查找HTML和Markdown中的图片引用
      // 测试不同的正则表达式
      this.logger.log(`Testing regex patterns on chapter ${i + 1} content...`);

      // Markdown图片: ![alt](path)
      const markdownImageMatches1 =
        updatedContent.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];

      // 简单的图片文件扩展名搜索

      const allImageMatches = [...markdownImageMatches1];

      if (allImageMatches.length > 0) {
        for (const match of allImageMatches) {
          const urlMatch = match.match(/!\[.*?\]\(([^)]+)\)/);
          let imagePath = '';
          if (urlMatch) {
            imagePath = urlMatch[1];
          }

          if (!imagePath) continue;

          const imageName = path.basename(imagePath);

          if (imageUrlMap.has(imageName)) {
            const newUrl = imageUrlMap.get(imageName);

            // 替换Markdown图片引用
            const newMarkdownImg = match.replace(imagePath, newUrl);
            updatedContent = updatedContent.replace(match, newMarkdownImg);
          } else {
            this.logger.warn(`❌ Image not found in map: ${imageName}`);
            // 尝试模糊匹配
            const similarImages = Array.from(imageUrlMap.keys()).filter(
              (key) => key.includes(imageName) || imageName.includes(key),
            );
            if (similarImages.length > 0) {
              this.logger.log(
                `Similar images found: ${similarImages.join(', ')}`,
              );
            }
          }
        }

        chapter.content = updatedContent;
        this.logger.log(
          `Final content length after image processing: ${updatedContent.length}`,
        );
      } else {
        this.logger.log(`No image references found in chapter ${i + 1}`);
      }
    }
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private async createDeck(
    dto: CreateEpubDeckDto,
    userId: number,
  ): Promise<Deck> {
    const deck = this.deckRepository.create({
      name: dto.name,
      description: dto.description || 'Generated from EPUB',
      creatorId: userId,
      deckType: 'normal' as any,
    });

    return await this.deckRepository.save(deck);
  }

  private async createCards(
    chunks: ProcessedChunk[],
    deck: Deck,
    userId: number,
  ): Promise<Card[]> {
    // First, assign the deck to the user to create the user-deck relationship
    await this.userDeckService.assignDeckToUser(userId, deck.id);

    const cards: Card[] = [];

    for (const chunk of chunks) {
      const card = this.cardRepository.create({
        front: chunk.front,
        back: chunk.back,
        deck,
        frontType: ContentType.TEXT,
      });

      cards.push(card);
    }

    const savedCards = await this.cardRepository.save(cards);

    // Now we can add cards for the user deck since the relationship exists
    await this.ankiService.addCardsForUserDeck(savedCards, deck.id, userId);

    return savedCards;
  }

  private async parseEpubWithFallback(epubPath: string): Promise<any> {
    // Alternative parsing approach for problematic EPUB files
    this.logger.log(`Attempting manual EPUB parsing for: ${epubPath}`);

    try {
      // Read the EPUB file as a ZIP
      const data = await fsPromises.readFile(epubPath);
      const zip = await JSZip.loadAsync(data);

      // Find and parse container.xml to get the content.opf path
      const containerXml = await zip
        .file('META-INF/container.xml')
        ?.async('text');
      if (!containerXml) {
        throw new Error('No container.xml found in EPUB');
      }

      const parser = new xml2js.Parser({ explicitArray: false });
      const containerData = await parser.parseStringPromise(containerXml);

      const rootfilePath =
        containerData?.container?.rootfiles?.rootfile?.['@_full-path'] ||
        containerData?.container?.rootfiles?.rootfile?.$?.['full-path'];

      if (!rootfilePath) {
        throw new Error('Could not find rootfile path in container.xml');
      }

      // Parse the content.opf file
      const contentOpf = await zip.file(rootfilePath)?.async('text');
      if (!contentOpf) {
        throw new Error(`Could not find content.opf at path: ${rootfilePath}`);
      }

      const opfData = await parser.parseStringPromise(contentOpf);

      // Create a simplified EPUB object structure
      const epubObj = {
        _zip: zip,
        _manifest: {},
        sections: [],
        structure: [],
      };

      // Process manifest
      const manifest = opfData?.package?.manifest?.item || [];
      const manifestItems = Array.isArray(manifest) ? manifest : [manifest];

      for (const item of manifestItems) {
        if (item && item.$) {
          const id = item.$.id;
          const href = item.$.href;
          const mediaType = item.$['media-type'];

          if (id && href) {
            epubObj._manifest[id] = {
              href: href,
              mediaType: mediaType,
            };
          }
        }
      }

      // Process spine to get reading order
      const spine = opfData?.package?.spine?.itemref || [];
      const spineItems = Array.isArray(spine) ? spine : [spine];

      // Create sections from spine
      for (let i = 0; i < spineItems.length; i++) {
        const spineItem = spineItems[i];
        if (spineItem && spineItem.$ && spineItem.$.idref) {
          const idref = spineItem.$.idref;
          const manifestItem = epubObj._manifest[idref];

          if (manifestItem) {
            const section = {
              id: idref,
              toMarkdown: async () => {
                // Simple HTML to Markdown conversion
                return await this.convertHtmlToMarkdown(zip, manifestItem.href);
              },
            };

            epubObj.sections.push(section);
            epubObj.structure.push({
              name: `Section ${i + 1}`,
              sectionId: idref,
              path: manifestItem.href,
              children: [],
            });
          }
        }
      }

      this.logger.log(
        `Fallback parsing created ${epubObj.sections.length} sections`,
      );
      return epubObj;
    } catch (error) {
      this.logger.error(`Fallback parsing failed: ${error.message}`);
      throw error;
    }
  }

  private async convertHtmlToMarkdown(zip: any, href: string): Promise<string> {
    try {
      const htmlContent = await zip.file(href)?.async('text');
      if (!htmlContent) {
        return '';
      }

      // Basic HTML to Markdown conversion
      // Remove HTML tags and convert basic formatting
      const markdown = htmlContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
        .replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, text) => {
          return (
            '\n' + '#'.repeat(parseInt(level)) + ' ' + text.trim() + '\n\n'
          );
        })
        .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
        .replace(/<br[^>]*>/gi, '\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
        .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
        .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
        .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return markdown;
    } catch (error) {
      this.logger.error(
        `Error converting HTML to Markdown for ${href}: ${error.message}`,
      );
      return '';
    }
  }

  private async cleanup(epubPath: string, outputDir: string): Promise<void> {
    try {
      if (await this.fileExists(epubPath)) {
        await fsPromises.unlink(epubPath);
      }
      if (await this.fileExists(outputDir)) {
        await fsPromises.rm(outputDir, { recursive: true, force: true });
      }
      this.logger.log('Cleanup completed');
    } catch (error) {
      this.logger.error(`Cleanup error: ${error.message}`);
    }
  }
}
