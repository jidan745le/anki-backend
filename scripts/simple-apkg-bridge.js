#!/usr/bin/env node

/**
 * 简化版APKG解析桥接脚本 - 修复版
 *
 * 直接使用sqlite3和yauzl库解析APKG文件
 * 不依赖第三方anki-apkg-parser库
 */

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const sqlite3 = require('sqlite3').verbose();

console.log('=== 简化版APKG解析桥接脚本启动 (修复版) ===');
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

        // 解压APKG文件（实际上是zip文件）
        console.log(`开始解压APKG文件到: ${extractDir}`);
        await unzipFile(filePath, extractDir);
        console.log('解压完成');

        // 解析collection.anki2（SQLite数据库）
        console.log('开始分析deck结构...');
        const dbPath = path.join(extractDir, 'collection.anki2');

        if (!fs.existsSync(dbPath)) {
            console.error(`错误: 未找到数据库文件: ${dbPath}`);
            process.exit(1);
        }

        console.log(`打开数据库: ${dbPath}`);
        await parseAnkiDatabase(dbPath, extractDir);

        console.log('处理完成!');
        process.exit(0);
    } catch (error) {
        console.error('处理APKG文件时发生错误:', error);
        process.exit(1);
    }
}

/**
 * 解压ZIP文件
 */
function unzipFile(zipPath, outputDir) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error('打开ZIP文件失败:', err);
                return reject(err);
            }

            console.log(`ZIP文件打开成功，条目数: ${zipfile.entryCount}`);
            let extractedCount = 0;

            zipfile.on('entry', (entry) => {
                extractedCount++;
                console.log(
                    `处理文件 ${extractedCount}/${zipfile.entryCount}: ${entry.fileName}`,
                );

                if (/\/$/.test(entry.fileName)) {
                    // 目录项，创建目录
                    fs.mkdirSync(path.join(outputDir, entry.fileName), {
                        recursive: true,
                    });
                    zipfile.readEntry();
                } else {
                    // 文件项，提取文件
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            console.error(`读取${entry.fileName}失败:`, err);
                            return zipfile.readEntry();
                        }

                        const outputPath = path.join(outputDir, entry.fileName);
                        const outputDirPath = path.dirname(outputPath);

                        if (!fs.existsSync(outputDirPath)) {
                            fs.mkdirSync(outputDirPath, { recursive: true });
                        }

                        const writeStream = fs.createWriteStream(outputPath);

                        writeStream.on('close', () => {
                            zipfile.readEntry();
                        });

                        readStream.pipe(writeStream);
                    });
                }
            });

            zipfile.on('end', () => {
                console.log(`解压完成，共提取 ${extractedCount} 个文件`);
                resolve();
            });

            zipfile.on('error', (err) => {
                console.error('解压过程中出错:', err);
                reject(err);
            });

            zipfile.readEntry();
        });
    });
}

/**
 * 解析Anki SQLite数据库
 */
