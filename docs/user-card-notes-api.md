# 用户卡片笔记功能 API 文档

## 概述
这个功能允许用户为每个用户卡片(UserCard)创建、编辑和查看笔记。笔记与用户卡片关联，用于记录学习过程中的重要信息。

## 数据库表结构

### `notes` 表
- `id` (int, 主键) - 笔记ID
- `uuid` (varchar 36, 唯一) - 笔记UUID
- `title` (varchar 255) - 笔记标题
- `noteContent` (text) - 笔记内容
- `referenceText` (text, 可选) - 引用文本，用于记录引用的原文或相关内容
- `color` (varchar 50, 可选) - 笔记颜色/标签
- `isPinned` (boolean, 默认false) - 是否置顶
- `user_card_id` (int, 外键) - 关联的用户卡片ID
- `user_id` (int, 外键) - 关联的用户ID
- `createdAt` (timestamp) - 创建时间
- `updatedAt` (timestamp) - 更新时间
- `deletedAt` (timestamp, 可选) - 软删除时间

### 外键约束
- `user_card_id` → `user_cards.id` (CASCADE)
- `user_id` → `users.id` (CASCADE)

## API 接口

### 创建笔记
```http
POST /notes
Content-Type: application/json
Authorization: Bearer {token}

{
  "title": "笔记标题",
  "noteContent": "笔记内容",
  "referenceText": "引用的原文内容", // 可选
  "userCardUuid": "用户卡片UUID",
  "color": "blue", // 可选
  "isPinned": false // 可选
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "笔记标题",
    "noteContent": "笔记内容",
    "referenceText": "引用的原文内容",
    "color": "blue",
    "isPinned": false,
    "userCard": {
      "id": 123,
      "uuid": "user-card-uuid-456",
      "front": "卡片正面内容",
      "deck": {
        "id": 1,
        "name": "牌组名称",
        "description": "牌组描述"
      }
    },
    "createdAt": "2023-12-15T10:30:00.000Z",
    "updatedAt": "2023-12-15T10:30:00.000Z"
  },
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 批量写笔记（创建和更新）
```http
POST /notes/batch
Content-Type: application/json
Authorization: Bearer {token}

{
  "notes": [
    {
      // 创建新笔记（没有id字段）
      "title": "新笔记1",
      "noteContent": "新笔记内容1",
      "referenceText": "引用文本1",
      "userCardUuid": "user-card-uuid-123",
      "color": "red",
      "isPinned": true
    },
    {
      // 更新现有笔记（有id或uuid字段）
      "id": 5,
      "title": "更新的笔记",
      "noteContent": "更新的内容",
      "referenceText": "更新的引用",
      "userCardUuid": "user-card-uuid-456",
      "color": "green",
      "isPinned": false
    },
    {
      // 通过UUID更新笔记
      "uuid": "existing-note-uuid-789",
      "title": "通过UUID更新",
      "noteContent": "新内容",
      "userCardUuid": "user-card-uuid-789"
    }
  ]
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "created": [
      {
        "id": 10,
        "uuid": "new-note-uuid-001",
        "title": "新笔记1",
        "noteContent": "新笔记内容1",
        "referenceText": "引用文本1",
        "color": "red",
        "isPinned": true,
        "userCard": {
          "id": 123,
          "uuid": "user-card-uuid-123",
          "front": "卡片内容"
        },
        "createdAt": "2023-12-15T10:30:00.000Z",
        "updatedAt": "2023-12-15T10:30:00.000Z"
      }
    ],
    "updated": [
      {
        "id": 5,
        "uuid": "existing-note-uuid-456",
        "title": "更新的笔记",
        "noteContent": "更新的内容",
        "referenceText": "更新的引用",
        "color": "green",
        "isPinned": false,
        "userCard": {
          "id": 124,
          "uuid": "user-card-uuid-456",
          "front": "另一个卡片"
        },
        "createdAt": "2023-12-15T09:00:00.000Z",
        "updatedAt": "2023-12-15T10:30:00.000Z"
      }
    ],
    "errors": [
      {
        "index": 1,
        "error": "User card not found"
      }
    ]
  },
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 获取笔记列表
```http
GET /notes?page=1&limit=20&userCardUuid={uuid}&title={title}&color={color}&isPinned=true
Authorization: Bearer {token}
```

