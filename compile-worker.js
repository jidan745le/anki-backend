const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// 获取 embedding-worker.ts 文件路径
const workerTsPath = path.resolve(
    __dirname,
    'src/embedding/embedding-worker.ts',
);
const workerJsPath = path.resolve(
    __dirname,
    'dist/embedding/embedding-worker.js',
);

// 确保目标目录存在
const targetDir = path.dirname(workerJsPath);
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

// 编译命令
const cmd = `npx tsc ${workerTsPath} --outDir ${path.dirname(
    workerJsPath,
)} --target ES2019 --module commonjs --esModuleInterop true`;

console.log('Compiling worker script...');
console.log(cmd);

// 执行编译
exec(cmd, (error, stdout, stderr) => {
    if (error) {
        console.error(`Error compiling worker: ${error.message}`);
        console.error(stderr);
        process.exit(1);
    }

    if (stdout) {
        console.log(stdout);
    }

    console.log(`Worker compiled successfully to ${workerJsPath}`);

    // 添加特殊处理 - 有时需要修正一些导入路径等问题
    let content = fs.readFileSync(workerJsPath, 'utf8');

    // 例如，修复一些路径问题
    content = content.replace(
        /require\(['"]langchain\/document['"]\)/g,
        "require('@langchain/core/documents')",
    );

    fs.writeFileSync(workerJsPath, content, 'utf8');
    console.log('Worker file post-processed');
});
