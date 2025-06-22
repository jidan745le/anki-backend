# Update User Card API

## 接口概览

更新用户卡片信息，支持更新自定义背面内容和用户标签。

**接口地址**: `POST /anki/updateCard`  
**权限要求**: 需要登录  

## 请求参数

### Body参数 (JSON)

```json
{
  "id": "string", // 必填 - 用户卡片UUID
  "custom_back": "string", // 可选 - 用户自定义背面内容
  "tags": "string" // 可选 - 用户自定义标签
}
```

### 参数说明

- `id` (string, required): 用户卡片的UUID，用于标识要更新的卡片
- `custom_back` (string, optional): 用户自定义的背面内容，可以覆盖原始卡片的背面内容
- `tags` (string, optional): 用户自定义标签，多个标签可以用逗号分隔

## 请求示例

### 1. 只更新自定义背面内容
```http
POST /anki/updateCard
Content-Type: application/json
Authorization: Bearer your-jwt-token

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "custom_back": "这是我的自定义解释和记忆方法"
}
```

### 2. 只更新标签
```http
POST /anki/updateCard
Content-Type: application/json
Authorization: Bearer your-jwt-token

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tags": "重要,困难,复习"
}
```

### 3. 同时更新背面内容和标签
```http
POST /anki/updateCard
Content-Type: application/json
Authorization: Bearer your-jwt-token

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "custom_back": "详细的解释和例句",
  "tags": "语法,动词,高频"
}
```

### 4. 清空某个字段（传入空字符串）
```http
POST /anki/updateCard
Content-Type: application/json
Authorization: Bearer your-jwt-token

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "custom_back": "",
  "tags": ""
}
```

## 响应格式

### 成功响应 (200)
```json
{
  "id": 123,
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "front": "Hello",
  "customBack": "这是我的自定义解释和记忆方法",
  "tags": "重要,困难,复习",
  "dueDate": "2024-01-15T10:30:00.000Z",
  "stability": 5.2,
  "difficulty": 0.3,
  "elapsedDays": 0,
  "scheduledDays": 3,
  "learningSteps": 1,
  "reps": 10,
  "lapses": 2,
  "state": 2,
  "lastReviewDate": "2024-01-12T14:20:00.000Z",
  "previousState": null,
  "suspendedAt": null,
  "createdAt": "2024-01-01T08:00:00.000Z",
  "updatedAt": "2024-01-15T09:25:00.000Z",
  "user": {
    "id": 1
  },
  "card": {
    "id": 456,
    "uuid": "660e8400-e29b-41d4-a716-446655440001",
    "front": "Hello",
    "back": "你好",
    "tags": "greeting,basic"
  },
  "deck": {
    "id": 789,
    "name": "English Vocabulary"
  }
}
```

## 错误响应

### 400 Bad Request
参数验证失败：
```json
{
  "statusCode": 400,
  "message": [
    "id must be a string"
  ],
  "error": "Bad Request"
}
```

### 401 Unauthorized
未登录：
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 404 Not Found
卡片不存在：
```json
{
  "statusCode": 404,
  "message": "Card with ID 550e8400-e29b-41d4-a716-446655440000 not found"
}
```

## 功能特性

### 1. 灵活更新
- 可以单独更新任意一个字段
- 可以同时更新多个字段
- 不传的字段保持不变

### 2. 数据安全
- 只能更新属于当前用户的卡片
- UUID验证确保数据安全

### 3. 标签管理
- 用户标签与原始卡片标签分开存储
- 用户标签优先级更高
- 支持标签的增删改

### 4. 自定义内容
- 用户可以添加自己的理解和记忆方法
- 不影响原始卡片数据
- 支持富文本内容

## 使用建议

### 1. 标签格式
建议使用逗号分隔多个标签：
```
"重要,困难,语法,动词"
```

### 2. 自定义背面内容
可以包含：
- 个人理解和解释
- 记忆技巧
- 例句和用法
- 关联知识点

### 3. 批量操作
如需批量更新多张卡片，建议：
- 分批次处理，避免一次性更新过多
- 添加适当的错误处理
- 考虑使用队列处理大量数据

### 4. 数据备份
重要的自定义内容建议：
- 定期导出备份
- 记录重要修改日志
- 保留版本历史

## 与查询接口的配合

更新后的卡片可以通过查询接口检索：
- 使用 `tags` 参数搜索用户自定义标签
- 使用 `back` 参数搜索自定义背面内容
- 查询结果会区分用户标签和原始标签

参考: [User Cards Query API](./user-cards-query-api.md) 