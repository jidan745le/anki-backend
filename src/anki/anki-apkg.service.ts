import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { Repository } from 'typeorm';
import { AnkiService } from './anki.service';
import { Card, ContentType } from './entities/card.entity';
import { Deck, DeckStatus } from './entities/deck.entity';
import { UserDeckService } from './user-deck.service';

@Injectable()
export class AnkiApkgService {
  private readonly logger = new Logger(AnkiApkgService.name);

  constructor(
    private readonly ankiService: AnkiService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly userDeckService: UserDeckService,
    @InjectRepository(Deck)
    private readonly deckRepository: Repository<Deck>,
  ) {
    this.logger.log('AnkiApkgService初始化');
  }

  /**
   * 第一步：解析APKG文件并返回模板实例（同步）
   */
  async parseApkgTemplates(
    file: Express.Multer.File,
    userId: number,
  ): Promise<any> {
    try {
      this.logger.log(
        `开始解析APKG文件模板: ${file.originalname}, 用户ID: ${userId}`,
      );

      // 创建唯一任务ID用于跟踪
      const taskId = randomUUID();
      const tempDir = path.join(process.cwd(), 'uploads', 'apkg-temp', taskId);

      // 确保临时目录存在
      this.logger.log(`创建临时目录: ${tempDir}`);
      fs.mkdirSync(tempDir, { recursive: true });

      // 将文件保存到临时目录
      const filePath = path.join(tempDir, 'deck.apkg');
      this.logger.log(`复制文件到: ${filePath}`);
      fs.writeFileSync(filePath, fs.readFileSync(file.path));

      // 使用桥接脚本处理APKG文件
      const extractDir = path.join(tempDir, 'extracted');
      this.logger.log(`提取目录: ${extractDir}`);

      this.logger.log('调用桥接脚本...');
      await this.executeBridgeScript(filePath, extractDir, userId, taskId);

      // 从JSON读取解析结果
      const resultsPath = path.join(extractDir, 'parsed_results.json');
      if (!fs.existsSync(resultsPath)) {
        throw new Error('解析APKG文件失败: 未生成结果文件');
      }

      this.logger.log(`读取解析结果: ${resultsPath}`);
      const parsedData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      this.logger.log(
        `解析结果: ${parsedData.notes}笔记, ${parsedData.cards.length}卡片`,
      );

      // 分析模板类型
      const templates = this.analyzeTemplates(parsedData);

      this.logger.log(`分析出${templates.length}个模板类型`);

      // 返回解析结果，包含模板信息
      return {
        taskId,
        totalNotes: parsedData.notes,
        totalCards: parsedData.cards.length,
        templates,
      };
    } catch (error) {
      this.logger.error('parseApkgTemplates函数出错:', error);
      throw error;
    }
  }

  /**
   * 分析模板类型，从parsedData中提取不同的模板
   */
  private analyzeTemplates(parsedData: any): any[] {
    const templateMap = new Map();
    const sampleCardsMap = new Map();

    // 遍历所有卡片，按模板名称分组
    parsedData.cards.forEach((card: any) => {
      const templateName = card.template.name;

      if (!templateMap.has(templateName)) {
        templateMap.set(templateName, {
          name: templateName,
          front: card.template.front,
          back: card.template.back,
          count: 0,
          fields: new Set(),
        });
        sampleCardsMap.set(templateName, []);
      }

      const template = templateMap.get(templateName);
      template.count++;

      // 收集字段名称
      Object.keys(card.fields).forEach((field) => {
        template.fields.add(field);
      });

      // 保存前3个样例卡片
      if (sampleCardsMap.get(templateName).length < 3) {
        sampleCardsMap.get(templateName).push({
          fields: card.fields,
          renderedSample: this.renderAnkiCard(
            card.template.front,
            card.template.back,
            card.fields,
          ),
        });
      }
    });

    // 转换为数组格式
    const templates = Array.from(templateMap.entries()).map(
      ([name, template]) => ({
        name: template.name,
        front: template.front,
        back: template.back,
        count: template.count,
        fields: Array.from(template.fields),
        sampleCards: sampleCardsMap.get(name),
      }),
    );

    return templates;
  }

