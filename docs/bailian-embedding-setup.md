# 百炼Embedding服务集成说明

本项目已经集成了阿里云百炼embedding服务，用于替代原有的本地HuggingFace模型，以提高性能和稳定性。

## 配置说明

### 1. 环境变量配置

在你的 `.env` 文件中添加以下配置：

```bash
# 百炼(阿里云)配置
DASHSCOPE_API_KEY=your_dashscope_api_key_here
```

### 2. 获取API密钥

1. 访问[阿里云百炼平台](https://dashscope.aliyun.com/)
2. 注册并登录账号
3. 创建API密钥
4. 将密钥配置到环境变量中

## 功能特性

### 1. 高性能向量化
- 使用百炼 `text-embedding-v4` 模型
- 支持1024维向量（默认）
- 支持多语言文本处理

### 2. 批量处理
- 自动分批处理大量文档
- 内置限流保护
- 支持异步处理

### 3. 向量数据库集成
- 与Chroma向量数据库无缝集成
- 保持原有数据结构
- 支持相似度搜索

## API使用

### 同步调用示例

```typescript
import { BailianEmbeddingService } from './bailian-embedding.service';

const bailianService = new BailianEmbeddingService(configService);

// 单个文本向量化
const vectors = await bailianService.embedTexts(['你好世界']);

// 批量文本向量化
const batchVectors = await bailianService.embedTextsBatch([
  '第一段文本',
  '第二段文本',
  '第三段文本'
]);
```

### 异步批处理示例

```typescript
// 创建批处理任务
const task = await bailianService.createBatchEmbeddingTask(
  'https://example.com/your-text-file.txt'
);

// 查询任务状态
const status = await bailianService.getBatchTaskStatus(task.output.task_id);

// 下载结果（任务完成后）
if (status.output.task_status === 'SUCCEEDED') {
  const results = await bailianService.downloadBatchResults(status.output.url);
}
```

## 性能优化

### 1. 批次大小调优
- 默认批次大小：10（百炼API限制）
- 可根据需要调整延迟时间
- 建议生产环境使用1-2秒延迟

### 2. 错误处理
- 自动重试机制
- 详细错误日志
- 优雅降级处理

### 3. 成本控制
- 免费额度：100万Token（180天有效）
- 单价：0.0005元/千Token
- 限流：30 RPS，1,200,000 TPM

## 兼容性说明

### 1. 向量维度
- 百炼服务：1024维（默认）
- 原HuggingFace模型：768维
- **注意**：更换服务后需要重新构建向量库

### 2. 数据迁移
```bash
# 清空现有向量库（如果需要）
npm run migration:run

# 重新构建向量库
# 通过API接口 POST /embedding/:deckId 触发
```

## 故障排除

### 1. API密钥错误
```
Error: DASHSCOPE_API_KEY is required for Bailian embedding service
```
**解决方案**：检查环境变量配置

### 2. 限流错误
```
Error: Rate limit exceeded
```
**解决方案**：增加批次间延迟时间或减小批次大小

### 3. 网络超时
```
Error: timeout of 30000ms exceeded
```
**解决方案**：检查网络连接或增加超时时间

## 监控和日志

系统会记录详细的操作日志：
- embedding请求数量
- Token消费统计
- 错误率统计
- 性能指标

查看日志：
```bash
# 开发环境
npm run start:dev

# 生产环境
pm2 logs your-app-name
```

## 最佳实践

1. **预处理文本**：清理无关字符和格式
2. **合理分批**：避免单次请求过大
3. **监控用量**：定期检查Token消费
4. **备份策略**：定期备份向量数据
5. **性能测试**：上线前进行充分测试

## 技术支持

如有问题，请参考：
1. [百炼官方文档](https://help.aliyun.com/zh/dashscope/)
2. 项目GitHub Issues
3. 内部技术支持渠道 