查询参数:
- `page` (可选) - 页码，默认1
- `limit` (可选) - 每页数量，默认20
- `userCardUuid` (可选) - 按用户卡片UUID筛选
- `title` (可选) - 标题模糊搜索
- `color` (可选) - 按颜色筛选
- `isPinned` (可选) - 按置顶状态筛选
- `sortBy` (可选) - 排序字段，默认createdAt
- `sortOrder` (可选) - 排序方向，ASC或DESC，默认DESC

**响应示例：**
```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": 1,
        "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "title": "重要语法点",
        "noteContent": "这个语法点需要重点记忆...",
        "referenceText": "原文：Grammar is the foundation of language...",
        "color": "yellow",
        "isPinned": true,
        "userCard": {
          "id": 123,
          "uuid": "user-card-uuid-456",
          "front": "Hello World",
          "deck": {
            "id": 1,
            "name": "英语单词",
            "description": "基础英语词汇"
          }
        },
        "createdAt": "2023-12-15T10:30:00.000Z",
        "updatedAt": "2023-12-15T10:30:00.000Z"
      },
      {
        "id": 2,
        "uuid": "550e8400-e29b-41d4-a716-446655440000",
        "title": "学习笔记",
        "noteContent": "今天学到的新单词用法...",
        "referenceText": null,
        "color": "blue",
        "isPinned": false,
        "userCard": {
          "id": 124,
          "uuid": "user-card-uuid-789",
          "front": "Goodbye",
          "deck": {
            "id": 1,
            "name": "英语单词",
            "description": "基础英语词汇"
          }
        },
        "createdAt": "2023-12-15T09:15:00.000Z",
        "updatedAt": "2023-12-15T09:15:00.000Z"
      }
    ],
    "total": 25,
    "page": 1,
    "limit": 20,
    "totalPages": 2
  },
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 获取指定用户卡片的所有笔记
```http
GET /notes/user-card/{userCardUuid}
Authorization: Bearer {token}
```

**响应示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "title": "词汇记忆法",
      "noteContent": "使用联想记忆法来记住这个单词...",
      "referenceText": "词典释义：A method of learning...",
      "color": "green",
      "isPinned": true,
      "createdAt": "2023-12-15T10:30:00.000Z",
      "updatedAt": "2023-12-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "title": "语法要点",
      "noteContent": "注意时态的使用...",
      "referenceText": null,
      "color": "red",
      "isPinned": false,
      "createdAt": "2023-12-15T09:15:00.000Z",
      "updatedAt": "2023-12-15T09:15:00.000Z"
    }
  ],
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 获取单个笔记
```http
GET /notes/{id}
Authorization: Bearer {token}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "重要笔记",
    "noteContent": "这是详细的笔记内容...",
    "referenceText": "引用文本：This is the original content that inspired this note...",
    "color": "purple",
    "isPinned": true,
    "userCard": {
      "id": 123,
      "uuid": "user-card-uuid-456",
      "front": "卡片正面",
      "deck": {
        "id": 1,
        "name": "牌组名称",
        "description": "牌组描述"
      }
    },
    "createdAt": "2023-12-15T10:30:00.000Z",
    "updatedAt": "2023-12-15T10:30:00.000Z"
  },
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 通过UUID获取笔记
```http
GET /notes/uuid/{uuid}
Authorization: Bearer {token}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "UUID查询的笔记",
    "noteContent": "通过UUID查询到的笔记内容...",
    "referenceText": "相关引用内容...",
    "color": "orange",
    "isPinned": false,
    "userCard": {
      "id": 123,
      "uuid": "user-card-uuid-456",
      "front": "卡片内容",
      "deck": {
        "id": 1,
        "name": "牌组名称",
        "description": "牌组描述"
      }
    },
    "createdAt": "2023-12-15T10:30:00.000Z",
    "updatedAt": "2023-12-15T10:30:00.000Z"
  },
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 更新笔记
```http
PATCH /notes/{id}
Content-Type: application/json
Authorization: Bearer {token}