  /**
   * 第二步：根据选择的模板异步执行渲染入库
   */
  async processSelectedTemplates(
    taskId: string,
    selectedTemplates: any[],
    deckInfo: Deck & { user: any },
    userId: number,
  ): Promise<any> {
    try {
      this.logger.log(
        `开始处理选择的模板: taskId=${taskId}, 牌组ID=${deckInfo.id}, 用户ID=${userId}`,
      );

      // 发送初始进度通知
      this.websocketGateway.sendTaskInit(userId, taskId);
      this.websocketGateway.sendProgress(
        userId,
        taskId,
        10,
        '开始处理选择的模板',
      );

      // 异步处理文件
      this.logger.log('启动异步处理');
      this.processSelectedTemplatesAsync(
        taskId,
        selectedTemplates,
        deckInfo,
        userId,
      ).catch((error) => {
        this.logger.error(
          `处理选择的模板时发生错误，牌组ID: ${deckInfo.id}:`,
          error,
        );
        this.websocketGateway.sendProgress(
          userId,
          taskId,
          -1,
          `错误: ${error.message}`,
        );
      });

      // 立即返回结果
      this.logger.log(`返回初始响应，任务ID: ${taskId}`);
      return {
        ...deckInfo,
        taskId,
        message: '开始处理选择的模板',
      };
    } catch (error) {
      this.logger.error('processSelectedTemplates函数出错:', error);
      throw error;
    }
  }

  /**
   * 异步处理选择的模板
   */
  private async processSelectedTemplatesAsync(
    taskId: string,
    selectedTemplates: any[],
    deck: Deck & { user: any },
    userId: number,
  ): Promise<void> {
    try {
      this.logger.log(
        `异步处理选择的模板开始: 牌组ID=${deck.id}, 用户ID=${userId}`,
      );

      // 根据taskId重新构造临时目录路径
      const tempDir = path.join(process.cwd(), 'uploads', 'apkg-temp', taskId);

      // 读取之前保存的解析结果
      const resultsPath = path.join(
        tempDir,
        'extracted',
        'parsed_results.json',
      );
      if (!fs.existsSync(resultsPath)) {
        throw new Error('找不到解析结果文件，请重新上传APKG文件');
      }

      const parsedData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      this.logger.log(
        `读取解析结果: ${parsedData.notes}笔记, ${parsedData.cards.length}卡片`,
      );

      // 创建选择的模板名称集合
      const selectedTemplateNames = new Set(
        selectedTemplates.map((t) => t.name),
      );

      // 过滤出匹配选择模板的卡片
      const filteredCards = parsedData.cards.filter((card: any) =>
        selectedTemplateNames.has(card.template.name),
      );

      this.logger.log(`过滤后的卡片数量: ${filteredCards.length}`);

      // 应用模板修改
      const modifiedCards = this.applyTemplateModifications(
        filteredCards,
        selectedTemplates,
      );

      // 开始导入卡片
      this.websocketGateway.sendProgress(
        userId,
        taskId,
        30,
        `导入${modifiedCards.length}张卡片`,
      );

      const totalCards = modifiedCards.length;
      this.logger.log(`开始处理${totalCards}张卡片`);

      const BATCH_SIZE = 100; // 每批处理100张卡片
      let cardsProcessed = 0;

      // 分批处理所有卡片
      while (cardsProcessed < totalCards) {
        const currentBatch = [];
        const endIndex = Math.min(cardsProcessed + BATCH_SIZE, totalCards);

        for (let i = cardsProcessed; i < endIndex; i++) {
          const cardData = modifiedCards[i];

          // 渲染卡片
          const renderedCard = this.renderAnkiCard(
            cardData.template.front,
            cardData.template.back,
            cardData.fields,
          );

          // 创建卡片实体
          const card = new Card();
          card.front = this.sanitizeHtml(renderedCard.front);
          card.back = this.sanitizeHtml(renderedCard.back);
          card.frontType = ContentType.TEXT;
          card.deck = deck;

          currentBatch.push(card);
        }

        // 更新进度
        cardsProcessed = endIndex;
        const progress = 30 + Math.floor((cardsProcessed / totalCards) * 50);
        this.logger.log(
          `已处理${cardsProcessed}/${totalCards}卡片，进度${progress}%`,
        );
        this.websocketGateway.sendProgress(
          userId,
          taskId,
          progress,
          `已处理${cardsProcessed}/${totalCards}卡片`,
        );

        // 将当前批次卡片保存到数据库
        this.logger.log(`保存批次: ${currentBatch.length}张卡片`);
        await this.ankiService.addCardsForUserDeck(
          currentBatch,
          deck.id,
          userId,
        );

        // 强制垃圾回收，释放内存
        if (global.gc) {
          this.logger.log('手动触发垃圾回收');
          global.gc();
        }
      }

      // 更新进度
      this.websocketGateway.sendProgress(userId, taskId, 80, '卡片导入完成');

      this.logger.log(`所有卡片处理完成: ${totalCards}张`);

      // 清理
      this.websocketGateway.sendProgress(userId, taskId, 90, '清理临时文件');

      // 清理临时文件
      this.logger.log(`清理临时目录: ${tempDir}`);
      this.cleanupTempFiles(tempDir);

      // 更新牌组状态为已完成
      this.logger.log(`更新牌组状态为已完成: ${deck.id}`);
      await this.deckRepository.update(deck.id, {
        status: DeckStatus.COMPLETED,
      });

      // 最终进度
      this.websocketGateway.sendProgress(userId, taskId, 100, '导入成功完成');

      this.logger.log(
        `选择模板处理完成，牌组ID: ${deck.id}, 用户ID: ${userId}`,
      );
    } catch (error) {
      this.logger.error('processSelectedTemplatesAsync函数出错:', error);

      // 更新牌组状态为失败
      this.logger.log(`更新牌组状态为失败: ${deck.id}`);
      await this.deckRepository.update(deck.id, {
        status: DeckStatus.FAILED,
      });

      // 重新抛出错误由调用者捕获
      throw error;
    }
  }

