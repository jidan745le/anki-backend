import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// 添加全局垃圾回收类型声明
declare global {
  interface NodeJS {
    global: {
      gc?: () => void;
    };
  }
}

async function bootstrap() {
  // 启用垃圾回收（需要使用 --expose-gc 启动参数）
  if (process.execArgv.includes('--expose-gc')) {
    console.log('手动垃圾回收功能已启用');
  } else {
    console.warn(
      '未启用手动垃圾回收。建议使用 --expose-gc 启动参数以优化大型APKG导入',
    );
  }

  const app = await NestFactory.create(AppModule);

  // 配置 CORS 跨域
  app.enableCors({
    origin: [
      /^https:\/\/.*\.myanki\.com$/, // 允许所有 *.myanki.com 子域名
      'https://myanki.com', // 允许主域名
      'http://localhost:3000', // 开发环境
      'http://localhost:3001', // 开发环境
      'http://127.0.0.1:3000', // 开发环境
      'http://127.0.0.1:3001', // 开发环境
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Cache-Control',
      'X-File-Name',
    ],
    credentials: true, // 允许发送 cookies
    optionsSuccessStatus: 200, // 某些旧版浏览器对 204 的处理有问题
  });
  const config = new DocumentBuilder()
    .setTitle('Test example')
    .setDescription('The API description')
    .setVersion('1.0')
    .addTag('test')
    .addBasicAuth({
      type: 'http',
      name: 'basic',
      description: '用户名 + 密码',
    })
    .addCookieAuth('session-id', {
      type: 'apiKey',
      name: 'cookie',
      description: '基于 cookie 的认证',
    })
    .addBearerAuth({
      type: 'http',
      description: '基于 jwt 的认证',
      name: 'bearer',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('doc', app, document);
  await app.listen(3000);
}
bootstrap();
