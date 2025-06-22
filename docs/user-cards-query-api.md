# User Cards Query API

## 接口概览

用户卡片查询分页接口，支持多种筛选条件和排序选项。

**接口地址**: `GET /anki/user-cards/query`  
**权限要求**: 需要登录  

## 请求参数

### 分页参数
- `page` (number, optional): 页码，默认为 1，最小值为 1
- `limit` (number, optional): 每页数量，默认为 20，范围 1-100

### 排序参数
- `sortBy` (string, optional): 排序字段，默认为 'createdAt'
  - 可选值: `createdAt`, `updatedAt`, `dueDate`, `lastReviewDate`, `reps`, `difficulty`, `stability`
- `sortOrder` (string, optional): 排序方向，默认为 'DESC'
  - 可选值: `ASC`, `DESC`

### 筛选参数

#### 牌组相关
- `deckId` (number, optional): 指定牌组ID
- `deckName` (string, optional): 牌组名称模糊查询
- `deckType` (string, optional): 牌组类型精确匹配

#### 卡片内容
- `front` (string, optional): 卡片正面内容模糊查询
- `back` (string, optional): 卡片背面内容模糊查询（会同时搜索原始卡片back和用户自定义customBack）
- `tags` (string, optional): 标签模糊查询（会同时搜索原始卡片tags和用户自定义tags）

#### 卡片状态
- `state` (number, optional): 卡片状态
  - `0`: 新卡片 (NEW)
  - `1`: 学习中 (LEARNING)
  - `2`: 复习中 (REVIEW)
  - `3`: 重新学习 (RELEARNING)
  - `4`: 暂停学习 (SUSPENDED)
- `isSuspended` (boolean, optional): 是否暂停状态
- `isOverdue` (boolean, optional): 是否过期

#### 日期范围
- `dueDateFrom` (string, optional): 到期日期开始时间 (ISO格式)
- `dueDateTo` (string, optional): 到期日期结束时间 (ISO格式)
- `lastReviewDateFrom` (string, optional): 最后复习日期开始时间 (ISO格式)
- `lastReviewDateTo` (string, optional): 最后复习日期结束时间 (ISO格式)

#### 学习统计范围
- `repsMin` (number, optional): 最小复习次数
- `repsMax` (number, optional): 最大复习次数
- `lapsesMin` (number, optional): 最小失误次数
- `lapsesMax` (number, optional): 最大失误次数

#### FSRS参数范围
- `difficultyMin` (number, optional): 最小难度值 (0-1)
- `difficultyMax` (number, optional): 最大难度值 (0-1)
- `stabilityMin` (number, optional): 最小稳定性值
- `stabilityMax` (number, optional): 最大稳定性值

## 请求示例

### 基础查询
```http
GET /anki/user-cards/query?page=1&limit=20
```

### 按牌组查询
```http
GET /anki/user-cards/query?deckId=123&page=1&limit=10
```

### 内容模糊查询
```http
GET /anki/user-cards/query?front=hello&back=world&page=1
```

### 状态筛选
```http
GET /anki/user-cards/query?state=2&isOverdue=true&page=1
```

### 复合查询
```http
GET /anki/user-cards/query?deckName=English&state=1&repsMin=5&sortBy=dueDate&sortOrder=ASC&page=1&limit=50
```

### 日期范围查询
```http
GET /anki/user-cards/query?dueDateFrom=2024-01-01T00:00:00.000Z&dueDateTo=2024-12-31T23:59:59.999Z&page=1
```

## 响应格式

```json
{
  "data": [
    {
      "id": 1,
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "front": "Hello",
      "customBack": "用户自定义背面内容",
      "back": "原始卡片背面内容",
      "tags": "vocabulary,greeting,user-tag",
      "userTags": "user-tag",
      "originalTags": "vocabulary,greeting",
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
      "updatedAt": "2024-01-12T14:20:00.000Z",
      "deck": {
        "id": 123,
        "name": "English Vocabulary",
        "description": "Basic English words",
        "deckType": "TEXT",
        "isShared": false
      },
      "card": {
        "id": 456,
        "uuid": "660e8400-e29b-41d4-a716-446655440001",
        "back": "原始卡片背面内容",
        "tags": "vocabulary,greeting",
        "frontType": "text"
      }
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20,
  "totalPages": 8,
  "hasNext": true,
  "hasPrev": false
}
```

## 响应字段说明

### 根级字段
- `data`: 卡片数据数组
- `total`: 总记录数
- `page`: 当前页码
- `limit`: 每页记录数
- `totalPages`: 总页数
- `hasNext`: 是否有下一页
- `hasPrev`: 是否有上一页

### 卡片数据字段
- `id`: 用户卡片ID
- `uuid`: 用户卡片唯一标识
- `front`: 卡片正面内容
- `customBack`: 用户自定义背面内容（可为空）
- `back`: 原始卡片背面内容（来自card表）
- `tags`: 合并的标签（优先使用用户自定义标签）
- `userTags`: 用户自定义标签（可为空）
- `originalTags`: 原始卡片标签（可为空）
- `dueDate`: 到期时间
- `stability`: FSRS稳定性参数
- `difficulty`: FSRS难度参数
- `elapsedDays`: 已过天数
- `scheduledDays`: 计划天数
- `learningSteps`: 学习步骤
- `reps`: 复习次数
- `lapses`: 失误次数
- `state`: 卡片状态
- `lastReviewDate`: 最后复习时间
- `previousState`: 暂停前状态（仅暂停卡片有值）
- `suspendedAt`: 暂停时间（仅暂停卡片有值）
- `createdAt`: 创建时间
- `updatedAt`: 更新时间

### 牌组信息 (deck)
- `id`: 牌组ID
- `name`: 牌组名称
- `description`: 牌组描述
- `deckType`: 牌组类型
- `isShared`: 是否共享

### 原始卡片信息 (card, 可选)
- `id`: 原始卡片ID
- `uuid`: 原始卡片UUID
- `back`: 原始背面内容
- `tags`: 原始标签
- `frontType`: 正面内容类型

## 错误响应

### 400 Bad Request
参数验证失败时返回：
```json
{
  "statusCode": 400,
  "message": ["page must be a positive number"],
  "error": "Bad Request"
}
```

### 401 Unauthorized
未登录时返回：
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 500 Internal Server Error
服务器内部错误：
```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

## 使用建议

1. **分页处理**: 建议使用合理的limit值（如20-50），避免一次查询过多数据
2. **索引优化**: 常用的筛选字段（如deckId、state、dueDate）已建立索引
3. **日期格式**: 日期参数请使用ISO 8601格式
4. **模糊查询**: front、back、tags等字段支持模糊查询，会自动添加通配符
5. **排序性能**: 建议使用已索引的字段进行排序以获得更好性能

## 常用查询场景

### 1. 查看今日到期卡片
```http
GET /anki/user-cards/query?dueDateTo=2024-01-15T23:59:59.999Z&sortBy=dueDate&sortOrder=ASC
```

### 2. 查看学习困难的卡片
```http
GET /anki/user-cards/query?lapsesMin=3&difficultyMin=0.6&sortBy=difficulty&sortOrder=DESC
```

### 3. 搜索特定内容
```http
GET /anki/user-cards/query?front=apple&tags=fruit
```

### 4. 查看暂停的卡片
```http
GET /anki/user-cards/query?isSuspended=true&sortBy=suspendedAt&sortOrder=DESC
``` 