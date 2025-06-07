# APKG文件两步式处理流程

这个新的流程将  文件的处理分为两个步骤：

1. **第一步（同步）**: 解析APKG文件并返回模板信息
2. **第二步（异步）**: 根据用户选择的模板执行渲染入库

## 第一步：解析APKG模板

### 端点
```
POST /anki/parseApkgTemplates
```

### 请求
- Content-Type: `multipart/form-data`
- 字段：
  - `file`: APKG文件

### 响应示例
```json
{
  "taskId": "uuid-string",
  "totalNotes": 5494,
  "totalCards": 16482,
  "templates": [
    {
      "name": "RECITE",
      "front": "<h1 class=R>RECITE</h1>\n<p><span class=\"Word\">{{单词}}</span>...",
      "back": "{{FrontSide}}\n<p>\n{{#词性1}}...",
      "count": 5494,
      "fields": ["单词", "音标", "词性1", "释义1", "发音", "例句", "拓展"],
      "sampleCards": [
        {
          "fields": {
            "单词": "abandon",
            "音标": "[ə'bænd(ə)n]",
            "释义1": "n. 狂热；放任 vt. 遗弃；放弃"
          },
          "renderedSample": {
            "front": "<h1 class=R>RECITE</h1>\n<p><span class=\"Word\">abandon</span>...",
            "back": "..."
          }
        }
      ]
    },
    {
      "name": "SPELLING",
      "front": "<h1 class=S>SPELLING</h1>...",
      "back": "...",
      "count": 5494,
      "fields": ["单词", "音标", "词性1", "释义1"],
      "sampleCards": [...]
    }
  ]
}
```

## 第二步：处理选择的模板

### 端点
```
POST /anki/processSelectedTemplates
```

### 请求体
```json
{
  "taskId": "from-step-1-response",
  "selectedTemplates": [
    {
      "name": "RECITE",
      "front": "修改后的正面模板...",
      "back": "修改后的背面模板..."
    }
  ],
  "deckInfo": {
    "name": "英语单词牌组",
    "description": "从APKG导入的英语单词",
    "type": "TEXT"
  }
}
```

### 响应
```json
{
  "id": 123,
  "name": "英语单词牌组", 
  "taskId": "uuid-string",
  "status": "PROCESSING",
  "message": "开始处理选择的模板"
}
```

## 前端使用流程

```javascript
// 第一步：上传文件并解析模板
const formData = new FormData();
formData.append('file', apkgFile);

const parseResponse = await fetch('/anki/parseApkgTemplates', {
  method: 'POST',
  body: formData
});

const parseResult = await parseResponse.json();
console.log('可用模板：', parseResult.templates);

// 用户选择模板并可能进行编辑...
const selectedTemplates = [
  {
    name: 'RECITE',
    front: parseResult.templates[0].front, // 可能经过用户修改
    back: parseResult.templates[0].back    // 可能经过用户修改
  }
];

// 第二步：处理选择的模板
const processResponse = await fetch('/anki/processSelectedTemplates', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    taskId: parseResult.taskId,
    selectedTemplates: selectedTemplates,
    deckInfo: {
      name: '我的英语单词牌组',
      description: '从APKG导入',
      type: 'TEXT'
    }
  })
});

const processResult = await processResponse.json();
console.log('开始处理：', processResult);

// 通过WebSocket监听处理进度
// 订阅任务ID: processResult.taskId
```

## 数据结构说明

### Template对象
- `name`: 模板名称
- `front`: 正面模板HTML
- `back`: 背面模板HTML  
- `count`: 使用此模板的卡片数量
- `fields`: 模板中使用的字段列表
- `sampleCards`: 3个样例卡片，用于预览

### SelectedTemplate对象
- `name`: 模板名称（必须匹配原模板）
- `front`: 修改后的正面模板（可选，不提供则使用原模板）
- `back`: 修改后的背面模板（可选，不提供则使用原模板）

## 注意事项

1. `taskId` 必须从第一步的响应中获取
2. 服务器根据 `taskId` 自动定位临时文件，无需客户端传递路径
3. 模板修改时要保持字段占位符格式，如 `{{单词}}`、`{{#词性1}}`等
4. 第二步完成后，临时文件会被自动清理
5. 可以通过WebSocket监听处理进度（taskId） 