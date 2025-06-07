/**
 * 增强的应用启动脚本
 * - 增加内存限制，防止大型APKG导入时内存不足
 * - 启用手动垃圾回收，优化内存使用
 */
const { spawn } = require('child_process');
const path = require('path');

console.log('启动NestJS应用，增强内存配置...');

// 启动nest应用，使用增强参数
const args = [
    // 增加内存限制到4GB
    '--max-old-space-size=4096',
    // 启用手动垃圾回收
    '--expose-gc',
    // 其他可能需要的参数
    // '--optimize-for-size',
    'dist/src/main.js',
];

// 在开发模式下，使用不同的启动方式
const isDevMode = process.env.NODE_ENV === 'development';

if (isDevMode) {
    console.log('以开发模式启动...');
    // 启动开发模式
    const nestProcess = spawn(
        'nest',
        ['start', '--watch', ...args.filter((arg) => !arg.includes('dist/'))],
        {
            stdio: 'inherit',
            shell: true,
        },
    );
} else {
    console.log('以生产模式启动...');
    // 启动生产构建
    const nodeProcess = spawn('node', args, {
        stdio: 'inherit',
    });

    nodeProcess.on('close', (code) => {
        console.log(`Node进程退出，代码: ${code}`);
    });
}

console.log('应用启动中，请稍候...');