  /**
   * 应用前端对模板的修改
   */
  private applyTemplateModifications(
    cards: any[],
    selectedTemplates: any[],
  ): any[] {
    // 创建模板名称到修改后模板的映射
    const templateModifications = new Map();
    selectedTemplates.forEach((template) => {
      templateModifications.set(template.name, template);
    });

    // 应用修改
    return cards.map((card) => {
      const modification = templateModifications.get(card.template.name);
      if (modification) {
        return {
          ...card,
          template: {
            ...card.template,
            front: modification.front || card.template.front,
            back: modification.back || card.template.back,
          },
        };
      }
      return card;
    });
  }

  /**
   * 处理Anki APKG文件并创建一个牌组和卡片
   */
  async processApkgFile(
    file: Express.Multer.File,
    deckInfo: Deck & { user: any },
    userId: number,
  ): Promise<any> {
    try {
      this.logger.log(
        `开始处理APKG文件: ${file.originalname}, 用户ID: ${userId}`,
      );

      // 创建唯一任务ID用于跟踪进度
      this.logger.log(`生成任务ID: ${deckInfo.taskId}`);

      // 创建新牌组
      this.logger.log(`创建新牌组: ${deckInfo.name}`);

      this.logger.log(`牌组创建成功，ID: ${deckInfo.id}`);

      // 发送初始进度通知
      this.websocketGateway.sendProgress(
        userId,
        deckInfo.taskId,
        10,
        '开始处理APKG文件',
      );

      // 异步处理文件
      this.logger.log('启动异步处理');
      this.processApkgFileAsync(file, deckInfo, userId, deckInfo.taskId).catch(
        (error) => {
          this.logger.error(
            `处理APKG文件时发生错误，牌组ID: ${deckInfo.id}:`,
            error,
          );
          this.websocketGateway.sendProgress(
            userId,
            deckInfo.taskId,
            -1,
            `错误: ${error.message}`,
          );
        },
      );

      // 立即返回结果，附带额外属性
      this.logger.log(`返回初始响应，任务ID: ${deckInfo.taskId}`);
      return {
        ...deckInfo,
        taskId: deckInfo.taskId,
        message: '处理已开始',
      };
    } catch (error) {
      this.logger.error('processApkgFile函数出错:', error);
      throw error;
    }
  }