{
  "title": "更新的标题", // 可选
  "noteContent": "更新的内容", // 可选
  "referenceText": "更新的引用文本", // 可选
  "color": "red", // 可选
  "isPinned": true // 可选
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "更新的标题",
    "noteContent": "更新的内容",
    "referenceText": "更新的引用文本",
    "color": "red",
    "isPinned": true,
    "userCard": {
      "id": 123,
      "uuid": "user-card-uuid-456",
      "front": "卡片正面",
      "deck": {
        "id": 1,
        "name": "牌组名称",
        "description": "牌组描述"
      }
    },
    "createdAt": "2023-12-15T10:30:00.000Z",
    "updatedAt": "2023-12-15T11:45:00.000Z"
  },
  "code": 200,
  "timestamp": "2023-12-15T11:45:00.000Z"
}
```

### 切换置顶状态
```http
PATCH /notes/{id}/toggle-pin
Authorization: Bearer {token}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "笔记标题",
    "noteContent": "笔记内容",
    "referenceText": "引用文本",
    "color": "blue",
    "isPinned": true,
    "userCard": {
      "id": 123,
      "uuid": "user-card-uuid-456",
      "front": "卡片正面",
      "deck": {
        "id": 1,
        "name": "牌组名称",
        "description": "牌组描述"
      }
    },
    "createdAt": "2023-12-15T10:30:00.000Z",
    "updatedAt": "2023-12-15T12:00:00.000Z"
  },
  "code": 200,
  "timestamp": "2023-12-15T12:00:00.000Z"
}
```

### 删除笔记
```http
DELETE /notes/{id}
Authorization: Bearer {token}
```

**响应示例：**
```json
{
  "success": true,
  "data": null,
  "code": 200,
  "timestamp": "2023-12-15T12:15:00.000Z"
}
```

## 错误响应格式

### 验证错误
```json
{
  "success": false,
  "message": "Validation failed",
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 资源未找到
```json
{
  "success": false,
  "message": "Note not found",
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 用户卡片不存在
```json
{
  "success": false,
  "message": "User card not found",
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

### 权限不足
```json
{
  "success": false,
  "message": "Unauthorized",
  "code": 200,
  "timestamp": "2023-12-15T10:30:00.000Z"
}
```

## 使用示例

### 创建带引用的笔记
```javascript
const response = await fetch('/notes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    title: '重要语法点',
    noteContent: '这个语法结构很重要，需要记住...',
    referenceText: '原文：The subjunctive mood is used to express...',
    userCardUuid: 'user-card-uuid-123',
    color: 'yellow',
    isPinned: true
  })
});

const result = await response.json();
console.log(result);
```

### 批量写笔记
```javascript
const response = await fetch('/notes/batch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    notes: [
      {
        title: '新笔记1',
        noteContent: '这是新创建的笔记',
        referenceText: '引用文本1',
        userCardUuid: 'user-card-uuid-123',
        color: 'blue'
      },
      {
        id: 5, // 更新现有笔记
        title: '更新的笔记标题',
        noteContent: '更新的内容',
        userCardUuid: 'user-card-uuid-456'
      }
    ]
  })
});

const result = await response.json();
if (result.success) {
  console.log(`创建了 ${result.data.created.length} 条笔记`);
  console.log(`更新了 ${result.data.updated.length} 条笔记`);
  if (result.data.errors.length > 0) {
    console.log(`有 ${result.data.errors.length} 个错误`);
    result.data.errors.forEach(error => {
      console.log(`索引 ${error.index}: ${error.error}`);
    });
  }
}
```

### 获取用户卡片的所有笔记
```javascript
const response = await fetch('/notes/user-card/user-card-uuid-123', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const result = await response.json();
if (result.success) {
  const notes = result.data;
  console.log(`找到 ${notes.length} 条笔记`);
  notes.forEach(note => {
    console.log(`- ${note.title}: ${note.noteContent}`);
    if (note.referenceText) {
      console.log(`  引用: ${note.referenceText}`);
    }
  });
}
```

### 搜索笔记
```javascript
const response = await fetch('/notes?title=重要&isPinned=true&page=1&limit=10', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const result = await response.json();
if (result.success) {
  const { data, total, page, totalPages } = result.data;
  console.log(`找到 ${total} 条笔记，当前第 ${page} 页，共 ${totalPages} 页`);
  data.forEach(note => {
    console.log(`- ${note.title} (${note.isPinned ? '置顶' : '普通'})`);
    if (note.referenceText) {
      console.log(`  引用: ${note.referenceText.substring(0, 50)}...`);
    }
  });
}
```

### 更新笔记
```javascript
const response = await fetch('/notes/1', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    title: '更新后的标题',
    noteContent: '更新后的内容',
    referenceText: '新的引用文本',
    color: 'green'
  })
});

const result = await response.json();
if (result.success) {
  console.log('笔记更新成功:', result.data.title);
}
```

### 切换置顶状态
```javascript
const response = await fetch('/notes/1/toggle-pin', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const result = await response.json();
if (result.success) {
  console.log(`笔记 ${result.data.isPinned ? '已置顶' : '已取消置顶'}`);
}
```

### 错误处理
```javascript
try {
  const response = await fetch('/notes/999', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const result = await response.json();
  
  if (!result.success) {
    console.error('操作失败:', result.message);
    // 根据错误消息进行相应处理
    switch (result.message) {
      case 'Note not found':
        console.log('笔记不存在');
        break;
      case 'Unauthorized':
        console.log('用户未授权，请重新登录');
        break;
      default:
        console.log('未知错误');
    }
  } else {
    console.log('操作成功:', result.data);
  }
} catch (error) {
  console.error('网络错误:', error);
}
```

## 批量操作最佳实践

### 1. 批量创建笔记
```javascript
// 为多个用户卡片创建笔记
const notesToCreate = userCards.map(card => ({
  title: `${card.front} 学习笔记`,
  noteContent: `关于 ${card.front} 的学习要点...`,
  referenceText: card.back, // 将卡片背面作为引用
  userCardUuid: card.uuid,
  color: 'blue'
}));

const result = await fetch('/notes/batch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ notes: notesToCreate })
});
```

### 2. 批量更新笔记
```javascript
// 批量更新多个笔记的颜色
const notesToUpdate = existingNotes.map(note => ({
  id: note.id,
  title: note.title,
  noteContent: note.noteContent,
  referenceText: note.referenceText,
  userCardUuid: note.userCard.uuid,
  color: 'red', // 统一改为红色
  isPinned: note.isPinned
}));

const result = await fetch('/notes/batch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ notes: notesToUpdate })
});
```

### 3. 混合操作（创建 + 更新）
```javascript
const mixedOperations = [
  // 创建新笔记
  {
    title: '新笔记',
    noteContent: '新内容',
    userCardUuid: 'new-card-uuid'
  },
  // 更新现有笔记
  {
    id: 5,
    title: '更新的笔记',
    noteContent: '更新的内容',
    userCardUuid: 'existing-card-uuid'
  }
];

const result = await fetch('/notes/batch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ notes: mixedOperations })
});
```

## 权限控制
- 所有接口都需要用户认证
- 用户只能访问自己创建的笔记
- 笔记必须关联到用户拥有的用户卡片
- 批量操作中的每个项目都会单独验证权限

## 注意事项
1. 所有响应都会被 `ResponseInterceptor` 包装成统一格式
2. 成功响应包含 `success: true`，失败响应包含 `success: false`
3. `referenceText` 字段用于存储引用的原文或相关内容，支持富文本
4. 批量操作支持同时创建和更新笔记，通过是否有 `id` 或 `uuid` 字段来区分
5. 批量操作会返回详细的操作结果，包括成功和失败的项目
6. 置顶的笔记会在列表中优先显示
7. 颜色字段可用于前端显示不同的笔记类型
8. 删除用户卡片时，相关笔记会被级联删除
9. 支持软删除，但当前实现为硬删除
10. 所有时间戳都使用 ISO 8601 格式 