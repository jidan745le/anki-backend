/**
 * APKG解析器测试脚本
 * 用法: node scripts/test-parse.js <APKG文件路径>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 获取命令行参数
const apkgFile = process.argv[2];

if (!apkgFile) {
    console.error('错误: 请提供APKG文件路径');
    console.error('用法: node scripts/test-parse.js <APKG文件路径>');
    process.exit(1);
}

if (!fs.existsSync(apkgFile)) {
    console.error(`错误: 文件不存在: ${apkgFile}`);
    process.exit(1);
}

// 创建临时输出目录
const outputDir = path.join(process.cwd(), 'temp-test-output');
if (fs.existsSync(outputDir)) {
    console.log(`删除已存在的输出目录: ${outputDir}`);
    fs.rmSync(outputDir, { recursive: true, force: true });
}

fs.mkdirSync(outputDir, { recursive: true });
console.log(`创建输出目录: ${outputDir}`);

// 测试原始脚本
console.log('\n=== 测试原始脚本 ===');
try {
    const origOutputDir = path.join(outputDir, 'original');
    fs.mkdirSync(origOutputDir, { recursive: true });

    console.log(`执行原始脚本处理: ${apkgFile}`);
    execSync(
        `node --max-old-space-size=4096 ${path.join(
            process.cwd(),
            'scripts',
            'simple-apkg-bridge.js.bak',
        )} "${apkgFile}" "${origOutputDir}"`,
        {
            stdio: 'inherit',
        },
    );

    // 读取结果
    const origResultsPath = path.join(origOutputDir, 'parsed_results.json');
    if (fs.existsSync(origResultsPath)) {
        const origResults = JSON.parse(fs.readFileSync(origResultsPath, 'utf8'));
        console.log(`原始脚本结果: ${origResults.cards.length} 张卡片`);
    } else {
        console.log('原始脚本未生成结果文件');
    }
} catch (error) {
    console.error('原始脚本执行失败:', error.message);
}

// 测试修复后的脚本
console.log('\n=== 测试修复脚本 ===');
try {
    const fixedOutputDir = path.join(outputDir, 'fixed');
    fs.mkdirSync(fixedOutputDir, { recursive: true });

    console.log(`执行修复脚本处理: ${apkgFile}`);
    execSync(
        `node --max-old-space-size=4096 ${path.join(
            process.cwd(),
            'scripts',
            'simple-apkg-bridge.js',
        )} "${apkgFile}" "${fixedOutputDir}"`,
        {
            stdio: 'inherit',
        },
    );

    // 读取结果
    const fixedResultsPath = path.join(fixedOutputDir, 'parsed_results.json');
    if (fs.existsSync(fixedResultsPath)) {
        const fixedResults = JSON.parse(fs.readFileSync(fixedResultsPath, 'utf8'));
        console.log(`修复脚本结果: ${fixedResults.cards.length} 张卡片`);
    } else {
        console.log('修复脚本未生成结果文件');
    }
} catch (error) {
    console.error('修复脚本执行失败:', error.message);
}

console.log('\n比较完成，请检查输出目录中的结果');
console.log(`输出目录: ${outputDir}`);