  /**
   * 异步处理APKG文件
   */
  private async processApkgFileAsync(
    file: Express.Multer.File,
    deck: Deck & { user: any },
    userId: number,
    taskId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `异步处理开始: 文件=${file.originalname}, 牌组ID=${deck.id}, 用户ID=${userId}`,
      );

      setTimeout(() => {
        this.websocketGateway.sendTaskInit(userId, taskId);
      }, 1000);

      // 确保临时目录存在
      const tempDir = path.join(process.cwd(), 'uploads', 'apkg-temp', taskId);
      this.logger.log(`创建临时目录: ${tempDir}`);
      fs.mkdirSync(tempDir, { recursive: true });

      // 将文件保存到临时目录
      const filePath = path.join(tempDir, 'deck.apkg');
      this.logger.log(`复制文件到: ${filePath}`);
      fs.writeFileSync(filePath, fs.readFileSync(file.path));

      // 更新进度
      this.websocketGateway.sendProgress(
        userId,
        taskId,
        20,
        '解压并分析APKG文件',
      );

      // 使用桥接脚本处理APKG文件
      const extractDir = path.join(tempDir, 'extracted');
      this.logger.log(`提取目录: ${extractDir}`);

      this.logger.log('调用桥接脚本...');
      await this.executeBridgeScript(filePath, extractDir, userId, taskId);

      // 解析解压后的内容
      this.websocketGateway.sendProgress(userId, taskId, 30, '分析deck结构');

      // 从JSON读取解析结果
      const resultsPath = path.join(extractDir, 'parsed_results.json');
      if (!fs.existsSync(resultsPath)) {
        throw new Error('解析APKG文件失败: 未生成结果文件');
      }

      this.logger.log(`读取解析结果: ${resultsPath}`);
      const parsedData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      this.logger.log(
        `解析结果: ${parsedData.notes}笔记, ${parsedData.cards.length}卡片`,
      );

      // 开始导入卡片
      this.websocketGateway.sendProgress(
        userId,
        taskId,
        40,
        `导入${parsedData.cards.length}张卡片`,
      );

      const totalCards = parsedData.cards.length;
      this.logger.log(`开始处理${totalCards}张卡片`);

      const BATCH_SIZE = 100; // 每批处理100张卡片
      let cardsProcessed = 0;

      // 分批处理所有卡片
      while (cardsProcessed < totalCards) {
        const currentBatch = [];
        const endIndex = Math.min(cardsProcessed + BATCH_SIZE, totalCards);

        for (let i = cardsProcessed; i < endIndex; i++) {
          const cardData = parsedData.cards[i];

          // 渲染卡片
          const renderedCard = this.renderAnkiCard(
            cardData.template.front,
            cardData.template.back,
            cardData.fields,
          );

          // 创建卡片实体
          const card = new Card();
          card.front = this.sanitizeHtml(renderedCard.front);
          card.back = this.sanitizeHtml(renderedCard.back);
          card.frontType = ContentType.TEXT;
          card.deck = deck;

          currentBatch.push(card);
        }

        // 更新进度
        cardsProcessed = endIndex;
        const progress = 40 + Math.floor((cardsProcessed / totalCards) * 20);
        this.logger.log(
          `已处理${cardsProcessed}/${totalCards}卡片，进度${progress}%`,
        );
        this.websocketGateway.sendProgress(
          userId,
          taskId,
          progress,
          `已处理${cardsProcessed}/${totalCards}卡片`,
        );

        // 将当前批次卡片保存到数据库
        this.logger.log(`保存批次: ${currentBatch.length}张卡片`);
        await this.ankiService.addCardsForUserDeck(
          currentBatch,
          deck.id,
          userId,
        );

        // 强制垃圾回收，释放内存
        //如果不使用--expose-gc参数启动应用，global.gc将是undefined，代码会跳过手动垃圾回收部分，但其他优化（如分批处理卡片、轻量级HTML解析）依然有效。
        if (global.gc) {
          this.logger.log('手动触发垃圾回收');
          global.gc();
        }
      }