async function parseAnkiDatabase(dbPath, outputDir) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('打开数据库失败:', err);
                return reject(err);
            }

            console.log('数据库打开成功');

            // 获取集合信息
            db.get('SELECT * FROM col', [], (err, colData) => {
                if (err) {
                    console.error('读取col表失败:', err);
                    db.close();
                    return reject(err);
                }

                // 解析模型数据 - 保持为对象映射，不转为数组
                let modelsMap = {};
                if (colData && colData.models) {
                    try {
                        console.log('解析模型数据...');
                        modelsMap = JSON.parse(colData.models);
                        console.log(`找到 ${Object.keys(modelsMap).length} 个模型`);

                        // 记录模型名称
                        Object.values(modelsMap).forEach((model, index) => {
                            console.log(
                                `模型 ${index + 1}: ${model.name}, ID: ${model.id}, 字段数: ${model.flds ? model.flds.length : 0
                                }`,
                            );
                        });
                    } catch (e) {
                        console.error('解析模型数据时出错:', e);
                    }
                }

                // 获取所有笔记
                db.all('SELECT * FROM notes', [], (err, notes) => {
                    if (err) {
                        console.error('读取notes表失败:', err);
                        db.close();
                        return reject(err);
                    }

                    console.log(`找到 ${notes.length} 条笔记`);

                    // 创建笔记ID到笔记数据的映射
                    const notesMap = {};
                    notes.forEach((note) => {
                        notesMap[note.id] = note;
                    });

                    // 获取所有卡片 - 关键修改，添加cards表查询
                    db.all('SELECT * FROM cards', [], (err, cardsData) => {
                        if (err) {
                            console.error('读取cards表失败:', err);
                            db.close();
                            return reject(err);
                        }

                        console.log(`找到 ${cardsData.length} 张卡片数据`);

                        try {
                            // 处理卡片
                            console.log('处理卡片和模板...');
                            const cards = [];
                            let processedCount = 0;

                            // 尝试确定正确的分隔符
                            const separatorChar = String.fromCharCode(31); // 真实的Anki分隔符是ASCII 31
                            let usedSeparator = separatorChar;

                            // 测试第一个笔记，检查正确的分隔符
                            if (notes.length > 0) {
                                const firstNote = notes[0];
                                if (firstNote.flds) {
                                    // 测试所有可能的分隔符
                                    const possibleSeparators = [
                                        separatorChar,
                                        '\\u001f',
                                        '\u001f',
                                    ];

                                    for (const sep of possibleSeparators) {
                                        if (firstNote.flds.includes(sep)) {
                                            console.log(
                                                `检测到分隔符: ${sep === separatorChar ? 'ASCII 31' : sep
                                                }`,
                                            );
                                            usedSeparator = sep;
                                            break;
                                        }
                                    }
                                }
                            }

                            for (const card of cardsData) {
                                // 查找对应的笔记
                                const note = notesMap[card.nid];

                                if (!note) {
                                    console.warn(
                                        `警告: 找不到卡片 ${card.id} 对应的笔记 ${card.nid}`,
                                    );
                                    continue;
                                }

                                // 将ID转换为字符串以确保类型匹配
                                const modelId = String(note.mid);

                                // 查找对应的模型
                                const model = modelsMap[modelId];
                                if (!model) {
                                    console.warn(
                                        `警告: 找不到笔记 ${note.id} 对应的模型 ${modelId}`,
                                    );
                                    console.log('可用模型ID:', Object.keys(modelsMap).join(', '));
                                    continue;
                                }

                                // 提取字段 (Anki使用特殊分隔符)
                                const fieldValues = note.flds
                                    ? note.flds.split(usedSeparator)
                                    : [];

                                // 创建字段对象
                                const fields = {};
                                if (model.flds && fieldValues.length > 0) {
                                    model.flds.forEach((field, index) => {
                                        if (index < fieldValues.length) {
                                            fields[field.name] = fieldValues[index] || '';
                                        }
                                    });
                                }

                                // 查找对应的模板（基于卡片的ord字段）
                                const template = model.tmpls && model.tmpls[card.ord];

                                if (template) {
                                    cards.push({
                                        template: {
                                            front: template.qfmt,
                                            back: template.afmt,
                                            name: template.name,
                                        },
                                        fields: fields,
                                        tags: note.tags,
                                        noteId: note.id,
                                        cardId: card.id,
                                        // 添加原始卡片数据以便调试
                                        originalCard: {
                                            id: card.id,
                                            nid: card.nid,
                                            did: card.did,
                                            ord: card.ord,
                                            type: card.type,
                                            queue: card.queue,
                                        },
                                    });
                                } else {
                                    console.warn(
                                        `警告: 找不到卡片 ${card.id} 对应的模板(ord=${card.ord})`,
                                    );
                                }

                                processedCount++;
                                if (processedCount % 100 === 0) {
                                    console.log(`已处理 ${processedCount} 张卡片...`);
                                }
                            }

                            console.log(`处理完成，共生成 ${cards.length} 张卡片对象`);

                            // 如果没有找到卡片，打印更多调试信息
                            if (cards.length === 0 && cardsData.length > 0) {
                                console.error('警告: 未能生成任何卡片对象，输出调试信息:');
                                console.error(`笔记数量: ${notes.length}`);
                                console.error(`卡片数量: ${cardsData.length}`);
                                console.error(`模型数量: ${Object.keys(modelsMap).length}`);

                                // 尝试一种备用方法 - 直接从笔记生成卡片
                                console.log('尝试备用卡片生成方法...');

                                const backupCards = [];
                                for (const note of notes) {
                                    const modelId = String(note.mid);
                                    const model = modelsMap[modelId];

                                    if (model && model.tmpls) {
                                        const fieldValues = note.flds
                                            ? note.flds.split(usedSeparator)
                                            : [];
                                        const fields = {};

                                        if (model.flds && fieldValues.length > 0) {
                                            model.flds.forEach((field, index) => {
                                                if (index < fieldValues.length) {
                                                    fields[field.name] = fieldValues[index] || '';
                                                }
                                            });

                                            // 为每个模板创建一个卡片
                                            model.tmpls.forEach((template) => {
                                                backupCards.push({
                                                    template: {
                                                        front: template.qfmt,
                                                        back: template.afmt,
                                                        name: template.name,
                                                    },
                                                    fields: fields,
                                                    tags: note.tags,
                                                    noteId: note.id,
                                                });
                                            });
                                        }
                                    }
                                }

                                if (backupCards.length > 0) {
                                    console.log(`备用方法生成了 ${backupCards.length} 张卡片`);
                                    cards.push(...backupCards);
                                }
                            }

                            // 提取媒体文件
                            console.log('检查媒体文件...');
                            const mediaFilePath = path.join(outputDir, 'media');
                            let mediaCount = 0;

                            if (fs.existsSync(mediaFilePath)) {
                                try {
                                    const mediaContent = fs.readFileSync(mediaFilePath, 'utf8');
                                    const mediaMap = JSON.parse(mediaContent);
                                    mediaCount = Object.keys(mediaMap).length;
                                    console.log(`找到 ${mediaCount} 个媒体文件`);
                                } catch (e) {
                                    console.error('读取媒体文件时出错:', e);
                                }
                            } else {
                                console.log('未找到媒体文件');
                            }

                            // 将结果保存为JSON文件
                            const resultsPath = path.join(outputDir, 'parsed_results.json');
                            console.log(`保存解析结果到: ${resultsPath}`);

                            fs.writeFileSync(
                                resultsPath,
                                JSON.stringify(
                                    {
                                        notes: notes.length,
                                        models: Object.keys(modelsMap).length,
                                        cards,
                                        mediaCount,
                                        parseTime: new Date().toISOString(),
                                    },
                                    null,
                                    2,
                                ),
                            );

                            console.log('解析结果已保存');
                            db.close();
                            resolve();
                        } catch (error) {
                            console.error('处理数据时出错:', error);
                            db.close();
                            reject(error);
                        }
                    });
                });
            });
        });
    });
}

// 运行主函数
processApkg();
