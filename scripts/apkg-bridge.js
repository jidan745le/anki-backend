#!/usr/bin/env node

/**
 * APKG解析桥接脚本
 *
 * 本脚本用于解决CommonJS和ES模块之间的兼容性问题
 * 通过创建一个临时ES模块环境，使用anki-apkg-parser库解析APKG文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== APKG解析桥接脚本启动 ===');
console.log('Node.js版本:', process.version);
console.log('工作目录:', process.cwd());
console.log('命令行参数:', process.argv);

/**
 * 解析APKG文件的主函数
 */
async function processApkg() {
    try {
        // 从命令行参数获取文件路径和输出目录
        const filePath = process.argv[2];
        const extractDir = process.argv[3];

        if (!filePath || !extractDir) {
            console.error('错误: 缺少必要参数 (文件路径和提取目录)');
            process.exit(1);
        }

        console.log(`输入文件: ${filePath}`);
        console.log(`输出目录: ${extractDir}`);

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            console.error(`错误: 文件不存在: ${filePath}`);
            process.exit(1);
        }

        // 确保输出目录存在
        if (!fs.existsSync(extractDir)) {
            console.log(`创建输出目录: ${extractDir}`);
            fs.mkdirSync(extractDir, { recursive: true });
        }

        // 创建临时目录用于处理ES模块
        const tempScriptDir = path.join(
            path.dirname(extractDir),
            'es_module_bridge',
        );
        console.log(`创建临时ES模块环境: ${tempScriptDir}`);

        if (fs.existsSync(tempScriptDir)) {
            console.log('清理已存在的临时目录');
            fs.rmSync(tempScriptDir, { recursive: true, force: true });
        }

        fs.mkdirSync(tempScriptDir, { recursive: true });

        // 检查依赖项
        try {
            console.log('检查ts-node是否安装...');
            require.resolve('ts-node');
            console.log('ts-node已安装');
        } catch (err) {
            console.error('错误: ts-node未安装，尝试安装...');
            try {
                execSync('npm install -D ts-node', { stdio: 'inherit' });
                console.log('ts-node安装成功');
            } catch (installErr) {
                console.error('安装ts-node失败:', installErr);
                process.exit(1);
            }
        }

        // 创建临时ES模块脚本
        const tempScriptPath = path.join(tempScriptDir, 'apkg-parser.mjs');
        console.log(`生成ES模块脚本: ${tempScriptPath}`);

        // 用更详细的日志记录创建ES模块脚本
        fs.writeFileSync(
            tempScriptPath,
            `
      // 这是动态生成的ES模块脚本，用于解析APKG文件
      import sqlite3 from 'sqlite3';
      import yauzl from 'yauzl';
      import * as fs from 'fs';
      import * as path from 'path';

      console.log('=== ES模块脚本开始执行 ===');
      console.log('Node.js版本:', process.version);
      console.log('正在手动实现APKG解析功能，不依赖外部包...');

      async function run() {
        try {
          const filePath = '${filePath.replace(/\\/g, '\\\\')}';
          const extractDir = '${extractDir.replace(/\\/g, '\\\\')}';
          
          console.log('解析文件:', filePath);
          console.log('输出目录:', extractDir);
          
          // 手动解压APKG文件 (实际上是zip文件)
          console.log('开始解压APKG文件...');
          
          // 创建提取目录
          if (!fs.existsSync(extractDir)) {
            fs.mkdirSync(extractDir, { recursive: true });
          }
          
          // 解压zip文件
          await new Promise((resolve, reject) => {
            yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
              if (err) {
                console.error('打开APKG/ZIP文件失败:', err);
                return reject(err);
              }
              
              console.log('成功打开APKG文件，开始解压...');
              const totalEntries = zipfile.entryCount;
              let processedEntries = 0;
              
              zipfile.on('entry', (entry) => {
                processedEntries++;
                console.log(\`处理文件 \${processedEntries}/\${totalEntries}: \${entry.fileName}\`);
                
                if (/\\\/$/.test(entry.fileName)) {
                  // 目录项，创建目录
                  const dirPath = path.join(extractDir, entry.fileName);
                  fs.mkdirSync(dirPath, { recursive: true });
                  zipfile.readEntry();
                } else {
                  // 文件项，提取文件
                  zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                      console.error(\`读取\${entry.fileName}失败:\`, err);
                      return zipfile.readEntry();
                    }
                    
                    const outputPath = path.join(extractDir, entry.fileName);
                    const outputDir = path.dirname(outputPath);
                    
                    if (!fs.existsSync(outputDir)) {
                      fs.mkdirSync(outputDir, { recursive: true });
                    }
                    
                    const writeStream = fs.createWriteStream(outputPath);
                    readStream.pipe(writeStream);
                    
                    writeStream.on('finish', () => {
                      console.log(\`已提取: \${entry.fileName}\`);
                      zipfile.readEntry();
                    });
                    
                    writeStream.on('error', (err) => {
                      console.error(\`写入\${entry.fileName}失败:\`, err);
                      zipfile.readEntry();
                    });
                  });
                }
              });
              
              zipfile.on('end', () => {
                console.log('APKG文件解压完成');
                resolve();
              });
              
              zipfile.on('error', (err) => {
                console.error('解压过程中出错:', err);
                reject(err);
              });
              
              zipfile.readEntry();
            });
          });
          
          console.log('解压完成');
          
          // 解析collection.anki2（SQLite数据库）
          console.log('开始分析deck结构...');
          const dbPath = path.join(extractDir, 'collection.anki2');
          
          if (!fs.existsSync(dbPath)) {
            throw new Error('未找到collection.anki2文件');
          }
          
          const db = new sqlite3.Database(dbPath);
          
          // 封装promise函数
          const dbGetAsync = (query, params = []) => {
            return new Promise((resolve, reject) => {
              db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
              });
            });
          };
          
          const dbAllAsync = (query, params = []) => {
            return new Promise((resolve, reject) => {
              db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
              });
            });
          };
          
          console.log('数据库打开成功');
          
          // 获取笔记
          console.log('获取笔记...');
          const notes = await dbAllAsync('SELECT * FROM notes');
          console.log(\`找到 \${notes.length} 条笔记\`);
          
          // 获取模型/模板
          console.log('获取模型/模板...');
          const colData = await dbGetAsync('SELECT * FROM col');
          let parsedModels = [];
          
          if (colData && colData.models) {
            try {
              console.log('解析模型数据...');
              const modelsData = JSON.parse(colData.models);
              parsedModels = Object.values(modelsData);
              console.log(\`找到 \${parsedModels.length} 个模型\`);
              
              // 记录模型名称
              parsedModels.forEach((model, index) => {
                console.log(\`模型 \${index+1}: \${model.name}, 字段数: \${model.flds ? model.flds.length : 0}\`);
              });
            } catch (e) {
              console.error('解析模型数据时出错:', e);
            }
          }
          
          // 处理笔记
          console.log('处理笔记和模板...');
          const cards = [];
          let processedCount = 0;
          
          for (const note of notes) {
            // 提取字段
            const fieldValues = note.flds ? note.flds.split('\\u001f') : [];
            const model = parsedModels.find(m => m.id === note.mid);
            
            if (model && model.flds && fieldValues.length > 0) {
              // 创建字段对象
              const fields = {};
              model.flds.forEach((field, index) => {
                if (index < fieldValues.length) {
                  fields[field.name] = fieldValues[index] || '';
                }
              });
              
              // 处理每个模板
              if (model.tmpls && model.tmpls.length > 0) {
                for (const template of model.tmpls) {
                  cards.push({
                    template: {
                      front: template.qfmt,
                      back: template.afmt,
                      name: template.name
                    },
                    fields: fields,
                    tags: note.tags,
                    noteId: note.id
                  });
                }
              }
              
              processedCount++;
              if (processedCount % 100 === 0) {
                console.log(\`已处理 \${processedCount} 条笔记...\`);
              }
            }
          }
          
          console.log(\`处理完成，共生成 \${cards.length} 张卡片\`);
          
          // 提取媒体文件
          console.log('检查媒体文件...');
          const mediaFilePath = path.join(extractDir, 'media');
          let mediaCount = 0;
          
          if (fs.existsSync(mediaFilePath)) {
            try {
              const mediaContent = fs.readFileSync(mediaFilePath, 'utf8');
              const mediaMap = JSON.parse(mediaContent);
              mediaCount = Object.keys(mediaMap).length;
              console.log(\`找到 \${mediaCount} 个媒体文件\`);
            } catch (e) {
              console.error('读取媒体文件时出错:', e);
            }
          } else {
            console.log('未找到媒体文件');
          }
          
          // 将结果保存为JSON文件
          const resultsPath = path.join(extractDir, 'parsed_results.json');
          console.log(\`保存解析结果到: \${resultsPath}\`);
          
          fs.writeFileSync(resultsPath, JSON.stringify({
            notes: notes.length,
            models: parsedModels.length,
            cards,
            mediaCount,
            parseTime: new Date().toISOString()
          }, null, 2));
          
          // 关闭数据库
          db.close();
          console.log('数据库已关闭');
          
          console.log('解析过程完成!');
        } catch (error) {
          console.error('ES模块执行错误:', error);
          process.exit(1);
        }
      }

      run().catch(err => {
        console.error('运行失败:', err);
        process.exit(1);
      });
    `,
        );

        // 创建一个package.json标记为ES模块
        const packageJsonPath = path.join(tempScriptDir, 'package.json');
        console.log(`创建package.json: ${packageJsonPath}`);

        fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(
                {
                    name: 'apkg-parser-bridge',
                    type: 'module',
                    private: true,
                },
                null,
                2,
            ),
        );

        // 执行ES模块脚本
        console.log('\n=== 开始执行ES模块脚本 ===');

        try {
            // 使用Node.js直接执行ES模块
            execSync(`node --experimental-modules ${tempScriptPath}`, {
                stdio: 'inherit',
                cwd: tempScriptDir,
                env: { ...process.env, NODE_OPTIONS: '--no-warnings' },
            });
            console.log('ES模块脚本执行成功');
        } catch (error) {
            console.error('ES模块脚本执行失败:', error);
            process.exit(1);
        }

        // 检查结果文件
        const resultsPath = path.join(extractDir, 'parsed_results.json');
        if (!fs.existsSync(resultsPath)) {
            console.error(`结果文件未生成: ${resultsPath}`);
            process.exit(1);
        }

        console.log(`解析结果已保存到: ${resultsPath}`);

        // 读取结果摘要
        try {
            const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
            console.log('\n=== 解析结果摘要 ===');
            console.log(`笔记数量: ${results.notes}`);
            console.log(`模型数量: ${results.models}`);
            console.log(`卡片数量: ${results.cards.length}`);
            console.log(`媒体文件: ${results.mediaCount || 0}`);
            console.log(`解析时间: ${results.parseTime || 'unknown'}`);
        } catch (error) {
            console.error('读取结果文件时出错:', error);
        }

        // 清理临时文件
        console.log('\n清理临时文件...');
        fs.rmSync(tempScriptDir, { recursive: true, force: true });

        console.log('处理完成!');
        process.exit(0);
    } catch (error) {
        console.error('桥接脚本错误:', error);
        process.exit(1);
    }
}

// 运行主函数
processApkg();