      // 更新进度
      this.websocketGateway.sendProgress(userId, taskId, 60, '卡片导入完成');

      this.logger.log(`所有卡片处理完成: ${totalCards}张`);

      // 清理
      this.websocketGateway.sendProgress(userId, taskId, 90, '清理临时文件');

      // 清理临时文件
      this.logger.log(`清理临时目录: ${tempDir}`);
      this.cleanupTempFiles(tempDir);

      // this.logger.log(`删除原始文件: ${file.path}`);
      fs.unlinkSync(file.path);

      // 更新牌组状态为已完成
      this.logger.log(`更新牌组状态为已完成: ${deck.id}`);
      await this.deckRepository.update(deck.id, {
        status: DeckStatus.COMPLETED,
      });

      // 最终进度
      this.websocketGateway.sendProgress(userId, taskId, 100, '导入成功完成');

      this.logger.log(`APKG处理完成，牌组ID: ${deck.id}, 用户ID: ${userId}`);
    } catch (error) {
      this.logger.error('processApkgFileAsync函数出错:', error);

      // 更新牌组状态为失败
      this.logger.log(`更新牌组状态为失败: ${deck.id}`);
      await this.deckRepository.update(deck.id, {
        status: DeckStatus.FAILED,
      });

      // 重新抛出错误由调用者捕获
      throw error;
    }
  }

  /**
   * 执行桥接脚本作为单独进程
   */
  private executeBridgeScript(
    filePath: string,
    extractDir: string,
    userId: number,
    taskId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(
        process.cwd(),
        'scripts',
        'simple-apkg-bridge.js',
      );
      this.logger.log(`执行简化桥接脚本: ${scriptPath}`);
      this.logger.log(`参数: ${filePath} ${extractDir}`);

      // 增加内存限制参数
      const child = spawn('node', [
        '--max-old-space-size=4096',
        scriptPath,
        filePath,
        extractDir,
      ]);

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        const message = data.toString().trim();
        stdoutData += message;

        // 将重要日志转发给用户
        if (
          message.includes('找到') ||
          message.includes('处理完成') ||
          message.includes('解压完成')
        ) {
          this.websocketGateway.sendProgress(
            userId,
            taskId,
            25, // 在20-30之间保持固定进度
            message,
          );
        }

        this.logger.log(`桥接脚本输出: ${message}`);
      });

      child.stderr.on('data', (data) => {
        const message = data.toString().trim();
        stderrData += message;
        this.logger.error(`桥接脚本错误: ${message}`);
      });

      child.on('close', (code) => {
        if (code === 0) {
          this.logger.log('桥接脚本执行成功');
          resolve();
        } else {
          this.logger.error(`桥接脚本退出，代码: ${code}`);
          reject(new Error(`桥接脚本退出，代码: ${code}, 错误: ${stderrData}`));
        }
      });

      child.on('error', (err) => {
        this.logger.error(`执行桥接脚本失败: ${err.message}`);
        reject(new Error(`执行桥接脚本失败: ${err.message}`));
      });
    });
  }

  /**
   * 清理临时文件
   */
  private cleanupTempFiles(directory: string): void {
    try {
      if (fs.existsSync(directory)) {
        fs.rmSync(directory, { recursive: true, force: true });
        this.logger.log(`已删除目录: ${directory}`);
      }
    } catch (error) {
      this.logger.error(`清理目录时出错 ${directory}:`, error);
    }
  }

  /**
   * 清理HTML内容，移除潜在危险元素
   */
  private sanitizeHtml(html: string): string {
    // 基本清理 - 在实际应用中可能需要使用专门的HTML清理库
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/onerror=/gi, '')
      .replace(/onclick=/gi, '');
  }

  /**
   * 解析Anki模板并替换字段占位符
   */
  private parseAnkiTemplate(
    template: string,
    fields: Record<string, string>,
  ): string {
    let result = template;

    // 1. 处理基础字段替换 {{fieldName}}
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      const regex = new RegExp(`{{${fieldName}}}`, 'g');
      result = result.replace(regex, fieldValue || '');
    }

    // 2. 处理条件语句 {{#fieldName}} content {{/fieldName}}
    let hasConditionals = true;
    const maxIterations = 10; // 防止无限循环
    let iterations = 0;

    while (hasConditionals && iterations < maxIterations) {
      const beforeReplace = result;

      result = result.replace(
        /{{#([^}]+)}}([\s\S]*?){{\/\1}}/g,
        (match, fieldName, content) => {
          const fieldValue = fields[fieldName];
          if (fieldValue && fieldValue.trim() !== '') {
            // 递归处理条件内容中的模板语法
            return this.parseAnkiTemplate(content, fields);
          }
          return '';
        },
      );

      // 如果没有替换，退出循环
      hasConditionals = beforeReplace !== result;
      iterations++;
    }

    // 3. 处理反向条件语句 {{^fieldName}} content {{/fieldName}}
    let hasReverseConditionals = true;
    iterations = 0;

    while (hasReverseConditionals && iterations < maxIterations) {
      const beforeReplace = result;

      result = result.replace(
        /{{\^([^}]+)}}([\s\S]*?){{\/\1}}/g,
        (match, fieldName, content) => {
          const fieldValue = fields[fieldName];
          if (!fieldValue || fieldValue.trim() === '') {
            // 递归处理条件内容中的模板语法
            return this.parseAnkiTemplate(content, fields);
          }
          return '';
        },
      );

      hasReverseConditionals = beforeReplace !== result;
      iterations++;
    }

    // 4. 处理提示语法 {{hint:fieldName}}
    result = result.replace(/{{hint:([^}]+)}}/g, (match, fieldName) => {
      const fieldValue = fields[fieldName];
      if (!fieldValue || fieldValue.trim() === '') {
        return '';
      }

      const hintId = 'hint' + Math.random().toString(36).substr(2, 9);
      return `<a class="hint" href="#" onclick="this.style.display='none';
document.getElementById('${hintId}').style.display='block';
return false;" draggable="false">
${fieldName}</a>
<div id="${hintId}" class="hint" style="display: none">${fieldValue}</div>`;
    });

    // 5. 处理音频文件 [sound:filename]
    result = result.replace(/\[sound:([^\]]+)\]/g, (match, filename) => {
      return `<audio controls><source src="${filename}" type="audio/mpeg"></audio>`;
    });

    // 6. 处理text:fieldName语法（提取纯文本）
    result = result.replace(/{{text:([^}]+)}}/g, (match, fieldName) => {
      const fieldValue = fields[fieldName] || '';
      return fieldValue.replace(/<[^>]*>/g, '');
    });

    return result;
  }

  /**
   * 使用模板和字段渲染Anki卡片
   */
  private renderAnkiCard(
    frontTemplate: string,
    backTemplate: string,
    fields: Record<string, string>,
  ): { front: string; back: string } {
    const frontSide = this.parseAnkiTemplate(frontTemplate, fields);

    let backSide = backTemplate;
    backSide = backSide.replace(/{{FrontSide}}/g, frontSide);
    backSide = this.parseAnkiTemplate(backSide, fields);

    return {
      front: frontSide,
      back: backSide,
    };
  }

  /**
   * 从HTML中提取纯文本内容（轻量级方法，不使用DOM）
   */
  private extractTextFromHtml(html: string): string {
    try {
      // 检查输入是否为空
      if (!html || typeof html !== 'string') {
        return '';
      }

      // 轻量级HTML解析，不使用完整的DOM
      const text = html
        // 替换常见块级元素结束标签为换行
        .replace(/<\/div>|<\/p>|<\/h[1-6]>|<\/li>|<br\s*\/?>/gi, '\n')
        // 移除所有HTML标签
        .replace(/<[^>]*>/g, '')
        // 处理常见HTML实体
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '...')
        // 解码所有剩余的HTML实体
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        // 清理空白
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return text;
    } catch (error) {
      this.logger.error(`提取HTML纯文本失败: ${error.message}`);
      // 最简单的回退方案
      return html ? html.replace(/<[^>]*>/g, '') : '';
    }
  }
}
