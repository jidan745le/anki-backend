const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// 定义要编译的worker文件
const workers = [
    {
        name: 'embedding-worker',
        sourcePath: path.resolve(__dirname, 'src/embedding/embedding-worker.ts'),
        targetPath: path.resolve(__dirname, 'dist/embedding/embedding-worker.js'),
    },
    {
        name: 'bailian-embedding-worker',
        sourcePath: path.resolve(
            __dirname,
            'src/embedding/bailian-embedding-worker.ts',
        ),
        targetPath: path.resolve(
            __dirname,
            'dist/embedding/bailian-embedding-worker.js',
        ),
    },
];

function compileWorker(worker) {
    return new Promise((resolve, reject) => {
        const { name, sourcePath, targetPath } = worker;

        // 确保目标目录存在
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 编译命令
        const cmd = `npx tsc ${sourcePath} --outDir ${targetDir} --target ES2019 --module commonjs --esModuleInterop true`;

        console.log(`Compiling ${name}...`);
        console.log(cmd);

        // 执行编译
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error compiling ${name}: ${error.message}`);
                console.error(stderr);
                reject(error);
                return;
            }

            if (stdout) {
                console.log(stdout);
            }

            console.log(`${name} compiled successfully to ${targetPath}`);

            // 添加特殊处理 - 有时需要修正一些导入路径等问题
            if (fs.existsSync(targetPath)) {
                let content = fs.readFileSync(targetPath, 'utf8');

                // 例如，修复一些路径问题
                content = content.replace(
                    /require\(['"]langchain\/document['"]\)/g,
                    "require('@langchain/core/documents')",
                );

                fs.writeFileSync(targetPath, content, 'utf8');
                console.log(`${name} file post-processed`);
            }

            resolve();
        });
    });
}

// 编译所有worker文件
async function compileAllWorkers() {
    try {
        for (const worker of workers) {
            await compileWorker(worker);
        }
        console.log('All workers compiled successfully!');
    } catch (error) {
        console.error('Failed to compile workers:', error);
        process.exit(1);
    }
}

compileAllWorkers();
